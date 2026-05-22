# Step-Up Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the step-up authentication backend per [`obsidian/briefs/phase 0/step-up-auth.md`](../../obsidian/briefs/phase%200/step-up-auth.md) and [ADR 0027](../../obsidian/decisions/0027-step-up-authentication-policy.md) — the `POST /api/v1/auth/step-up/{start,finish}` endpoint pair plus the `requireStepUp` helper that every Tier 1+ endpoint consults, plus the logout cascade that invalidates step-up grace on session end.

**Architecture:** One squash. Single new endpoint pair, mechanism-discriminator-unified (analogous to the new `/api/v1/join/{start,finish}` pattern). Bearer required on `/start` (binds the round to a user session); `/finish` validated by `session_id_round` carrying the captured `session_id_user`. Each successful `/finish` SETs `step_up:<session_id_user>:t<tier>` with TTL = grace window. Logout DELetes all such keys for the session. `requireStepUp` is a pure Redis GET — the helper is owned by this plan; cross-device-identity Squash β consumes it.

**Tech Stack:** Bun, Hono, Drizzle, Redis 7, Valibot, `@serenity-kit/opaque`, `@simplewebauthn/server`.

**Larissa gate:** Mandatory. Step-up is the single most security-critical primitive added in Phase 0 outside of initial auth itself. Generous review time per the brief's implementation note.

**Prerequisite:** Cross-device-identity backend **Squash α** must be merged first ([`superpowers/plans/2026-05-22-cross-device-identity-backend.md`](2026-05-22-cross-device-identity-backend.md) Tasks 1–7). Reasons:
- Path migration `/v1/...` → `/api/v1/...` is shared infrastructure. Building step-up against `/v1/` would force a second migration.
- `bearerAuth` middleware exposing `sessionId` on the Hono context (added in cross-device Task 6) is required by every step-up endpoint.
- Cross-device Squash α removes Task 5 (the `requireStepUp` helper) — that helper is implemented here instead, in Task 2.

**Execution sequence:**

```
1. Cross-device Squash α (infrastructure: paths, DB, env var, bearerAuth.sessionId)
2. THIS plan (step-up backend)
3. Cross-device Squash β (cross-device endpoints; now functional end-to-end)
```

**Squash boundary:** single `### Squash γ boundary` after Larissa audit (Task 8).

---

## Decisions captured during mini-brainstorm (2026-05-22)

These decisions amend the step-up brief inline; the brief itself is not patched, because the changes follow directly from cross-device-identity decisions that landed first.

1. **Path prefix `/api/v1/auth/step-up/*`** — supersedes the brief's `/v1/auth/step-up`. Consistent with the cross-device path migration.
2. **Unified `{start,finish}` endpoint pair with `mechanism` discriminator** — `mechanism: 'webauthn' | 'opaque'` in the body. Symmetric with `/api/v1/join/{start,finish}` and its `kind` discriminator. Brief's one-shot framing rejected as OPAQUE/WebAuthn-incompatible.
3. **Bearer required on `/start` only; `/finish` validates via `session_id_round`** — `/start` reads bearer, extracts `session_id_user`, captures it in the round state. `/finish` reuses captured `session_id_user` to set the right outer Redis key. Robust against token rotation between the two calls.
4. **WebAuthn assertion uses the simplewebauthn `AuthenticationResponseJSON` envelope** — not a custom-serialised single string. Allows verification via `@simplewebauthn/server` without inventing a new format.
5. **OPAQUE login bound to user-from-bearer at `/start`** — no `username` in body. Server looks up the user's OPAQUE auth_method by user_id (from bearer) and starts the login round.
6. **Tier 2/3 TTL = 10 seconds** — per brief lines 354–362; same Redis mechanism as Tier 1/4, just shorter TTL. No special branching.

---

## File Map

- **Create** `apps/auth-service/src/auth/step-up.ts` — `requireStepUp({ sessionId, tier })` helper (formerly proposed in cross-device plan Task 5; built here instead). Plus a `tierGraceMs(tier)` helper exporting the TTL table.
- **Create** `apps/auth-service/src/routes/auth/step-up.ts` — `/api/v1/auth/step-up/{start,finish}` handlers, mechanism-branched.
- **Modify** `apps/auth-service/src/routes/auth.ts` — `/api/v1/auth/logout` extended to `SCAN` + `DEL` every `step_up:<session_id_user>:*` key. Also `CLEAR_COOKIE` path updates from `/v1/token/refresh` to `/api/v1/token/refresh` (in lockstep with the cookie migration already done in cross-device Squash α — verify already merged).
- **Modify** `apps/auth-service/src/server.ts` — register `registerStepUpRoutes(app)` alongside other registrations.
- **Modify** `apps/auth-service/src/metrics.ts` — add `authStepUpStartedTotal`, `authStepUpFinishedTotal` (labels: `mechanism`, `tier`, `outcome`).
- **Modify** `apps/auth-service/src/audit/log.ts` — if event types are enumerated, add `auth.step_up.confirmed` and `auth.step_up.failed`. Otherwise the strings are accepted as-is via existing `writeAudit({ eventType: '...' })`.
- **Create** `apps/auth-service/tests/unit/step-up-helper.test.ts` — `requireStepUp` unit tests against a real Redis (skip when `REDIS_URL` absent).
- **Create** `apps/auth-service/tests/integration/auth-step-up.test.ts` — full `/start` + `/finish` round-trips for both mechanisms; logout-cascade assertion; Tier-2/3 10s-TTL behaviour.

---

## Task 1: Extend `requireStepUp` helper with Tier 3 (and reserve Tier 2)

**Files:**
- Modify: `apps/auth-service/src/auth/step-up.ts` (created in cross-device Squash α Task 5 with Tier 1/4 support; extend here)
- Modify: `apps/auth-service/tests/unit/step-up-helper.test.ts` (cross-device tests cover Tier 1/4; extend for Tier 2/3)

Cross-device Squash α already created `requireStepUp` with the `tierGraceMs` table covering Tier 1 (120s) and Tier 4 (300s). This task extends it to Tier 3 (10s tolerance) and reserves Tier 2 (also 10s, for future re-disclosure-of-secrets ops). Same Redis mechanism for all tiers.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { createRedis } from '../../src/redis/client.js';
import { requireStepUp, tierGraceMs } from '../../src/auth/step-up.js';

const skip = !process.env.REDIS_URL;

describe.skipIf(skip)('requireStepUp', () => {
  const sessionId = 'test-session-' + Math.random().toString(36).slice(2);
  const redis = createRedis();

  beforeAll(async () => {
    await redis.del(
      `step_up:${sessionId}:t1`,
      `step_up:${sessionId}:t2`,
      `step_up:${sessionId}:t3`,
      `step_up:${sessionId}:t4`,
    );
  });

  beforeEach(async () => {
    await redis.del(
      `step_up:${sessionId}:t1`,
      `step_up:${sessionId}:t2`,
      `step_up:${sessionId}:t3`,
      `step_up:${sessionId}:t4`,
    );
  });

  afterAll(async () => { await redis.quit(); });

  it('throws 403 when no key exists for the tier', async () => {
    await expect(requireStepUp({ sessionId, tier: 1 })).rejects.toMatchObject({
      status: 403,
      code: 'step_up_required',
    });
  });

  it('passes when a fresh key exists within the grace window', async () => {
    await redis.set(`step_up:${sessionId}:t1`, String(Date.now()), 'EX', 120);
    await expect(requireStepUp({ sessionId, tier: 1 })).resolves.toBeUndefined();
  });

  it('throws 403 when the value timestamp is older than the grace window', async () => {
    const oldTs = String(Date.now() - 130_000);
    await redis.set(`step_up:${sessionId}:t1`, oldTs, 'EX', 200);
    await expect(requireStepUp({ sessionId, tier: 1 })).rejects.toMatchObject({
      status: 403,
      code: 'step_up_required',
    });
  });

  it('honours Tier 4 grace window of 300s', async () => {
    const ts = String(Date.now() - 250_000);
    await redis.set(`step_up:${sessionId}:t4`, ts, 'EX', 400);
    await expect(requireStepUp({ sessionId, tier: 4 })).resolves.toBeUndefined();
  });

  it('honours Tier 2/3 grace window of 10s', async () => {
    await redis.set(`step_up:${sessionId}:t3`, String(Date.now()), 'EX', 15);
    await expect(requireStepUp({ sessionId, tier: 3 })).resolves.toBeUndefined();

    await redis.set(`step_up:${sessionId}:t3`, String(Date.now() - 12_000), 'EX', 20);
    await expect(requireStepUp({ sessionId, tier: 3 })).rejects.toMatchObject({
      status: 403,
      code: 'step_up_required',
    });
  });

  it('tierGraceMs returns the correct per-tier values', () => {
    expect(tierGraceMs(1)).toBe(120_000);
    expect(tierGraceMs(2)).toBe(10_000);
    expect(tierGraceMs(3)).toBe(10_000);
    expect(tierGraceMs(4)).toBe(300_000);
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
REDIS_URL=redis://localhost:6379 bun test apps/auth-service/tests/unit/step-up-helper.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement the helper**

Create `apps/auth-service/src/auth/step-up.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import { ApiError } from '../middleware/error-envelope.js';
import { createRedis } from '../redis/client.js';

export type StepUpTier = 1 | 2 | 3 | 4;

const GRACE_MS: Record<StepUpTier, number> = {
  1: 120_000,  // 2 minutes
  2: 10_000,   // 10 seconds — re-disclosure of secrets
  3: 10_000,   // 10 seconds — destructive ops
  4: 300_000,  // 5 minutes — operator bursts
};

export function tierGraceMs(tier: StepUpTier): number {
  return GRACE_MS[tier];
}

interface RequireStepUpInput {
  sessionId: string;
  tier: StepUpTier;
}

/**
 * Verifies the session has a fresh step-up confirmation for the given tier
 * per ADR 0027. Throws ApiError(403, 'step_up_required', { tier }) on miss.
 *
 * Tier 0 callers must not invoke this helper. Tier 2/3 enforce a 10-second
 * "complete-the-operation-immediately" tolerance rather than a real grace
 * window — see brief §"Privileged endpoint behaviour".
 */
export async function requireStepUp({ sessionId, tier }: RequireStepUpInput): Promise<void> {
  const graceMs = GRACE_MS[tier];
  const redis = createRedis();
  const raw = await redis.get(`step_up:${sessionId}:t${tier}`);
  if (!raw) {
    throw new ApiError(403, 'step_up_required', 'Step-up confirmation required', { tier });
  }
  const ts = Number(raw);
  if (!Number.isFinite(ts) || Date.now() - ts > graceMs) {
    throw new ApiError(403, 'step_up_required', 'Step-up confirmation expired', { tier });
  }
}
```

If `ApiError` does not currently accept a 4th-arg metadata object, extend its constructor; the error-envelope middleware should surface the `tier` field in the response body.

- [ ] **Step 4: Run the tests to verify success**

```bash
REDIS_URL=redis://localhost:6379 bun test apps/auth-service/tests/unit/step-up-helper.test.ts
```

Expected: PASS.

- [ ] **Step 5: Checkpoint commit**

```bash
git add apps/auth-service/src/auth/step-up.ts apps/auth-service/tests/unit/step-up-helper.test.ts
git commit -m "Add requireStepUp helper with per-tier grace windows"
```

---

## Task 2: `POST /api/v1/auth/step-up/start` (both mechanisms)

**Files:**
- Create: `apps/auth-service/src/routes/auth/step-up.ts`
- Modify: `apps/auth-service/src/server.ts`
- Create: `apps/auth-service/tests/integration/auth-step-up.test.ts`

`/start` is bearer-authorised; branches on `mechanism`. WebAuthn returns assertion options (challenge). OPAQUE consumes the client's login_request and returns login_response.

- [ ] **Step 1: Write the failing test for `mechanism=webauthn`**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { createServer } from '../../src/server.js';
import { createRedis } from '../../src/redis/client.js';
import { registerTestUser } from '../helpers/register.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;

describe.skipIf(skip)('POST /api/v1/auth/step-up/start', () => {
  let app: ReturnType<typeof createServer>;
  let accessToken: string;
  let sessionId: string;
  const redis = createRedis();

  beforeAll(async () => {
    app = createServer();
    ({ accessToken, sessionId } = await registerTestUser({ withPasskey: true }));
  });

  beforeEach(async () => {
    const keys = await redis.keys(`step_up:${sessionId}:*`);
    if (keys.length) await redis.del(...keys);
  });

  afterAll(async () => { await redis.quit(); });

  it('returns 200 with assertion options for mechanism=webauthn', async () => {
    const res = await app.request('/api/v1/auth/step-up/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ mechanism: 'webauthn', tier_requested: 't1' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      session_id: string;
      mechanism: 'webauthn';
      options: { challenge: string; allowCredentials?: unknown[] };
    };
    expect(body.session_id).toBeTruthy();
    expect(body.mechanism).toBe('webauthn');
    expect(body.options.challenge).toBeTruthy();
  });

  it('returns 200 with login_response for mechanism=opaque', async () => {
    const { startLoginRequest } = (await import('@serenity-kit/opaque')).client.startLogin({
      password: 'opaque-test-password',
    });
    const res = await app.request('/api/v1/auth/step-up/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        mechanism: 'opaque',
        tier_requested: 't1',
        login_request: startLoginRequest,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      session_id: string;
      mechanism: 'opaque';
      login_response: string;
    };
    expect(body.session_id).toBeTruthy();
    expect(body.mechanism).toBe('opaque');
    expect(body.login_response).toBeTruthy();
  });

  it('returns 401 without Bearer', async () => {
    const res = await app.request('/api/v1/auth/step-up/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mechanism: 'webauthn', tier_requested: 't1' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 invalid_tier for t0 or t2 (per brief — no /start for those)', async () => {
    for (const tier of ['t0', 't2']) {
      const res = await app.request('/api/v1/auth/step-up/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ mechanism: 'webauthn', tier_requested: tier }),
      });
      expect(res.status).toBe(400);
    }
  });
});
```

Note: brief §"Error responses" says `400 invalid_tier` is returned when `tier_requested` is not `t1` or `t4` (because t2/t3 have no real grace and t0 doesn't exist). t3 IS accepted at /start (per brief's failure table, only t0/t2 are clear-rejects). Confirm in implementation; adjust test if our final stance differs.

Actually re-reading the brief: brief line 330 says `t1` or `t4` (rejecting t2 AND t3). But brief §"Privileged endpoint behaviour" line 354 says Tier 2/3 endpoints check a key with TTL=10s — implying t2/t3 DO get set via /finish. Inconsistency in brief. **Decision for this plan: accept t1, t3, t4 at /start (t3 because destructive ops need an immediate-tolerance window; t2 reserved as empty in Phase 0).** Reject t0 and t2. Document the decision in the spec-deviation note.

- [ ] **Step 2: Run the test to verify failure**

```bash
REDIS_URL=redis://localhost:6379 \
TEST_DATABASE_URL=postgres://chatsundere:chatsundere@localhost:5432/auth_db_test \
  bun test apps/auth-service/tests/integration/auth-step-up.test.ts
```

Expected: FAIL — route not registered.

- [ ] **Step 3: Implement the handler**

Create `apps/auth-service/src/routes/auth/step-up.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import { server as opaqueServer } from '@serenity-kit/opaque';
import { and, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { object, optional, parse, picklist, string } from 'valibot';
import { createDb } from '../../db/client.js';
import { authMethods, users } from '../../db/schema.js';
import type { AccessClaims } from '../../jwt/verify.js';
import { metrics } from '../../metrics.js';
import { bearerAuth } from '../../middleware/auth.js';
import { ApiError } from '../../middleware/error-envelope.js';
import {
  ensureOpaqueReady,
  generateSessionId,
  getServerSetup,
  storeOpaqueState,
} from '../../opaque/server.js';
import { createRedis } from '../../redis/client.js';
import { generateAuthentication } from '../../webauthn/server.js';

const startReq = object({
  mechanism: picklist(['webauthn', 'opaque']),
  tier_requested: picklist(['t1', 't3', 't4']),
  login_request: optional(string()),  // opaque-only
});

export function registerStepUpRoutes(app: Hono): void {
  app.post('/api/v1/auth/step-up/start', bearerAuth(), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const sessionIdUser = c.get('sessionId') as string;
    const body = parse(startReq, await c.req.json());

    const sessionIdRound = generateSessionId();

    if (body.mechanism === 'webauthn') {
      // Look up the user's passkey credentials to bind the assertion.
      const { db } = createDb();
      const passkeyRows = await db
        .select()
        .from(authMethods)
        .where(and(eq(authMethods.userId, claims.sub), eq(authMethods.methodType, 'passkey')));

      if (passkeyRows.length === 0) {
        throw new ApiError(400, 'no_passkey', 'User has no passkey; use mechanism=opaque');
      }

      const userRow = (
        await db.select({ username: users.username }).from(users).where(eq(users.id, claims.sub)).limit(1)
      )[0];

      const options = await generateAuthentication({
        userId: claims.sub,
        username: userRow!.username,
        allowCredentials: passkeyRows.map((r) => ({
          id: Buffer.from(r.passkeyCredentialId!).toString('base64url'),
          type: 'public-key' as const,
        })),
        userVerification: 'required', // step-up forces UV per ADR 0027 Mechanism A
      });

      const redis = createRedis();
      await redis.set(
        `step_up_round:${sessionIdRound}`,
        JSON.stringify({
          mechanism: 'webauthn',
          tier: body.tier_requested,
          user_id: claims.sub,
          session_id_user: sessionIdUser,
          challenge: options.challenge,
        }),
        'EX',
        60,
      );

      metrics.authStepUpStartedTotal.inc({ mechanism: 'webauthn', tier: body.tier_requested });

      return c.json({
        session_id: sessionIdRound,
        mechanism: 'webauthn' as const,
        options,
      });
    }

    // mechanism === 'opaque'
    if (!body.login_request) {
      throw new ApiError(400, 'invalid_input', 'login_request required for mechanism=opaque');
    }
    await ensureOpaqueReady();

    const { db } = createDb();
    const opaqueRow = (
      await db
        .select()
        .from(authMethods)
        .where(and(eq(authMethods.userId, claims.sub), eq(authMethods.methodType, 'opaque')))
        .limit(1)
    )[0];
    if (!opaqueRow) throw new ApiError(500, 'internal', 'User missing OPAQUE method');

    const { loginResponse, serverLogin } = opaqueServer.startLogin({
      serverSetup: getServerSetup(),
      userIdentifier: opaqueRow.opaqueUserIdentifier!,
      registrationRecord: Buffer.from(opaqueRow.opaqueCredential!).toString('base64url'),
      startLoginRequest: body.login_request,
    });

    await storeOpaqueState({
      scope: 'step-up-opaque',
      sessionId: sessionIdRound,
      payload: {
        tier: body.tier_requested,
        user_id: claims.sub,
        session_id_user: sessionIdUser,
        server_login_state: serverLogin,
      },
    });

    metrics.authStepUpStartedTotal.inc({ mechanism: 'opaque', tier: body.tier_requested });

    return c.json({
      session_id: sessionIdRound,
      mechanism: 'opaque' as const,
      login_response: loginResponse,
    });
  });
}
```

- [ ] **Step 4: Add the metric**

In `metrics.ts`:

```ts
authStepUpStartedTotal: new Counter({
  name: 'auth_step_up_started_total',
  help: 'POST /api/v1/auth/step-up/start invocations',
  labelNames: ['mechanism', 'tier'],
}),
```

- [ ] **Step 5: Register in `server.ts`**

```ts
import { registerStepUpRoutes } from './routes/auth/step-up.js';
// ...
registerStepUpRoutes(app);
```

- [ ] **Step 6: Run the tests**

```bash
REDIS_URL=redis://localhost:6379 \
TEST_DATABASE_URL=postgres://chatsundere:chatsundere@localhost:5432/auth_db_test \
  bun test apps/auth-service/tests/integration/auth-step-up.test.ts
```

Expected: the `/start` tests PASS; `/finish` ones (next task) still fail.

- [ ] **Step 7: Checkpoint commit**

```bash
git add apps/auth-service/src/routes/auth apps/auth-service/src/server.ts apps/auth-service/src/metrics.ts apps/auth-service/tests/integration/auth-step-up.test.ts
git commit -m "Add POST /api/v1/auth/step-up/start (webauthn + opaque)"
```

---

## Task 3: `POST /api/v1/auth/step-up/finish` (both mechanisms) + Redis key set

**Files:**
- Modify: `apps/auth-service/src/routes/auth/step-up.ts`
- Extend: `apps/auth-service/tests/integration/auth-step-up.test.ts`

`/finish` is **not** bearer-authorised — validated by `session_id_round` per the brainstorm decision. Branches on mechanism. On success, SETs `step_up:<session_id_user>:t<tier>` with TTL from `tierGraceMs(tier)`.

- [ ] **Step 1: Extend the integration test**

Append a `/finish` round-trip per mechanism. WebAuthn requires a real client-side assertion; in the test, either:
- Use a `@simplewebauthn/server` or `bun:test` virtual authenticator if available, or
- Inline a small fixture that pre-computes a valid signed assertion for a known credential.

For OPAQUE, complete the round:

```ts
it('completes opaque step-up and sets Redis key with grace-window TTL', async () => {
  const { client: opaqueClient } = await import('@serenity-kit/opaque');
  const { clientLoginState, startLoginRequest } = opaqueClient.startLogin({
    password: 'opaque-test-password',
  });

  const startRes = await app.request('/api/v1/auth/step-up/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      mechanism: 'opaque',
      tier_requested: 't1',
      login_request: startLoginRequest,
    }),
  });
  const startBody = await startRes.json() as { session_id: string; login_response: string };

  const { finishLoginRequest } = opaqueClient.finishLogin({
    clientLoginState,
    loginResponse: startBody.login_response,
    password: 'opaque-test-password',
  });

  const finishRes = await app.request('/api/v1/auth/step-up/finish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mechanism: 'opaque',
      session_id: startBody.session_id,
      login_evidence: finishLoginRequest,
    }),
  });
  expect(finishRes.status).toBe(200);
  const body = await finishRes.json() as { tier_confirmed: string; expires_at: string };
  expect(body.tier_confirmed).toBe('t1');

  // Redis key set.
  const raw = await redis.get(`step_up:${sessionId}:t1`);
  expect(raw).toBeTruthy();
  const ts = Number(raw);
  expect(Date.now() - ts).toBeLessThan(2000);

  // TTL within expected range (120s for t1).
  const ttl = await redis.ttl(`step_up:${sessionId}:t1`);
  expect(ttl).toBeGreaterThanOrEqual(115);
  expect(ttl).toBeLessThanOrEqual(125);
});

it('returns 401 opaque_authentication_failed for wrong passphrase', async () => {
  // ... same shape, finishLogin computed against wrong password ...
  const finishRes = await app.request('/api/v1/auth/step-up/finish', { ... });
  expect(finishRes.status).toBe(401);
});

it('returns 410 session_expired for stale session_id', async () => {
  const finishRes = await app.request('/api/v1/auth/step-up/finish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mechanism: 'opaque',
      session_id: '00000000-0000-0000-0000-000000000000',
      login_evidence: 'irrelevant',
    }),
  });
  expect(finishRes.status).toBe(410);
});

it('sets 10-second TTL for tier_requested=t3', async () => {
  // ... full t3 round-trip ...
  const ttl = await redis.ttl(`step_up:${sessionId}:t3`);
  expect(ttl).toBeGreaterThanOrEqual(5);
  expect(ttl).toBeLessThanOrEqual(10);
});
```

For WebAuthn, mirror the structure but use the simplewebauthn assertion-fixture or virtual authenticator.

- [ ] **Step 2: Run the test to verify failure**

```bash
REDIS_URL=redis://localhost:6379 \
TEST_DATABASE_URL=postgres://chatsundere:chatsundere@localhost:5432/auth_db_test \
  bun test apps/auth-service/tests/integration/auth-step-up.test.ts
```

Expected: `/finish` tests FAIL — handler missing.

- [ ] **Step 3: Implement `/finish`**

In `routes/auth/step-up.ts`:

```ts
const finishReq = object({
  mechanism: picklist(['webauthn', 'opaque']),
  session_id: string(),
  // mechanism-specific:
  assertion: optional(unknown()),     // AuthenticationResponseJSON envelope (webauthn)
  login_evidence: optional(string()), // base64url (opaque)
});

app.post('/api/v1/auth/step-up/finish', async (c) => {
  const body = parse(finishReq, await c.req.json());

  if (body.mechanism === 'webauthn') {
    const redis = createRedis();
    const raw = await redis.get(`step_up_round:${body.session_id}`);
    if (!raw) throw new ApiError(410, 'session_expired', 'Step-up round expired or not found');
    await redis.del(`step_up_round:${body.session_id}`);
    const state = JSON.parse(raw) as {
      mechanism: 'webauthn';
      tier: 't1' | 't3' | 't4';
      user_id: string;
      session_id_user: string;
      challenge: string;
    };

    if (!body.assertion) throw new ApiError(400, 'invalid_input', 'assertion required for mechanism=webauthn');

    // Verify the assertion via @simplewebauthn/server. UV must be true per
    // ADR 0027 Mechanism A; if not, return 401 webauthn_uv_required so the
    // client knows to silently fall through to mechanism=opaque.
    const verification = await verifyAuthentication({
      response: body.assertion as AuthenticationResponseJSON,
      expectedChallenge: state.challenge,
    });
    if (!verification.verified) {
      metrics.authStepUpFinishedTotal.inc({ mechanism: 'webauthn', tier: state.tier, outcome: 'verify_failed' });
      throw new ApiError(401, 'webauthn_verification_failed', 'WebAuthn verification failed');
    }
    if (!verification.authenticationInfo?.userVerified) {
      metrics.authStepUpFinishedTotal.inc({ mechanism: 'webauthn', tier: state.tier, outcome: 'uv_required' });
      throw new ApiError(401, 'webauthn_uv_required', 'UV not performed — fall through to opaque');
    }

    await setStepUpKey(state.session_id_user, state.tier);
    metrics.authStepUpFinishedTotal.inc({ mechanism: 'webauthn', tier: state.tier, outcome: 'success' });
    return c.json({
      tier_confirmed: state.tier,
      expires_at: new Date(Date.now() + tierGraceMs(asNumericTier(state.tier))).toISOString(),
    });
  }

  // mechanism === 'opaque'
  await ensureOpaqueReady();
  const state = await fetchOpaqueState('step-up-opaque', body.session_id);
  if (!state) throw new ApiError(410, 'session_expired', 'Step-up round expired or not found');
  if (!body.login_evidence) throw new ApiError(400, 'invalid_input', 'login_evidence required for mechanism=opaque');

  let sessionKey: string;
  try {
    const result = opaqueServer.finishLogin({
      serverSetup: getServerSetup(),
      serverLogin: state.server_login_state,
      finishLoginRequest: body.login_evidence,
    });
    sessionKey = result.sessionKey;
  } catch {
    metrics.authStepUpFinishedTotal.inc({ mechanism: 'opaque', tier: state.tier, outcome: 'auth_failed' });
    throw new ApiError(401, 'opaque_authentication_failed', 'Passphrase verification failed');
  }
  void sessionKey; // step-up doesn't use the session key directly

  await setStepUpKey(state.session_id_user, state.tier);
  metrics.authStepUpFinishedTotal.inc({ mechanism: 'opaque', tier: state.tier, outcome: 'success' });
  return c.json({
    tier_confirmed: state.tier,
    expires_at: new Date(Date.now() + tierGraceMs(asNumericTier(state.tier))).toISOString(),
  });
});

async function setStepUpKey(sessionIdUser: string, tier: 't1' | 't3' | 't4'): Promise<void> {
  const redis = createRedis();
  const numericTier = asNumericTier(tier);
  const graceMs = tierGraceMs(numericTier);
  const graceSeconds = Math.ceil(graceMs / 1000);
  await redis.set(`step_up:${sessionIdUser}:${tier}`, String(Date.now()), 'EX', graceSeconds);
}

function asNumericTier(tier: 't1' | 't3' | 't4'): 1 | 3 | 4 {
  return Number(tier.slice(1)) as 1 | 3 | 4;
}
```

- [ ] **Step 4: Register the `authStepUpFinishedTotal` metric**

```ts
authStepUpFinishedTotal: new Counter({
  name: 'auth_step_up_finished_total',
  help: 'POST /api/v1/auth/step-up/finish invocations',
  labelNames: ['mechanism', 'tier', 'outcome'],  // outcome: success | uv_required | verify_failed | auth_failed
}),
```

- [ ] **Step 5: Run the tests**

```bash
REDIS_URL=redis://localhost:6379 \
TEST_DATABASE_URL=postgres://chatsundere:chatsundere@localhost:5432/auth_db_test \
  bun test apps/auth-service/tests/integration/auth-step-up.test.ts
```

Expected: PASS.

- [ ] **Step 6: Checkpoint commit**

```bash
git add apps/auth-service/src/routes/auth/step-up.ts apps/auth-service/src/metrics.ts apps/auth-service/tests/integration/auth-step-up.test.ts
git commit -m "Add POST /api/v1/auth/step-up/finish (webauthn + opaque) with grace-window Redis key"
```

---

## Task 4: Logout cascade — DEL step_up:* keys for the session

**Files:**
- Modify: `apps/auth-service/src/routes/auth.ts` (the `POST /api/v1/auth/logout` handler — assumes migrated by cross-device Squash α Task 1)
- Extend: `apps/auth-service/tests/integration/auth-step-up.test.ts`

- [ ] **Step 1: Add the logout-cascade test**

```ts
it('clears step_up:* keys on POST /api/v1/auth/logout', async () => {
  // Set up a fresh step-up key via /start+/finish (or directly via redis.set for test simplicity).
  await redis.set(`step_up:${sessionId}:t1`, String(Date.now()), 'EX', 120);
  await redis.set(`step_up:${sessionId}:t4`, String(Date.now()), 'EX', 300);

  const res = await app.request('/api/v1/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(res.status).toBe(200);

  expect(await redis.get(`step_up:${sessionId}:t1`)).toBeNull();
  expect(await redis.get(`step_up:${sessionId}:t4`)).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify failure**

Expected: FAIL — logout currently doesn't clear step-up keys.

- [ ] **Step 3: Extend the logout handler**

In `routes/auth.ts`, after the existing logout-cleanup logic (refresh-token revocation), add:

```ts
// Clear all step-up grace windows for this session per ADR 0027.
const redis = createRedis();
const sessionIdUser = c.get('sessionId') as string;
if (sessionIdUser) {
  const keys = await redis.keys(`step_up:${sessionIdUser}:*`);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}
```

Note: `redis.keys()` is `O(n)` over the whole keyspace; for small Redis it's fine. If we want to scale, use `SCAN`. Phase 0 keeps `KEYS` for simplicity; revisit at v0.1.0+.

- [ ] **Step 4: Run the test to verify success**

```bash
REDIS_URL=redis://localhost:6379 \
TEST_DATABASE_URL=postgres://chatsundere:chatsundere@localhost:5432/auth_db_test \
  bun test apps/auth-service/tests/integration/auth-step-up.test.ts
```

Expected: PASS.

- [ ] **Step 5: Checkpoint commit**

```bash
git add apps/auth-service/src/routes/auth.ts apps/auth-service/tests/integration/auth-step-up.test.ts
git commit -m "Extend logout to clear step_up:* keys for the session"
```

---

## Task 5: Rate limits on /api/v1/auth/step-up

**Files:**
- Modify: `apps/auth-service/src/routes/auth/step-up.ts` (apply rate-limit middleware)
- Extend: `apps/auth-service/tests/integration/auth-step-up.test.ts`

Per the step-up brief: 10 attempts per session per 5 minutes, 20 attempts per IP per 5 minutes.

- [ ] **Step 1: Locate the existing rate-limit middleware**

```bash
rg -n "rateLimitPerIp|rateLimitPerSession|RateLimit" apps/auth-service/src
```

The auth-service already has a rate-limit module (probably `apps/auth-service/src/rate-limit/` or similar). Reuse the existing primitives. If they take `(key, max, windowSeconds)` style, write a small wrapper that combines per-session and per-IP caps.

- [ ] **Step 2: Write the test for rate-limit-exceeded**

```ts
it('returns 429 after exceeding 10 step-up attempts per session in 5 min', async () => {
  for (let i = 0; i < 10; i++) {
    await app.request('/api/v1/auth/step-up/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ mechanism: 'webauthn', tier_requested: 't1' }),
    });
  }
  const res = await app.request('/api/v1/auth/step-up/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ mechanism: 'webauthn', tier_requested: 't1' }),
  });
  expect(res.status).toBe(429);
  expect((await res.json() as { error: string }).error).toBe('rate_limit_exceeded');
});
```

- [ ] **Step 3: Apply rate-limit to both /start and /finish**

Wrap both handlers in middleware that increments and checks counters keyed by `step_up_rl:session:<sessionIdUser>` and `step_up_rl:ip:<ip>`.

- [ ] **Step 4: Run the test**

Expected: PASS.

- [ ] **Step 5: Checkpoint commit**

```bash
git add apps/auth-service/src/routes/auth/step-up.ts apps/auth-service/tests/integration/auth-step-up.test.ts
git commit -m "Add session+IP rate limits to /api/v1/auth/step-up/{start,finish}"
```

---

## Task 6: Audit events

**Files:**
- Modify: `apps/auth-service/src/routes/auth/step-up.ts` (call `writeAudit` on success and notable failures)
- Optional: `apps/auth-service/src/audit/log.ts` if event types are enumerated

- [ ] **Step 1: Add `writeAudit` calls in `/finish`**

On success (both mechanisms):

```ts
await writeAudit({
  db: createDb().db,
  eventType: 'auth.step_up.confirmed',
  userId: state.user_id,
  metadata: { mechanism: body.mechanism, tier: state.tier },
});
```

On notable failure (webauthn UV required, OPAQUE auth failed):

```ts
await writeAudit({
  db: createDb().db,
  eventType: 'auth.step_up.failed',
  userId: state.user_id,
  metadata: { mechanism: body.mechanism, tier: state.tier, reason: 'uv_required' /* or 'auth_failed' */ },
});
```

- [ ] **Step 2: Extend the test to assert audit rows**

```ts
it('writes auth.step_up.confirmed on success', async () => {
  // ... complete a step-up successfully ...
  const { db } = createDb();
  const auditRows = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.eventType, 'auth.step_up.confirmed'))
    .orderBy(desc(auditLog.createdAt))
    .limit(1);
  expect(auditRows[0]).toBeDefined();
  expect(auditRows[0]?.metadata).toMatchObject({ mechanism: 'opaque', tier: 't1' });
});
```

- [ ] **Step 3: Run the tests**

Expected: PASS.

- [ ] **Step 4: Checkpoint commit**

```bash
git add apps/auth-service/src/routes/auth/step-up.ts apps/auth-service/tests/integration/auth-step-up.test.ts
git commit -m "Audit auth.step_up.confirmed and auth.step_up.failed events"
```

---

## Task 7: Spec deviation — t3-at-/start

Per the mini-brainstorm and brief inconsistency, we accept `t3` at `/start` (brief said "t1 or t4" but Tier 3 endpoints rely on a key being set, which means /start must accept t3).

- [ ] **Step 1: Patch the step-up brief**

In `obsidian/briefs/phase 0/step-up-auth.md` around the `400 invalid_tier` row, change `tier_requested is not t1 or t4` to `tier_requested is not t1, t3, or t4 (t2 reserved, t0 not applicable)`. Add a short note that t3 uses the 10-second tolerance window per §"Privileged endpoint behaviour".

- [ ] **Step 2: Doc-only commit with [skip ci]**

```bash
git add obsidian/briefs/phase\ 0/step-up-auth.md
git commit -m "Clarify step-up brief: t3 accepted at /start (10s tolerance) [skip ci]"
```

---

## Task 8: Audit + squash γ

**Files:** no code; Larissa pre-squash audit + git operations.

- [ ] **Step 1: Summon Larissa**

Provide:

- Diff range: HEAD of `master` after cross-device Squash α through current HEAD.
- Brief: `obsidian/briefs/phase 0/step-up-auth.md`.
- ADR: 0027.
- Focus: `requireStepUp` correctness, OPAQUE bound-to-bearer-user logic, WebAuthn UV-required enforcement, logout cascade `KEYS`-cost trade-off, rate-limit calibration, audit event coverage.

- [ ] **Step 2: Address findings**

Apply High/Critical fixes. Document defers in `obsidian/insights/security-deferrals.md`.

- [ ] **Step 3: Soft-reset and squash**

```bash
git log --oneline -15
# identify the pre-Task-1 SHA (= HEAD after cross-device Squash α)
git reset --soft <pre-step-up-sha>
git commit -m "$(cat <<'EOF'
Add step-up authentication backend

POST /api/v1/auth/step-up/{start,finish} per ADR 0027 and the step-up
brief, plus the requireStepUp helper that every Tier 1+ endpoint
consults. Unified endpoint pair with a mechanism discriminator
(webauthn | opaque); /start requires Bearer, /finish validates by
session_id_round (captured session_id_user is reused).

- WebAuthn flow: /start returns simplewebauthn AuthenticationOptions
  with UV='required' enforced; /finish verifies the assertion and
  refuses with 401 webauthn_uv_required if UV did not happen, so the
  client can silently fall through to opaque
- OPAQUE flow: /start consumes a login_request, returns a
  login_response; /finish verifies login_evidence via a fresh OPAQUE
  round bound to the user's existing OPAQUE auth_method row
- On success, /finish SETs step_up:<session_id_user>:t<tier> in Redis
  with TTL per tier (120s for t1, 300s for t4, 10s for t3)
- POST /api/v1/auth/logout cascade-deletes all step_up:<session>:* keys
- Rate limits: 10 attempts/session/5min, 20/IP/5min
- Audit events: auth.step_up.confirmed, auth.step_up.failed
- Metrics: auth_step_up_started_total{mechanism,tier},
  auth_step_up_finished_total{mechanism,tier,outcome}

requireStepUp helper is now available for Tier 1+ endpoint gating;
unblocks cross-device-identity Squash β.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

### Squash γ boundary

---

## Self-Review

| Brief / ADR section | Task |
|---|---|
| Brief §Tier classification | Task 2/3 accept t1/t3/t4 at /start; t2 reserved |
| Brief §Mechanism A (WebAuthn UV='required') | Task 2 generateAuthentication, Task 3 UV check |
| Brief §Mechanism B (OPAQUE re-prompt) | Tasks 2, 3 — bound to user_id from bearer |
| Brief §Mechanism C (grace window) | Task 1 tierGraceMs + Task 3 setStepUpKey |
| Brief §Server-side State | Task 1 helper + Task 3 key setting + Task 4 logout cascade |
| Brief §API Surface (POST /v1/auth/step-up) | Tasks 2, 3 (renamed to /api/v1/) |
| Brief §Rate limits | Task 5 |
| ADR 0027 §Per-Tier Mapping | Task 1 GRACE_MS table |
| ADR 0027 §Server-side State | Task 1 + Task 3 |

**Spec deviation:** t3 accepted at /start (brief said "t1 or t4"). Patched in Task 7.

**Cross-device dependency:** Task 5 of cross-device plan ("requireStepUp helper") is now a no-op — the helper is built here. Update the cross-device plan in lockstep: drop Task 5, renumber Tasks 6+ accordingly, and add an import-from-step-up note in Task 6.

---

## Execution Handoff

Plan complete. Subagent-driven execution recommended per Chris's choice. Execute in this order:

1. **Cross-device Squash α** (cross-device plan Tasks 1–7)
2. **THIS plan in full** (step-up Tasks 1–8)
3. **Cross-device Squash β** (cross-device plan Tasks 8–15)

Dispatch the first subagent against cross-device Task 1 (path migration).
