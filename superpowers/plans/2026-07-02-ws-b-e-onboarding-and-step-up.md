# WS-B + WS-E Implementation Plan — Onboarding Un-gate and the Step-up Client

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the step-up client vertical (server enforcement + t1 seeding, ceremony flows, shared modal, `apiFetch` interceptors in both clients) and un-gate the onboarding matrix (probe-validated join flows, real server-linking page, pairing-code generation, server-synced passkeys).

**Architecture:** Two feature units on one branch, built strictly in order. **WS-E** (Tasks 1–7): `packages/shared-types` wire shapes → auth-service seeding + enforcement → `packages/crypto` ceremony flows → `packages/ui-shared` store + modal → interceptor and mount in user-client and admin-client. **WS-B** (Tasks 8–11): matrix un-gate + `probeServer` wiring → server-linking page + account-link store migration → Add a device (pairing codes) → server-synced passkey callers. Task 12 closes with STATUS + full gates. Spec: `superpowers/specs/2026-07-02-ws-b-e-onboarding-and-step-up-design.md` (v2, Laura-passed).

**Tech Stack:** TypeScript strict, Hono + Drizzle + ioredis (auth-service, Bun test), `@serenity-kit/opaque`, WebAuthn (raw `navigator.credentials`), Zustand v5, React 18, Vitest + Testing Library (clients, ui-shared), `qrcode`, pnpm + Turborepo.

## Operating rules for the overnight worker (READ FIRST)

These rules are binding and override your defaults. The repo's CLAUDE.md may
not be in your context — everything you need is in this section.

1. **STOP-guard — verify the base before touching anything.** All of these must
   hold, or STOP immediately, change nothing, and report:
   - `STATUS-TRANSITION.md` exists at the repo root (you are based on the
     `full-backend-transition` sprint branch, not master);
   - `superpowers/specs/2026-07-02-ws-b-e-onboarding-and-step-up-design.md` exists;
   - `packages/crypto/src/flows/step-up.ts` does NOT exist (the work is not
     already done).
2. **Mid-plan STOP-guard before Task 8 (WS-B needs WS-0).** WS-B consumes the
   WS-0 Foundation outputs. Before starting Task 8, verify
   `packages/ui-shared/src/state/discovery.store.ts` **and**
   `packages/ui-shared/src/state/account-link.store.ts` exist on your base. If
   they do not, WS-0 has not landed yet: **stop after Task 7, run the Task 12
   verification battery for what you built, and report WS-E as the complete
   deliverable.** Do not attempt to build WS-0 primitives yourself.
3. **Branch + integration target.** Work on a fresh branch cut from
   `full-backend-transition` (if your harness names the branch itself, accept
   its name). Any PR you open targets **`full-backend-transition` — NEVER
   `master`**. Do NOT merge anything yourself; the humans audit, device-test,
   and integrate.
4. **Language.** Every text artefact is British English — code, comments,
   tests, copy strings, commit messages (`initialise`, `behaviour`, `colour`).
   No German anywhere in the repo.
5. **TDD per task, in plan order.** Failing test → run it and confirm the
   exact expected failure → minimal implementation → confirm pass → commit.
   Tasks are ordered topologically over the import graph; do not reorder.
   If you dispatch subagents: one per task, review between tasks; subagents
   never merge, push, or switch branches.
6. **Commit convention.** Free-form imperative subject, capitalised, prefixed
   `E:` for Tasks 1–7 and `B:` for Tasks 8–11 (workstream markers, e.g.
   `E: Add step-up wire shapes to shared-types`). Footer on every commit:
   `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`.
7. **Gates — exact commands.** Per task, the commands the task names. At the
   end (Task 12), the FULL battery, never just touched dirs:
   `pnpm typecheck --force` (expect **14 successful, 14 total, 0 cached** —
   never trust a cached typecheck), `pnpm --filter @chatsundere/crypto test`,
   `pnpm --filter @chatsundere/ui-shared test`,
   `pnpm --filter @chatsundere/user-client test`,
   `pnpm --filter @chatsundere/admin-client test`,
   `pnpm --filter @chatsundere/auth-service test` (see rule 8), and
   `pnpm build`. Biome **bans non-null assertions (`!`)** and is the
   pre-commit hook; run
   `pnpm exec biome check <touched files>` before committing, not after.
8. **auth-service tests are environment-gated.** Integration tests
   `describe.skipIf(!process.env.DATABASE_URL || !process.env.REDIS_URL)`.
   If Docker is available, bring the dev databases up first and run with env:
   `docker compose -f infra/docker-compose.dev.yml up -d postgres redis`, then
   `DATABASE_URL=postgres://chatsundere:chatsundere@localhost:5432/chatsundere REDIS_URL=redis://localhost:6379 pnpm --filter @chatsundere/auth-service test`
   (check `infra/docker-compose.dev.yml` for the actual credentials and ports
   before assuming these). If no Docker/DB is available, run the suite anyway
   (skips are fine), note **exactly which test files skipped** in your report,
   and never claim skipped tests as passing.
9. **Known-green baseline.** The user-client vitest suite has a known
   environmental baseline on some hosts: exactly **8 failures** from a trio of
   Node-26 experimental-localStorage tests. **0 or exactly 8** are both
   acceptable; any other failure count is a regression you introduced. Never
   claim a failure is "pre-existing" without confirming it fails identically
   on the base branch.
10. **Audit gates are NOT yours to run.** This plan deliberately touches
    `apps/auth-service` and `packages/crypto` — Larissa (security) audits the
    diff AFTER your run, before squash; Laura (UX) likewise. Do not attempt
    any audit yourself; build exactly what the plan says.
11. **Scope guard.** Never touch
    `apps/user-client/src/boot/client-data-db.ts` (the next Dexie version is
    reserved for the sync engine), `apps/user-client/src/lib/cors-proxy.ts`,
    `apps/user-client/src/lib/transport.ts`,
    `apps/user-client/src/lib/mcp-client.ts`, anything under
    `apps/sync-service` or `apps/proxy-service`.
12. **End of run.** Complete Task 12 (STATUS update) as your final commit, then
    report back: every verification number (all suites, typecheck, build,
    Biome — with the baselines from rules 8–9 noted), the list of commits on
    your branch, and anything you could not do, stated honestly. Do not paper
    over a failing gate.

## Global Constraints

- **Base branch:** `full-backend-transition` — branch off it and PR back into it, NEVER master.
- Every text artefact in British English (code, comments, tests, commit messages).
- SPDX headers, first line of every new file, matching siblings: `AGPL-3.0-only` in `apps/*`, `LGPL-3.0-only` in `packages/crypto` and `packages/ui-shared`, `MIT` in `packages/shared-types`.
- TS `strict` + `noUncheckedIndexedAccess`. Biome is the pre-commit gate and it **bans non-null assertions (`!`)** — never write one.
- ESM relative imports carry the `.js` suffix (house style, see any existing import).
- User-facing strings live ONLY in the copy catalogues (`apps/user-client/src/lib/copy.ts`, `apps/admin-client/src/copy.ts`) — never inline in components/hooks. `packages/ui-shared` components receive copy via props (precedent: `ConfirmTyped`).
- No tokens or step-up state in `localStorage`/`sessionStorage`. Passphrases live only in function arguments and component state, never in stores.
- Wire fact (server, already built): gated endpoints reject `403` with envelope `{ error: { code: 'step_up_required', message, tier: <number 1|3|4> } }`. The step-up round errors are `400 no_passkey`, `401 webauthn_uv_required`, `401 opaque_authentication_failed`, `410 session_expired`, `429 rate_limit_exceeded`.
- Test placement: `apps/auth-service/tests/{unit,integration}/**` (bun:test), `packages/crypto/tests/**` (bun:test), `packages/ui-shared/tests/**` and `apps/user-client/tests/**` and `apps/admin-client/tests/**` (vitest, `include: tests/**/*.test.{ts,tsx}`).
- After changing a `packages/*` file, downstream typechecks may see stale `dist/` — always gate with `pnpm typecheck --force` from the repo root (expect **14/14 successful**), never a bare cached `pnpm typecheck`.

---

# Part I — WS-E: the step-up vertical

### Task 1: Step-up wire shapes in `packages/shared-types`

**Files:**
- Create: `packages/shared-types/src/step-up.ts`
- Modify: `packages/shared-types/src/index.ts` (append export)

**Interfaces:**
- Consumes: `@simplewebauthn/types` (already a dependency of shared-types).
- Produces: `StepUpTier` (`'t1' | 't3' | 't4'`), `StepUpMechanism`, `StepUpStartRequest`, `StepUpStartResponse` (union of `StepUpStartWebAuthnResponse` | `StepUpStartOpaqueResponse`), `StepUpFinishRequest`, `StepUpFinishResponse`. Tasks 4, 5, 6, 7 rely on these exact names from `@chatsundere/shared-types`.

- [ ] **Step 1: Write the type module**

`packages/shared-types/src/step-up.ts`:

```ts
// SPDX-License-Identifier: MIT

import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/types';

/**
 * Step-up tiers accepted by POST /api/v1/auth/step-up/start (ADR 0027).
 * t2 is reserved with no enforcing endpoint; t0 is not a step-up tier.
 */
export type StepUpTier = 't1' | 't3' | 't4';

/** Step-up mechanisms per ADR 0027: A (WebAuthn UV=required) and B (OPAQUE). */
export type StepUpMechanism = 'webauthn' | 'opaque';

/** Request body for `POST /api/v1/auth/step-up/start` (bearer-authorised). */
export interface StepUpStartRequest {
  mechanism: StepUpMechanism;
  tier_requested: StepUpTier;
  /** base64url OPAQUE KE1 — required for mechanism=opaque. */
  login_request?: string;
}

/** Response for mechanism=webauthn start. */
export interface StepUpStartWebAuthnResponse {
  session_id: string;
  mechanism: 'webauthn';
  options: PublicKeyCredentialRequestOptionsJSON;
}

/** Response for mechanism=opaque start. */
export interface StepUpStartOpaqueResponse {
  session_id: string;
  mechanism: 'opaque';
  /** base64url OPAQUE KE2. */
  login_response: string;
}

export type StepUpStartResponse = StepUpStartWebAuthnResponse | StepUpStartOpaqueResponse;

/** Request body for `POST /api/v1/auth/step-up/finish` (no bearer — round-state bound). */
export interface StepUpFinishRequest {
  mechanism: StepUpMechanism;
  session_id: string;
  /** @simplewebauthn assertion envelope — required for mechanism=webauthn. */
  assertion?: AuthenticationResponseJSON;
  /** base64url OPAQUE KE3 — required for mechanism=opaque. */
  login_evidence?: string;
}

/** Success response of `POST /api/v1/auth/step-up/finish`. */
export interface StepUpFinishResponse {
  tier_confirmed: StepUpTier;
  expires_at: string;
}
```

- [ ] **Step 2: Export from the package index**

In `packages/shared-types/src/index.ts`, append (matching the existing `export * from './linking.js';` style):

```ts
export * from './step-up.js';
```

- [ ] **Step 3: Gate**

Run: `pnpm typecheck --force`
Expected: 14 successful, 14 total, 0 cached.

- [ ] **Step 4: Commit**

```bash
git add packages/shared-types/src/step-up.ts packages/shared-types/src/index.ts
git commit -m "E: Add step-up wire shapes to shared-types"
```

---

### Task 2: auth-service — t1 seeding on fresh evidence + recovery identifier fix

**Files:**
- Modify: `apps/auth-service/src/auth/step-up.ts` (add `seedStepUpKey`)
- Modify: `apps/auth-service/src/routes/step-up.ts:372-378` (delegate `setStepUpKey`)
- Modify: `apps/auth-service/src/routes/login.ts` (~line 238, opaque finish)
- Modify: `apps/auth-service/src/routes/join.ts` (~line 336 invitation finish, ~line 466 pairing finish)
- Modify: `apps/auth-service/src/routes/recovery.ts` (~line 175 authMethods insert + after tokens)
- Test: `apps/auth-service/tests/integration/step-up-seeding.test.ts`

**Interfaces:**
- Consumes: `tierGraceMs`/`GRACE_MS` and `StepUpTier` in `auth/step-up.ts`; `issueTokens(...).sessionId` (the access-token jti, `jwt/issue.ts:98`).
- Produces: `seedStepUpKey(sessionId: string, tier: StepUpTier): Promise<void>` exported from `apps/auth-service/src/auth/step-up.ts`. Task 3's tests rely on the key shape `step_up:<sessionId>:t<tier>`.

**Background (why):** Spec §4.1 — endpoints that cryptographically verify fresh OPAQUE or recovery-key evidence seed the t1 grace key, generalising ADR 0027's "the OPAQUE evidence *is* the step-up". Only t1, never t3/t4. Seed strictly after evidence verifies. Additionally, `recovery.ts` re-inserts the OPAQUE auth method **without** `opaqueClientIdentifier`, which bricks post-recovery step-up (`routes/step-up.ts:161` throws `400 no_opaque` when the column is NULL) — fix it here.

- [ ] **Step 1: Write the failing integration test**

`apps/auth-service/tests/integration/step-up-seeding.test.ts` — mirror the harness of `apps/auth-service/tests/integration/step-up.test.ts` (env-gated `describe.skipIf`, `createServer()`, real OPAQUE via `@serenity-kit/opaque` client, invitation minted by direct `pendingCodes` insert). Decode the jti from an access token with a local helper. Test skeleton (fill the join/login rounds by copying the working round-trip code from `step-up.test.ts` — it performs exactly these calls in its `beforeAll`):

```ts
// SPDX-License-Identifier: AGPL-3.0-only
//
// Verifies the t1 fresh-evidence seeding (WS-B+E spec §4.1):
// join/finish (invitation + pairing), opaque login/finish, and
// recovery/finish each seed step_up:<jti>:t1; nothing seeds t3/t4.
// Also verifies the recovery opaque_client_identifier fix: step-up
// mechanism=opaque still works after a recovery.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { client as opaqueClient, ready as opaqueReady } from '@serenity-kit/opaque';
import { generateCode, hashCode } from '../../src/codes/token.js';
import { closeDb, createDb } from '../../src/db/client.js';
import { pendingCodes } from '../../src/db/schema.js';
import { createRedis } from '../../src/redis/client.js';
import { createServer } from '../../src/server.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;

/** Reads the jti claim out of a JWS access token without verifying it. */
function jtiOf(accessToken: string): string {
  const payload = accessToken.split('.')[1] ?? '';
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { jti?: string };
  if (!claims.jti) throw new Error('access token has no jti');
  return claims.jti;
}

describe.skipIf(skip)('t1 seeding on fresh evidence', () => {
  const redis = createRedis();
  let app: ReturnType<typeof createServer>;

  beforeAll(async () => {
    await opaqueReady;
    app = createServer();
  });

  afterAll(async () => {
    await closeDb();
  });

  it('seeds t1 (and only t1) after an invitation join', async () => {
    // ... invitation mint + full OPAQUE registration + /join/start + /join/finish
    // exactly as in step-up.test.ts beforeAll; capture the response JSON.
    // const joined = await ...;
    const jti = jtiOf(joined.access_token);
    expect(await redis.get(`step_up:${jti}:t1`)).not.toBeNull();
    expect(await redis.get(`step_up:${jti}:t3`)).toBeNull();
    expect(await redis.get(`step_up:${jti}:t4`)).toBeNull();
  });

  it('seeds t1 after an OPAQUE login', async () => {
    // ... full OPAQUE login round (login/start + login/finish) for the user
    // created above; capture the response JSON.
    const jti = jtiOf(loggedIn.access_token);
    expect(await redis.get(`step_up:${jti}:t1`)).not.toBeNull();
  });

  it('seeds t1 after a pairing join', async () => {
    // Seed the owner's t1 key directly (Task 3 gates pairing-code creation):
    //   await redis.set(`step_up:${ownerJti}:t1`, String(Date.now()), 'EX', 120);
    // POST /api/v1/me/pairing-codes with the owner's bearer, then run the
    // pairing join OPAQUE round from the "new device" (join/start kind=pairing
    // + join/finish with login_evidence) as in join-pairing.test.ts.
    const jti = jtiOf(paired.access_token);
    expect(await redis.get(`step_up:${jti}:t1`)).not.toBeNull();
  });

  it('seeds t1 after recovery, and step-up opaque still works post-recovery', async () => {
    // The test controls recovery_verifier_key at join time, so it can compute
    // the recovery proof itself: proof = HMAC-SHA-256(verifier_key,
    // nonce || username || 0x00 || `${API_BASE_URL}/v1`).
    // 1. Join a fresh user, supplying a random 32-byte recovery_verifier_key
    //    kept in the test.
    // 2. POST /api/v1/recovery/start { username, registration_request } for a
    //    NEW passphrase → { session_id, nonce, ... }.
    // 3. Compute the proof with WebCrypto HMAC, finish the fresh OPAQUE
    //    registration round, POST /api/v1/recovery/finish.
    const jti = jtiOf(recovered.access_token);
    expect(await redis.get(`step_up:${jti}:t1`)).not.toBeNull();

    // Regression guard for the opaque_client_identifier fix: a step-up
    // start with mechanism=opaque must NOT return 400 no_opaque.
    const startRes = await app.request('/api/v1/auth/step-up/start', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${recovered.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        mechanism: 'opaque',
        tier_requested: 't1',
        login_request: (await opaqueClient.startLogin({ password: 'new-pass' })).startLoginRequest,
      }),
    });
    expect(startRes.status).toBe(200);
  });
});
```

The `// ...` blocks above are join/login round-trips that already exist verbatim in `step-up.test.ts` and `join-pairing.test.ts` — copy them, do not invent new shapes. Check `recovery.ts:150-160` for the exact proof message layout before writing the HMAC (it is `nonce || username || 0x00 || serverId`).

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL=... REDIS_URL=... pnpm --filter @chatsundere/auth-service test tests/integration/step-up-seeding.test.ts`
Expected: FAIL — `expect(received).not.toBeNull()` on the t1 key (no seeding exists yet). If env vars are unavailable, the file skips — note it and still verify Step 4 via the existing suites + typecheck.

- [ ] **Step 3: Implement**

(a) `apps/auth-service/src/auth/step-up.ts` — add below `tierGraceMs`:

```ts
/**
 * Writes the per-session step-up confirmation key
 * (`step_up:<sessionId>:t<tier>`) with the current millisecond timestamp and
 * the tier's grace TTL. Called by POST /api/v1/auth/step-up/finish on
 * explicit confirmation, and by the fresh-evidence seed points (OPAQUE
 * login, join, recovery) for Tier 1 only — WS-B+E spec §4.1. t3/t4 are
 * never seeded from evidence; operators always step up explicitly.
 */
export async function seedStepUpKey(sessionId: string, tier: StepUpTier): Promise<void> {
  const graceMs = GRACE_MS[tier];
  const redis = createRedis();
  await redis.set(`step_up:${sessionId}:t${tier}`, String(Date.now()), 'EX', Math.ceil(graceMs / 1000));
}
```

(b) `apps/auth-service/src/routes/step-up.ts` — replace the body of `setStepUpKey` (lines 372–378) with a delegation so there is exactly one key-writer:

```ts
async function setStepUpKey(sessionIdUser: string, tier: AcceptedStartTier): Promise<void> {
  await seedStepUpKey(sessionIdUser, numericTierFor(tier));
}
```

Add `seedStepUpKey` to the existing `import { type StepUpTier, tierGraceMs } from '../auth/step-up.js';` line. Remove the now-unused `createRedis` import **only if** nothing else in the file uses it (the round-state code does — it stays).

(c) Seed calls — one line each, immediately after the `issueTokens` call, before the audit write:

- `apps/auth-service/src/routes/login.ts` (opaque finish, after line ~238):
  ```ts
  // Fresh OPAQUE evidence seeds the Tier-1 grace window (spec §4.1).
  await seedStepUpKey(tokens.sessionId, 1);
  ```
  Do **NOT** add this to the passkey login finish — a UV='preferred' assertion is not Tier-1 evidence.
- `apps/auth-service/src/routes/join.ts` — same line in `finishInvitation` (after `issueTokens`, ~line 336) and `finishPairing` (~line 466).
- `apps/auth-service/src/routes/recovery.ts` — after the transaction returns `tokens`:
  ```ts
  // Fresh recovery-key evidence seeds the Tier-1 grace window (spec §4.1).
  await seedStepUpKey(tokens.sessionId, 1);
  ```

Each file imports: `import { seedStepUpKey } from '../auth/step-up.js';`

(d) Recovery identifier fix — in `recovery.ts`, the `tx.insert(authMethods).values({...})` block gains one line beside `opaqueUserIdentifier`:

```ts
        // Freeze the registration-time username so post-recovery OPAQUE
        // login and step-up keep working after a later rename (mirrors the
        // join path; without it step-up /start returns 400 no_opaque).
        opaqueClientIdentifier: body.username,
```

- [ ] **Step 4: Run to verify it passes**

Run: the Step 2 command again.
Expected: PASS (or documented skip). Also run the neighbouring suites you touched:
`DATABASE_URL=... REDIS_URL=... pnpm --filter @chatsundere/auth-service test`
Expected: same pass/fail baseline as the base branch plus the new file (the suite has 9 known `full-lifecycle.test.ts` baseline failures — see STATUS-BACKEND; do not chase them).

- [ ] **Step 5: Commit**

```bash
git add apps/auth-service/src apps/auth-service/tests/integration/step-up-seeding.test.ts
git commit -m "E: Seed t1 step-up grace on fresh OPAQUE and recovery evidence"
```

---

### Task 3: auth-service — enforce step-up on the four ungated endpoints

**Files:**
- Modify: `apps/auth-service/src/routes/link.ts:36` (`/link/passkey/start`, tier 1)
- Modify: `apps/auth-service/src/routes/me.ts:108` (`DELETE /me`, tier 3), `me.ts:141` (`DELETE /auth-methods/:id`, tier 1), `me.ts:175` (`passphrase/change/start`, tier 1)
- Test: `apps/auth-service/tests/integration/step-up-enforcement.test.ts`

**Interfaces:**
- Consumes: `requireStepUp({ sessionId, tier })` from `../auth/step-up.js` (existing); `c.get('sessionId')` set by `bearerAuth()` (see `me-pairing-codes.ts:32` for the exact call pattern).
- Produces: `403 step_up_required` (envelope `error.tier` numeric) on the four endpoints without a fresh key. Tasks 6/7 interceptor tests rely on this envelope.

`/link/passkey/finish` and `passphrase/change/finish` stay ungated — each is bound to its gated `/start` via single-use Redis round state (spec §4).

- [ ] **Step 1: Write the failing test**

`apps/auth-service/tests/integration/step-up-enforcement.test.ts` — same harness pattern as Task 2 (env-gated; one user created via invitation join in `beforeAll`; **delete the join-seeded t1 key** in `beforeEach` so tests start ungated):

```ts
// SPDX-License-Identifier: AGPL-3.0-only
//
// Verifies the WS-B+E spec §4 enforcement table: Tier 1 on
// link/passkey/start, auth-methods DELETE, passphrase-change start;
// Tier 3 on DELETE /me. Each endpoint 403s without a key and proceeds
// with a seeded key.

import { beforeEach, describe, expect, it } from 'bun:test';
// ... shared setup imports as in Task 2; create user + accessToken + jti in beforeAll.

describe.skipIf(skip)('step-up enforcement', () => {
  beforeEach(async () => {
    await redis.del(`step_up:${jti}:t1`, `step_up:${jti}:t3`);
  });

  async function expectStepUpRequired(res: Response, tier: number): Promise<void> {
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; tier: number } };
    expect(body.error.code).toBe('step_up_required');
    expect(body.error.tier).toBe(tier);
  }

  it('gates POST /api/v1/link/passkey/start at tier 1', async () => {
    const bare = await app.request('/api/v1/link/passkey/start', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    await expectStepUpRequired(bare, 1);

    await redis.set(`step_up:${jti}:t1`, String(Date.now()), 'EX', 120);
    const seeded = await app.request('/api/v1/link/passkey/start', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(seeded.status).toBe(200); // returns { session_id, options }
  });

  it('gates POST /api/v1/auth-methods/passphrase/change/start at tier 1', async () => {
    const { registrationRequest } = await opaqueClient.startRegistration({ password: 'next-pass' });
    const call = () =>
      app.request('/api/v1/auth-methods/passphrase/change/start', {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ registration_request: registrationRequest }),
      });
    await expectStepUpRequired(await call(), 1);
    await redis.set(`step_up:${jti}:t1`, String(Date.now()), 'EX', 120);
    expect((await call()).status).toBe(200);
  });

  it('gates DELETE /api/v1/auth-methods/:id at tier 1', async () => {
    // Insert a second (throwaway) auth-method row directly via drizzle so the
    // delete does not trip the lockout guard, then delete it.
    // ... db.insert(authMethods).values({ userId, methodType: 'passkey', ... });
    await expectStepUpRequired(
      await app.request(`/api/v1/auth-methods/${throwawayId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      1,
    );
    await redis.set(`step_up:${jti}:t1`, String(Date.now()), 'EX', 120);
    const ok = await app.request(`/api/v1/auth-methods/${throwawayId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(ok.status).toBe(200);
  });

  it('gates DELETE /api/v1/me at tier 3 — run LAST, destroys the user', async () => {
    await expectStepUpRequired(
      await app.request('/api/v1/me', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${accessToken}` },
      }),
      3,
    );
    await redis.set(`step_up:${jti}:t3`, String(Date.now()), 'EX', 10);
    const ok = await app.request('/api/v1/me', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(ok.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL=... REDIS_URL=... pnpm --filter @chatsundere/auth-service test tests/integration/step-up-enforcement.test.ts`
Expected: FAIL — the bare calls return 200/400, not 403.

- [ ] **Step 3: Implement**

Four one-liners, each placed immediately after the `claims` read at the top of the handler, matching `me-pairing-codes.ts:30-32` exactly:

```ts
    const sessionId = c.get('sessionId') as string;
    await requireStepUp({ sessionId, tier: 1 }); // tier: 3 for DELETE /me
```

- `link.ts:36` handler (`/link/passkey/start`) — tier 1. Add `import { requireStepUp } from '../auth/step-up.js';`
- `me.ts:108` handler (`DELETE /me`) — tier 3.
- `me.ts:141` handler (`DELETE /auth-methods/:id`) — tier 1.
- `me.ts:175` handler (`passphrase/change/start`) — tier 1.
- `me.ts` adds `import { requireStepUp } from '../auth/step-up.js';`

- [ ] **Step 4: Run to verify it passes**

Run: the Step 2 command, then the whole auth-service suite.
Expected: new file PASS; baseline unchanged elsewhere. **Check specifically** that `tests/integration/join-pairing.test.ts` and `tests/integration/pairing-codes.test.ts` still pass — they exercise `me/pairing-codes` after a join, and Task 2's join-seed now legitimately satisfies that gate.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-service/src apps/auth-service/tests/integration/step-up-enforcement.test.ts
git commit -m "E: Enforce step-up tiers on passkey-link, auth-method removal, passphrase change and account delete"
```

---

### Task 4: `packages/crypto` — step-up ceremony flows

**Files:**
- Modify: `packages/crypto/src/server-client.ts` (two new methods)
- Create: `packages/crypto/src/flows/step-up.ts`
- Modify: `packages/crypto/src/index.ts` (export flow functions + outcome types)
- Test: `packages/crypto/tests/flows/step-up.test.ts`

**Interfaces:**
- Consumes: `StepUpStartRequest`/`StepUpStartResponse`/`StepUpFinishRequest`/`StepUpFinishResponse`/`StepUpTier` (Task 1); `opaqueLoginStart`/`opaqueLoginFinish` (`opaque/client.ts`); `getLinkedAccount` (`db/linked-account.ts`), `getLocalAccount` (`db/local-account.ts`); `toBase64Url` (`encoding/base64url.ts`).
- Produces (Tasks 6/7 rely on these exact signatures, exported from `@chatsundere/crypto`):
  ```ts
  type PasskeyStepUpOutcome = 'confirmed' | 'no_passkey' | 'uv_required' | 'failed';
  type PassphraseStepUpOutcome = 'confirmed' | 'wrong_passphrase' | 'failed';
  stepUpWithPasskey(args: { db: IDBDatabase; serverClient: ServerClient; accessToken: string; tier: StepUpTier; getAssertion(options: PublicKeyCredentialRequestOptionsJSON): Promise<AuthenticationResponseJSON> }): Promise<PasskeyStepUpOutcome>
  stepUpWithPassphrase(args: { db: IDBDatabase; serverClient: ServerClient; accessToken: string; tier: StepUpTier; passphrase: string }): Promise<PassphraseStepUpOutcome>
  ```
  And on `ServerClient`:
  ```ts
  stepUpStart(req: StepUpStartRequest, baseUrl: string, accessToken: string): Promise<StepUpStartResponse>;
  stepUpFinish(req: StepUpFinishRequest, baseUrl: string): Promise<StepUpFinishResponse>;
  ```

- [ ] **Step 1: Write the failing test**

`packages/crypto/tests/flows/step-up.test.ts` (bun:test; mirror the DB-seeding pattern of `tests/flows/login-online-linked.test.ts` — `openLocalDb`, `createLocalAccount`, `putLinkedAccount` with its `LINKED_ROW` fixture shape; mock `ServerClient` with `Object.assign(new Error(...), { status, code })` errors, which is how the app's `HttpError` duck-types):

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { beforeEach, describe, expect, it } from 'bun:test';
import { putLinkedAccount } from '../../src/db/linked-account.js';
import { openLocalDb } from '../../src/db/open.js';
import { createLocalAccount } from '../../src/flows/create-local-account.js';
import { stepUpWithPasskey, stepUpWithPassphrase } from '../../src/flows/step-up.js';
import type { ServerClient } from '../../src/server-client.js';

const DB = 'chatsundere-test-step-up';

// Reuse the LINKED_ROW fixture shape from login-online-linked.test.ts verbatim.

function httpError(status: number, code: string): Error {
  return Object.assign(new Error(code), { status, code });
}

/** Structurally-valid AuthenticationResponseJSON for tests that never verify it. */
const FAKE_ASSERTION = {
  id: 'Y3JlZC1pZA',
  rawId: 'Y3JlZC1pZA',
  type: 'public-key' as const,
  response: {
    clientDataJSON: 'e30',
    authenticatorData: 'AAAA',
    signature: 'AAAA',
  },
  clientExtensionResults: {},
};

/** ServerClient stub whose step-up members are configurable; all others throw. */
function makeServerClient(overrides: Partial<ServerClient>): ServerClient {
  const reject = () => {
    throw new Error('unexpected server call');
  };
  return {
    joinStart: reject, joinFinish: reject, linkPasskeyStart: reject, linkPasskeyFinish: reject,
    loginOpaqueStart: reject, loginOpaqueFinish: reject, recoveryStart: reject,
    recoveryFinish: reject, deleteMe: reject, passphraseChangeStart: reject,
    passphraseChangeFinish: reject,
    stepUpStart: reject, stepUpFinish: reject,
    ...overrides,
  } as ServerClient;
}

describe('stepUpWithPasskey', () => {
  let db: IDBDatabase;
  beforeEach(async () => {
    indexedDB.deleteDatabase(DB);
    db = await openLocalDb(DB);
    await createLocalAccount({ db, username: 'casey', passphrase: 'a-long-passphrase' });
    await putLinkedAccount(db, LINKED_ROW);
  });

  it("returns 'no_passkey' when start rejects with the no_passkey code", async () => {
    const sc = makeServerClient({
      stepUpStart: async () => { throw httpError(400, 'no_passkey'); },
    });
    const outcome = await stepUpWithPasskey({
      db, serverClient: sc, accessToken: 'tok', tier: 't1',
      getAssertion: async () => { throw new Error('must not be called'); },
    });
    expect(outcome).toBe('no_passkey');
  });

  it("returns 'uv_required' when finish rejects with webauthn_uv_required", async () => {
    const sc = makeServerClient({
      stepUpStart: async () => ({
        session_id: 'round-1', mechanism: 'webauthn' as const,
        options: { challenge: 'Y2hhbGxlbmdl', rpId: 'example.com' },
      }),
      stepUpFinish: async () => { throw httpError(401, 'webauthn_uv_required'); },
    });
    const outcome = await stepUpWithPasskey({
      db, serverClient: sc, accessToken: 'tok', tier: 't1',
      getAssertion: async () => FAKE_ASSERTION, // any structurally-valid AuthenticationResponseJSON literal
    });
    expect(outcome).toBe('uv_required');
  });

  it("returns 'confirmed' when finish succeeds", async () => { /* stepUpFinish resolves { tier_confirmed: 't1', expires_at: '...' } → expect 'confirmed' */ });
  it("returns 'failed' when the assertion callback throws (user abort)", async () => { /* getAssertion throws DOMException → 'failed', stepUpFinish never called */ });
});

describe('stepUpWithPassphrase', () => {
  // Same beforeEach.
  it("returns 'wrong_passphrase' on opaque_authentication_failed from finish", async () => {
    // stepUpStart resolves { session_id, mechanism: 'opaque', login_response: <real KE2> } —
    // produce the KE2 with @serenity-kit/opaque's server against a registration record
    // created for the same passphrase, exactly as join-by-pairing.test.ts's mock does.
    // stepUpFinish throws httpError(401, 'opaque_authentication_failed').
  });
  it("returns 'wrong_passphrase' when the client-side OPAQUE round rejects the KE2 (CryptoError wrong_passphrase)", async () => { /* KE2 for a DIFFERENT passphrase */ });
  it("returns 'confirmed' on a full successful round", async () => { /* real OPAQUE server mock, stepUpFinish resolves */ });
  it("returns 'failed' when no linked account exists", async () => { /* skip putLinkedAccount → 'failed', no server call */ });
});
```

Build the real-OPAQUE server mock by copying the pattern from `packages/crypto/tests/flows/join-by-pairing.test.ts` (it registers a record for a known passphrase and answers `startLogin` server-side). The step-up client identifiers are `client: <local username>`, `server: `${LINKED_ROW.base_url}/auth/v1`` — the mock must register with the same pair or the ok-path test will fail for the wrong reason.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chatsundere/crypto test tests/flows/step-up.test.ts`
Expected: FAIL — `flows/step-up.js` does not exist.

- [ ] **Step 3: Implement**

(a) `packages/crypto/src/server-client.ts` — extend the import type list with `StepUpFinishRequest, StepUpFinishResponse, StepUpStartRequest, StepUpStartResponse` and append to the interface:

```ts
  stepUpStart(
    req: StepUpStartRequest,
    baseUrl: string,
    accessToken: string,
  ): Promise<StepUpStartResponse>;
  stepUpFinish(req: StepUpFinishRequest, baseUrl: string): Promise<StepUpFinishResponse>;
```

**Ripple:** every existing `ServerClient` literal must add the two members or typecheck breaks — `apps/user-client/src/lib/server-client.ts` and `apps/admin-client/src/lib/server-client.ts` get real implementations in Tasks 6/7; **in this task** add them to the app clients already (the Task 6/7 code below shows the exact bodies — copy them from there), and to every test mock in `packages/crypto/tests/**` that builds a full `ServerClient` (add `stepUpStart: reject, stepUpFinish: reject`).

(b) `packages/crypto/src/flows/step-up.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only

import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
  StepUpTier,
} from '@chatsundere/shared-types';
import { getLinkedAccount } from '../db/linked-account.js';
import { getLocalAccount } from '../db/local-account.js';
import { toBase64Url } from '../encoding/base64url.js';
import { CryptoError } from '../errors.js';
import { opaqueLoginFinish, opaqueLoginStart } from '../opaque/client.js';
import type { ServerClient } from '../server-client.js';

export type PasskeyStepUpOutcome = 'confirmed' | 'no_passkey' | 'uv_required' | 'failed';
export type PassphraseStepUpOutcome = 'confirmed' | 'wrong_passphrase' | 'failed';

export interface StepUpWithPasskeyArgs {
  db: IDBDatabase;
  serverClient: ServerClient;
  accessToken: string;
  tier: StepUpTier;
  /** Drives navigator.credentials.get() — injected so this flow stays DOM-free. */
  getAssertion(options: PublicKeyCredentialRequestOptionsJSON): Promise<AuthenticationResponseJSON>;
}

/**
 * Step-up Mechanism A (ADR 0027): fresh WebAuthn assertion with UV required.
 * Returns a discriminated outcome instead of throwing — the modal maps
 * 'no_passkey' and 'uv_required' onto the silent fall-through to Mechanism B.
 */
export async function stepUpWithPasskey(args: StepUpWithPasskeyArgs): Promise<PasskeyStepUpOutcome> {
  const linked = await getLinkedAccount(args.db);
  if (!linked) return 'failed';

  let start;
  try {
    start = await args.serverClient.stepUpStart(
      { mechanism: 'webauthn', tier_requested: args.tier },
      linked.base_url,
      args.accessToken,
    );
  } catch (err) {
    return codeOf(err) === 'no_passkey' ? 'no_passkey' : 'failed';
  }
  if (start.mechanism !== 'webauthn') return 'failed';

  let assertion: AuthenticationResponseJSON;
  try {
    assertion = await args.getAssertion(start.options);
  } catch {
    // User abort or authenticator error — the caller decides what to show.
    return 'failed';
  }

  try {
    await args.serverClient.stepUpFinish(
      { mechanism: 'webauthn', session_id: start.session_id, assertion },
      linked.base_url,
    );
    return 'confirmed';
  } catch (err) {
    return codeOf(err) === 'webauthn_uv_required' ? 'uv_required' : 'failed';
  }
}

export interface StepUpWithPassphraseArgs {
  db: IDBDatabase;
  serverClient: ServerClient;
  accessToken: string;
  tier: StepUpTier;
  passphrase: string;
}

/**
 * Step-up Mechanism B (ADR 0027): a fresh OPAQUE round on the existing
 * session. No username crosses the wire — the server binds the round to the
 * bearer; the client identifiers mirror login-online-linked exactly
 * (local_account.username + `${base_url}/auth/v1`).
 */
export async function stepUpWithPassphrase(
  args: StepUpWithPassphraseArgs,
): Promise<PassphraseStepUpOutcome> {
  const linked = await getLinkedAccount(args.db);
  const local = await getLocalAccount(args.db);
  if (!linked || !local) return 'failed';
  const serverIdentity = `${linked.base_url}/auth/v1`;

  try {
    const { clientLoginState, startLoginRequest } = await opaqueLoginStart(args.passphrase);
    const start = await args.serverClient.stepUpStart(
      { mechanism: 'opaque', tier_requested: args.tier, login_request: startLoginRequest },
      linked.base_url,
      args.accessToken,
    );
    if (start.mechanism !== 'opaque') return 'failed';

    const finish = await opaqueLoginFinish({
      clientLoginState,
      loginResponse: start.login_response,
      passphrase: args.passphrase,
      username: local.username,
      serverIdentity,
    });

    await args.serverClient.stepUpFinish(
      {
        mechanism: 'opaque',
        session_id: start.session_id,
        login_evidence: toBase64Url(finish.finishLoginRequest),
      },
      linked.base_url,
    );
    return 'confirmed';
  } catch (err) {
    if (err instanceof CryptoError && err.code === 'wrong_passphrase') return 'wrong_passphrase';
    if (codeOf(err) === 'opaque_authentication_failed') return 'wrong_passphrase';
    return 'failed';
  }
}

/**
 * Reads the wire error code from an injected server-client error. Duck-typed
 * — the crypto package must not know the apps' HttpError class.
 */
function codeOf(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}
```

(c) `packages/crypto/src/index.ts` — export beside the other flows:

```ts
export {
  stepUpWithPasskey,
  stepUpWithPassphrase,
  type PasskeyStepUpOutcome,
  type PassphraseStepUpOutcome,
  type StepUpWithPasskeyArgs,
  type StepUpWithPassphraseArgs,
} from './flows/step-up.js';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @chatsundere/crypto test` then `pnpm typecheck --force`
Expected: crypto suite green (all pre-existing files too — the `ServerClient` ripple in test mocks is part of this task); typecheck 14/14.

- [ ] **Step 5: Commit**

```bash
git add packages/crypto apps/user-client/src/lib/server-client.ts apps/admin-client/src/lib/server-client.ts
git commit -m "E: Add step-up ceremony flows and ServerClient step-up methods"
```

---

### Task 5: `packages/ui-shared` — step-up controller store + `StepUpModal`

**Files:**
- Create: `packages/ui-shared/src/state/step-up.store.ts`
- Create: `packages/ui-shared/src/components/StepUpModal.tsx`
- Modify: `packages/ui-shared/src/index.ts` (exports)
- Test: `packages/ui-shared/tests/state/step-up.store.test.ts`
- Test: `packages/ui-shared/tests/components/StepUpModal.test.tsx`

**Interfaces:**
- Consumes: `StepUpTier` (Task 1); `PasskeyStepUpOutcome`/`PassphraseStepUpOutcome` types (Task 4).
- Produces (Tasks 6/7 rely on these):
  ```ts
  requestStepUp(tier: StepUpTier): Promise<boolean>          // module function, usable outside React
  useStepUpStore                                             // zustand store: { pending: { tier } | null }
  <StepUpModal passkeyAvailable onPasskey? onPassphrase copy />  // subscribes to the store itself
  interface StepUpModalCopy { title; bodyBoth; bodyPassphraseOnly; usePasskeyCta; usePassphraseCta; passphraseLabel; confirmCta; cancelCta; passkeyFailed; wrongPassphrase; genericError; busy }
  ```

- [ ] **Step 1: Write the failing store test**

`packages/ui-shared/tests/state/step-up.store.test.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import { requestStepUp, resolveStepUp, useStepUpStore } from '../../src/state/step-up.store.js';

describe('step-up store', () => {
  beforeEach(() => {
    useStepUpStore.setState({ pending: null });
  });

  it('opens one pending request and resolves true on confirm', async () => {
    const p = requestStepUp('t1');
    expect(useStepUpStore.getState().pending?.tier).toBe('t1');
    resolveStepUp(true);
    await expect(p).resolves.toBe(true);
    expect(useStepUpStore.getState().pending).toBeNull();
  });

  it('coalesces concurrent requests onto one pending gate', async () => {
    const a = requestStepUp('t1');
    const b = requestStepUp('t1');
    // Still exactly one pending request (spec §7.1).
    expect(useStepUpStore.getState().pending?.tier).toBe('t1');
    resolveStepUp(true);
    await expect(a).resolves.toBe(true);
    await expect(b).resolves.toBe(true);
  });

  it('resolves false on cancel and opens fresh afterwards', async () => {
    const a = requestStepUp('t3');
    resolveStepUp(false);
    await expect(a).resolves.toBe(false);
    const b = requestStepUp('t1');
    expect(useStepUpStore.getState().pending?.tier).toBe('t1');
    resolveStepUp(true);
    await expect(b).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chatsundere/ui-shared test tests/state/step-up.store.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the store**

`packages/ui-shared/src/state/step-up.store.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { StepUpTier } from '@chatsundere/shared-types';
import { create } from 'zustand';

interface PendingStepUp {
  tier: StepUpTier;
  resolvers: Array<(confirmed: boolean) => void>;
}

interface StepUpState {
  pending: PendingStepUp | null;
}

/**
 * Promise gate between the apiFetch interceptor (non-React) and the mounted
 * StepUpModal (React). One pending request at a time; concurrent callers
 * coalesce onto the same resolution (spec §7.1 — mixed-tier surfaces must
 * re-key this per tier before any Tier-3 user-client UI lands).
 */
export const useStepUpStore = create<StepUpState>(() => ({ pending: null }));

/** Requests a step-up confirmation; resolves true when the user confirmed. */
export function requestStepUp(tier: StepUpTier): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const { pending } = useStepUpStore.getState();
    if (pending) {
      pending.resolvers.push(resolve);
      return;
    }
    useStepUpStore.setState({ pending: { tier, resolvers: [resolve] } });
  });
}

/** Called by the modal on confirm (true) or cancel (false). */
export function resolveStepUp(confirmed: boolean): void {
  const { pending } = useStepUpStore.getState();
  if (!pending) return;
  useStepUpStore.setState({ pending: null });
  for (const resolve of pending.resolvers) resolve(confirmed);
}
```

- [ ] **Step 4: Store test passes**

Run: `pnpm --filter @chatsundere/ui-shared test tests/state/step-up.store.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing modal test**

`packages/ui-shared/tests/components/StepUpModal.test.tsx` (Testing Library is already a ui-shared devDependency; mirror the setup of the existing tests under `tests/components/`):

```tsx
// SPDX-License-Identifier: LGPL-3.0-only
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StepUpModal, type StepUpModalCopy } from '../../src/components/StepUpModal.js';
import { requestStepUp, useStepUpStore } from '../../src/state/step-up.store.js';

const COPY: StepUpModalCopy = {
  title: 'Confirm it’s you',
  bodyBoth: 'A quick re-check keeps your account safe.',
  bodyPassphraseOnly: 'Re-enter your passphrase to continue.',
  usePasskeyCta: 'Use passkey',
  usePassphraseCta: 'Use passphrase instead',
  passphraseLabel: 'Passphrase',
  confirmCta: 'Confirm',
  cancelCta: 'Cancel',
  passkeyFailed: 'Couldn’t verify with passkey. Try your passphrase.',
  wrongPassphrase: 'Wrong passphrase. Try again.',
  genericError: 'Something went wrong. Please try again.',
  busy: 'Checking…',
};

describe('StepUpModal', () => {
  beforeEach(() => useStepUpStore.setState({ pending: null }));
  afterEach(cleanup);

  it('renders nothing without a pending request', () => {
    render(<StepUpModal passkeyAvailable={false} onPassphrase={vi.fn()} copy={COPY} />);
    expect(screen.queryByText(COPY.title)).toBeNull();
  });

  it('passphrase-only: confirms via onPassphrase and resolves the gate true', async () => {
    const onPassphrase = vi.fn().mockResolvedValue('confirmed');
    render(<StepUpModal passkeyAvailable={false} onPassphrase={onPassphrase} copy={COPY} />);
    const gate = requestStepUp('t1');
    await screen.findByText(COPY.bodyPassphraseOnly);
    await userEvent.type(screen.getByLabelText(COPY.passphraseLabel), 'hunter2 correct horse');
    await userEvent.click(screen.getByRole('button', { name: COPY.confirmCta }));
    await expect(gate).resolves.toBe(true);
  });

  it('falls through silently from passkey to passphrase on uv_required', async () => {
    const onPasskey = vi.fn().mockResolvedValue('uv_required');
    render(
      <StepUpModal passkeyAvailable onPasskey={onPasskey} onPassphrase={vi.fn()} copy={COPY} />,
    );
    requestStepUp('t1');
    await userEvent.click(await screen.findByRole('button', { name: COPY.usePasskeyCta }));
    // Silent switch: passphrase view, no error notice (spec §7.2).
    await screen.findByLabelText(COPY.passphraseLabel);
    expect(screen.queryByText(COPY.passkeyFailed)).toBeNull();
  });

  it('shows wrongPassphrase and stays open on a wrong passphrase', async () => {
    const onPassphrase = vi.fn().mockResolvedValue('wrong_passphrase');
    render(<StepUpModal passkeyAvailable={false} onPassphrase={onPassphrase} copy={COPY} />);
    const gate = requestStepUp('t1');
    await userEvent.type(await screen.findByLabelText(COPY.passphraseLabel), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: COPY.confirmCta }));
    await screen.findByText(COPY.wrongPassphrase);
    // Gate is still pending.
    let settled = false;
    void gate.then(() => {
      settled = true;
    });
    await waitFor(() => expect(settled).toBe(false));
  });

  it('cancel resolves the gate false', async () => {
    render(<StepUpModal passkeyAvailable={false} onPassphrase={vi.fn()} copy={COPY} />);
    const gate = requestStepUp('t1');
    await userEvent.click(await screen.findByRole('button', { name: COPY.cancelCta }));
    await expect(gate).resolves.toBe(false);
  });
});
```

- [ ] **Step 6: Run to verify it fails, then implement the modal**

`packages/ui-shared/src/components/StepUpModal.tsx` (native `<dialog>` + imperative open/close + Esc→cancel, exactly like `ConfirmTyped.tsx`; unstyled-ish Tailwind kept minimal so both hosts look native to their theme):

```tsx
// SPDX-License-Identifier: LGPL-3.0-only

import type { PasskeyStepUpOutcome, PassphraseStepUpOutcome } from '@chatsundere/crypto';
import { useEffect, useRef, useState } from 'react';
import { resolveStepUp, useStepUpStore } from '../state/step-up.store.js';

export interface StepUpModalCopy {
  title: string;
  bodyBoth: string;
  bodyPassphraseOnly: string;
  usePasskeyCta: string;
  usePassphraseCta: string;
  passphraseLabel: string;
  confirmCta: string;
  cancelCta: string;
  passkeyFailed: string;
  wrongPassphrase: string;
  genericError: string;
  busy: string;
}

export interface StepUpModalProps {
  /** Whether a server-synced passkey exists — the admin-client passes false. */
  passkeyAvailable: boolean;
  onPasskey?: () => Promise<PasskeyStepUpOutcome>;
  onPassphrase: (passphrase: string) => Promise<PassphraseStepUpOutcome>;
  copy: StepUpModalCopy;
}

type View =
  | { kind: 'choice' }
  | { kind: 'passphrase'; notice: string | null }
  | { kind: 'busy' };

/**
 * The step-up confirmation modal (ADR 0027, step-up brief §UX Patterns).
 * Subscribes to the step-up store; mounts once per app root. Mechanism
 * handlers are injected so this component carries no crypto imports.
 * Method-agnostic, tier-agnostic copy; the silent A→B fall-through lives
 * here (no_passkey / uv_required never surface as errors — spec §7.2).
 */
export function StepUpModal({ passkeyAvailable, onPasskey, onPassphrase, copy }: StepUpModalProps) {
  const pending = useStepUpStore((s) => s.pending);
  const open = pending !== null;
  const canUsePasskey = passkeyAvailable && onPasskey !== undefined;

  const dialogRef = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<View>({ kind: 'choice' });
  const [passphrase, setPassphrase] = useState('');

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open) {
      setView(canUsePasskey ? { kind: 'choice' } : { kind: 'passphrase', notice: null });
      setPassphrase('');
      if (!el.open) el.showModal();
    } else if (el.open) {
      el.close();
    }
  }, [open, canUsePasskey]);

  function cancel() {
    resolveStepUp(false);
  }

  async function handlePasskey() {
    if (!onPasskey) return;
    setView({ kind: 'busy' });
    const outcome = await onPasskey();
    if (outcome === 'confirmed') {
      resolveStepUp(true);
      return;
    }
    // no_passkey / uv_required: silent fall-through; hard failure gets a notice.
    setView({
      kind: 'passphrase',
      notice: outcome === 'failed' ? copy.passkeyFailed : null,
    });
  }

  async function handlePassphrase() {
    if (passphrase.length === 0) return;
    setView({ kind: 'busy' });
    const outcome = await onPassphrase(passphrase);
    if (outcome === 'confirmed') {
      resolveStepUp(true);
      return;
    }
    setPassphrase('');
    setView({
      kind: 'passphrase',
      notice: outcome === 'wrong_passphrase' ? copy.wrongPassphrase : copy.genericError,
    });
  }

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-label={copy.title}
      onCancel={(e) => {
        e.preventDefault();
        cancel();
      }}
      className="w-full max-w-sm rounded-lg bg-inherit p-0 text-inherit backdrop:bg-black/50"
    >
      <div className="px-5 py-4">
        <h2 className="text-lg font-medium">{copy.title}</h2>

        {view.kind === 'choice' && (
          <>
            <p className="mt-1 text-sm opacity-80">{copy.bodyBoth}</p>
            <div className="mt-4 flex flex-col gap-2">
              <button type="button" onClick={() => void handlePasskey()} className="rounded-md px-4 py-2.5 text-sm font-medium ring-1 ring-inset ring-current">
                {copy.usePasskeyCta}
              </button>
              <button type="button" onClick={() => setView({ kind: 'passphrase', notice: null })} className="rounded-md px-4 py-2.5 text-sm opacity-80">
                {copy.usePassphraseCta}
              </button>
            </div>
          </>
        )}

        {view.kind === 'passphrase' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handlePassphrase();
            }}
          >
            <p className="mt-1 text-sm opacity-80">{copy.bodyPassphraseOnly}</p>
            {view.notice && (
              <p role="alert" className="mt-2 text-sm text-red-500">
                {view.notice}
              </p>
            )}
            <label className="mt-3 block text-xs font-medium uppercase tracking-wider opacity-70" htmlFor="step-up-passphrase">
              {copy.passphraseLabel}
            </label>
            <input
              id="step-up-passphrase"
              type="password"
              autoComplete="current-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="mt-1 w-full rounded-md bg-transparent px-3 py-2 ring-1 ring-inset ring-current/40 focus:outline-none"
            />
            <div className="mt-4 flex justify-end gap-3">
              <button type="button" onClick={cancel} className="rounded-md px-4 py-2 text-sm opacity-80">
                {copy.cancelCta}
              </button>
              <button type="submit" disabled={passphrase.length === 0} className="rounded-md px-4 py-2 text-sm font-medium ring-1 ring-inset ring-current disabled:opacity-40">
                {copy.confirmCta}
              </button>
            </div>
          </form>
        )}

        {view.kind === 'busy' && <p className="mt-3 text-sm opacity-80">{copy.busy}</p>}

        {view.kind === 'choice' && (
          <button type="button" onClick={cancel} className="mt-3 w-full rounded-md px-4 py-2 text-sm opacity-70">
            {copy.cancelCta}
          </button>
        )}
      </div>
    </dialog>
  );
}
```

`packages/ui-shared/src/index.ts` — append:

```ts
export { requestStepUp, resolveStepUp, useStepUpStore } from './state/step-up.store.js';
export { StepUpModal } from './components/StepUpModal.js';
export type { StepUpModalCopy, StepUpModalProps } from './components/StepUpModal.js';
```

Note: jsdom's `<dialog>` supports `showModal()` from jsdom 24; the existing `ConfirmTyped` tests prove the pattern works in this repo's setup. If a modal test fails on `showModal`, mirror whatever `tests/components/ConfirmTyped.test.tsx` (or nearest sibling) does.

- [ ] **Step 7: Run to verify it passes**

Run: `pnpm --filter @chatsundere/ui-shared test` and `pnpm typecheck --force`
Expected: ui-shared suite green; 14/14.

- [ ] **Step 8: Commit**

```bash
git add packages/ui-shared
git commit -m "E: Add step-up controller store and shared StepUpModal"
```

---

### Task 6: user-client — interceptor, ceremony wiring, modal host

**Files:**
- Modify: `apps/user-client/src/lib/fetch.ts` (403 branch + `skipStepUpGate` + envelope reader)
- Modify: `apps/user-client/src/lib/server-client.ts` (`stepUpStart`/`stepUpFinish` — added in Task 4's ripple; verify shape here)
- Create: `apps/user-client/src/lib/step-up-assertion.ts`
- Create: `apps/user-client/src/components/StepUpModalHost.tsx`
- Modify: `apps/user-client/src/App.tsx` (mount host beside `<MindspaceLayer />`, `App.tsx:101`)
- Modify: `apps/user-client/src/lib/copy.ts` (new `stepUp` section)
- Test: `apps/user-client/tests/lib/fetch-step-up.test.ts`

**Interfaces:**
- Consumes: `requestStepUp`/`useStepUpStore`/`StepUpModal` (Task 5); `stepUpWithPasskey`/`stepUpWithPassphrase` (Task 4); `listPasskeyCredentials`, `getLinkedAccount`, `toBase64Url`, `fromBase64Url` (all exported from `@chatsundere/crypto`); `isWebAuthnAvailable` (`lib/webauthn-availability.ts`).
- Produces: `apiFetch` transparently retries once after a confirmed step-up; `ApiFetchOptions.skipStepUpGate`; `getStepUpAssertion(options)` (Task 11 does not use it, but the host does); `copy.stepUp.*` keys.

- [ ] **Step 1: Write the failing interceptor test**

`apps/user-client/tests/lib/fetch-step-up.test.ts` (vitest; stub `globalThis.fetch`; drive the real step-up store):

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { resolveStepUp, useStepUpStore } from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError, apiFetch } from '../../src/lib/fetch.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const STEP_UP_403 = { error: { code: 'step_up_required', message: 'Step-up confirmation required', tier: 1 } };

describe('apiFetch step-up interceptor', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    useStepUpStore.setState({ pending: null });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gates on 403 step_up_required, retries once after confirm', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(403, STEP_UP_403))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const call = apiFetch<{ ok: boolean }>({
      baseUrl: 'https://srv.example',
      path: '/api/v1/me/pairing-codes',
      method: 'POST',
      authMode: 'bearer',
    });

    // The gate is now pending with the mapped tier.
    await vi.waitFor(() => expect(useStepUpStore.getState().pending?.tier).toBe('t1'));
    resolveStepUp(true);

    await expect(call).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps numeric tiers 3 and 4', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(403, { error: { code: 'step_up_required', message: 'x', tier: 4 } }),
    );
    const call = apiFetch({ baseUrl: 'https://srv.example', path: '/x', authMode: 'bearer' });
    await vi.waitFor(() => expect(useStepUpStore.getState().pending?.tier).toBe('t4'));
    resolveStepUp(false);
    await expect(call).rejects.toBeInstanceOf(HttpError);
  });

  it('throws the original HttpError on cancel without retrying', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, STEP_UP_403));
    const call = apiFetch({ baseUrl: 'https://srv.example', path: '/x', authMode: 'bearer' });
    await vi.waitFor(() => expect(useStepUpStore.getState().pending).not.toBeNull());
    resolveStepUp(false);
    await expect(call).rejects.toMatchObject({ status: 403, code: 'step_up_required' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not loop on a second 403 after the retry', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(403, STEP_UP_403))
      .mockResolvedValueOnce(jsonResponse(403, STEP_UP_403));
    const call = apiFetch({ baseUrl: 'https://srv.example', path: '/x', authMode: 'bearer' });
    await vi.waitFor(() => expect(useStepUpStore.getState().pending).not.toBeNull());
    resolveStepUp(true);
    await expect(call).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useStepUpStore.getState().pending).toBeNull();
  });

  it('honours skipStepUpGate (step-up endpoints never recurse)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, STEP_UP_403));
    await expect(
      apiFetch({ baseUrl: 'https://srv.example', path: '/api/v1/auth/step-up/start', authMode: 'bearer', skipStepUpGate: true }),
    ).rejects.toMatchObject({ status: 403 });
    expect(useStepUpStore.getState().pending).toBeNull();
  });

  it('ignores plain 403s without the step_up_required code', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: { code: 'forbidden', message: 'no' } }));
    await expect(
      apiFetch({ baseUrl: 'https://srv.example', path: '/x', authMode: 'bearer' }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    expect(useStepUpStore.getState().pending).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test tests/lib/fetch-step-up.test.ts`
Expected: FAIL — the 403 branch does not exist (first test times out or rejects immediately).

- [ ] **Step 3: Implement the interceptor**

`apps/user-client/src/lib/fetch.ts` — add the import, extend the options, replace `apiFetch` and `safeReadCode`:

```ts
import { requestStepUp, useSessionStore } from '@chatsundere/ui-shared';
import type { StepUpTier } from '@chatsundere/shared-types';
```

```ts
export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  baseUrl: string;
  path: string;
  json?: unknown;
  authMode?: 'none' | 'bearer';
  /**
   * Opt-out for the step-up endpoints themselves — the ceremony must never
   * recurse into the step-up gate. Leave unset everywhere else.
   */
  skipStepUpGate?: boolean;
}

export async function apiFetch<T>(opts: ApiFetchOptions): Promise<T> {
  const url = joinUrl(opts.baseUrl, opts.path);
  let res = await fetch(url, buildInit(opts));
  if (res.status === 401 && opts.authMode === 'bearer') {
    const refreshed = await tryRefresh(opts.baseUrl);
    if (refreshed) {
      res = await fetch(url, buildInit(opts));
    }
  }
  // Step-up gate (ADR 0027): one modal round, one retry, never a loop.
  if (res.status === 403 && !opts.skipStepUpGate) {
    const envelope = await safeReadError(res);
    if (envelope?.code === 'step_up_required') {
      const confirmed = await requestStepUp(tierFromEnvelope(envelope));
      if (confirmed) {
        res = await fetch(url, buildInit(opts));
      }
    }
  }
  if (!res.ok) {
    const envelope = await safeReadError(res);
    const retryAfter = parseRetryAfter(res.headers.get('Retry-After'));
    throw new HttpError(res.status, envelope?.code, `${res.status} ${res.statusText}`, retryAfter);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
```

```ts
interface ErrorEnvelope {
  code?: string;
  tier?: number;
}

async function safeReadError(res: Response): Promise<ErrorEnvelope | undefined> {
  try {
    const body = (await res.clone().json()) as { error?: ErrorEnvelope };
    return body.error;
  } catch {
    return undefined;
  }
}

/** The server sends the tier numerically (`{ tier: 1 | 3 | 4 }`) — map to the wire enum. */
function tierFromEnvelope(envelope: ErrorEnvelope): StepUpTier {
  if (envelope.tier === 3) return 't3';
  if (envelope.tier === 4) return 't4';
  return 't1';
}
```

Delete the old `safeReadCode` and update its one other caller inside this file. The user-client `httpServerClient` step-up members (added in Task 4's ripple) must be exactly:

```ts
  stepUpStart: (req: StepUpStartRequest, baseUrl: string, _accessToken: string) =>
    apiFetch<StepUpStartResponse>({
      baseUrl,
      path: '/api/v1/auth/step-up/start',
      json: req,
      authMode: 'bearer',
      skipStepUpGate: true,
    }),
  stepUpFinish: (req: StepUpFinishRequest, baseUrl: string) =>
    apiFetch<StepUpFinishResponse>({
      baseUrl,
      path: '/api/v1/auth/step-up/finish',
      json: req,
      authMode: 'none',
      skipStepUpGate: true,
    }),
```

- [ ] **Step 4: Interceptor test passes**

Run: `pnpm --filter @chatsundere/user-client test tests/lib/fetch-step-up.test.ts`
Expected: PASS.

- [ ] **Step 5: Assertion helper, copy, modal host, mount**

(a) `apps/user-client/src/lib/step-up-assertion.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import { fromBase64Url, toBase64Url } from '@chatsundere/crypto';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@chatsundere/shared-types';

/**
 * Drives navigator.credentials.get() for a step-up assertion (Mechanism A).
 * Converts the server's JSON options to binary form and serialises the
 * result back to the @simplewebauthn JSON envelope the server verifies.
 * UV comes as 'required' in the server options (ADR 0027) — passed through
 * unchanged.
 */
export async function getStepUpAssertion(
  options: PublicKeyCredentialRequestOptionsJSON,
): Promise<AuthenticationResponseJSON> {
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: toBuffer(fromBase64Url(options.challenge)),
    rpId: options.rpId,
    timeout: options.timeout,
    userVerification: options.userVerification,
    allowCredentials: (options.allowCredentials ?? []).map((c) => ({
      type: 'public-key' as const,
      id: toBuffer(fromBase64Url(c.id)),
    })),
  };

  const credential = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  if (!credential) throw new Error('assertion returned no credential');
  const response = credential.response as AuthenticatorAssertionResponse;

  return {
    id: credential.id,
    rawId: toBase64Url(new Uint8Array(credential.rawId)),
    type: 'public-key',
    response: {
      clientDataJSON: toBase64Url(new Uint8Array(response.clientDataJSON)),
      authenticatorData: toBase64Url(new Uint8Array(response.authenticatorData)),
      signature: toBase64Url(new Uint8Array(response.signature)),
      userHandle: response.userHandle
        ? toBase64Url(new Uint8Array(response.userHandle))
        : undefined,
    },
    clientExtensionResults:
      credential.getClientExtensionResults() as AuthenticationResponseJSON['clientExtensionResults'],
    authenticatorAttachment: (credential.authenticatorAttachment ??
      undefined) as AuthenticationResponseJSON['authenticatorAttachment'],
  };
}

/** Copies into a fresh ArrayBuffer-backed view (BufferSource wants Uint8Array<ArrayBuffer>). */
function toBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.slice() as Uint8Array<ArrayBuffer>;
}
```

(b) `apps/user-client/src/lib/copy.ts` — new section beside `biometricPrompt` (spec §7.2 copy, Laura-revised):

```ts
  stepUp: {
    title: 'Confirm it’s you',
    bodyBoth: 'A quick re-check keeps your account safe.',
    bodyPassphraseOnly: 'Re-enter your passphrase to continue.',
    usePasskeyCta: 'Use passkey',
    usePassphraseCta: 'Use passphrase instead',
    passphraseLabel: 'Passphrase',
    confirmCta: 'Confirm',
    cancelCta: 'Cancel',
    passkeyFailed: 'Couldn’t verify with passkey. Try your passphrase.',
    wrongPassphrase: 'Wrong passphrase. Try again.',
    genericError: 'Something went wrong. Please try again.',
    busy: 'Checking…',
  },
```

(c) `apps/user-client/src/components/StepUpModalHost.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import {
  listPasskeyCredentials,
  stepUpWithPasskey,
  stepUpWithPassphrase,
} from '@chatsundere/crypto';
import { StepUpModal, useSessionStore, useStepUpStore } from '@chatsundere/ui-shared';
import { useEffect, useState } from 'react';
import { getDb } from '../boot/open-db.js';
import { copy } from '../lib/copy.js';
import { httpServerClient } from '../lib/server-client.js';
import { getStepUpAssertion } from '../lib/step-up-assertion.js';
import { isWebAuthnAvailable } from '../lib/webauthn-availability.js';

/**
 * Mounts the shared StepUpModal once at the app root and wires both
 * mechanisms (spec §7.2). Passkey availability is local knowledge: a
 * server-synced passkey row plus WebAuthn support — no server round-trip.
 */
export function StepUpModalHost() {
  const pending = useStepUpStore((s) => s.pending);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);

  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listPasskeyCredentials(getDb());
        if (!cancelled) {
          setPasskeyAvailable(isWebAuthnAvailable() && rows.some((r) => r.is_synced_with_server));
        }
      } catch {
        if (!cancelled) setPasskeyAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pending]);

  const tier = pending?.tier ?? 't1';

  return (
    <StepUpModal
      passkeyAvailable={passkeyAvailable}
      onPasskey={() =>
        stepUpWithPasskey({
          db: getDb(),
          serverClient: httpServerClient,
          accessToken: useSessionStore.getState().session?.accessToken ?? '',
          tier,
          getAssertion: getStepUpAssertion,
        })
      }
      onPassphrase={(passphrase) =>
        stepUpWithPassphrase({
          db: getDb(),
          serverClient: httpServerClient,
          accessToken: useSessionStore.getState().session?.accessToken ?? '',
          tier,
          passphrase,
        })
      }
      copy={copy.stepUp}
    />
  );
}
```

(Do not import `getLinkedAccount` here — the ceremony flows read the linked row themselves.)

(d) `apps/user-client/src/App.tsx` — import `StepUpModalHost` and render it directly after `<MindspaceLayer />` (line 101), inside the providers but outside `<BrowserRouter>`:

```tsx
          <MindspaceLayer />
          <StepUpModalHost />
```

- [ ] **Step 6: Full user-client gate**

Run: `pnpm --filter @chatsundere/user-client test` then `pnpm typecheck --force` then `pnpm exec biome check apps/user-client/src packages`
Expected: suite at baseline (0 or exactly 8 environmental failures) + new tests green; 14/14; Biome clean.

- [ ] **Step 7: Commit**

```bash
git add apps/user-client
git commit -m "E: Wire step-up interceptor, ceremony and modal host into user-client"
```

---

### Task 7: admin-client — interceptor + passphrase-only modal host

**Files:**
- Modify: `apps/admin-client/src/lib/fetch.ts` (same 403 branch; this client has no refresh logic — the branch slots after the initial fetch)
- Modify: `apps/admin-client/src/lib/server-client.ts` (`stepUpStart`/`stepUpFinish`, `skipStepUpGate: true` — added in Task 4's ripple; verify)
- Create: `apps/admin-client/src/components/StepUpModalHost.tsx`
- Modify: `apps/admin-client/src/routes/root.tsx` (mount host inside `RootLayout`, after `</header>`)
- Modify: `apps/admin-client/src/copy.ts` (same `stepUp` section keys as Task 6b)
- Test: `apps/admin-client/tests/unit/fetch-step-up.test.ts`

**Interfaces:**
- Consumes: everything Task 5/4 produced; `openLocalDb` (same import the admin login screen uses — see `apps/admin-client/src/routes/login/index.tsx`).
- Produces: Tier-4 admin operations (invitation create/revoke) recover behind the modal — no call-site changes anywhere in the admin routes.

- [ ] **Step 1: Write the failing test**

`apps/admin-client/tests/unit/fetch-step-up.test.ts` — copy Task 6 Step 1's file, adjust the import path to `../../src/lib/fetch.js` and drop the refresh-specific aspects (this client has none). Keep the confirm-retry, cancel, no-loop, `skipStepUpGate`, and plain-403 cases; use `tier: 4`/`'t4'` in the primary case (the admin reality).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chatsundere/admin-client test tests/unit/fetch-step-up.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

(a) `apps/admin-client/src/lib/fetch.ts` — same additions as Task 6 Step 3 (options field, 403 branch between the fetch and the `!res.ok` throw, `safeReadError`, `tierFromEnvelope`); this file keeps its own smaller `HttpError` (no `retryAfterSeconds`).

(b) `apps/admin-client/src/copy.ts` — add the `stepUp` object with the identical keys/strings as Task 6b.

(c) `apps/admin-client/src/components/StepUpModalHost.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { stepUpWithPassphrase } from '@chatsundere/crypto';
import { StepUpModal, useSessionStore, useStepUpStore } from '@chatsundere/ui-shared';
import { copy } from '../copy.js';
import { openLocalDb } from '../lib/open-db.js'; // ← match the exact import used by routes/login/index.tsx
import { httpServerClient } from '../lib/server-client.js';

/**
 * Admin step-up host: passphrase-only (Mechanism B). The admin-client has no
 * passkey infrastructure; OPAQUE is universally available per ADR 0021.
 * Tier-4 grace (5 min) makes invitation burst-work one prompt per burst.
 */
export function StepUpModalHost() {
  const pending = useStepUpStore((s) => s.pending);
  const tier = pending?.tier ?? 't4';

  return (
    <StepUpModal
      passkeyAvailable={false}
      onPassphrase={async (passphrase) =>
        stepUpWithPassphrase({
          db: await openLocalDb(),
          serverClient: httpServerClient,
          accessToken: useSessionStore.getState().session?.accessToken ?? '',
          tier,
          passphrase,
        })
      }
      copy={copy.stepUp}
    />
  );
}
```

Before writing this file, confirm the real module path of `openLocalDb` with `rg -n "openLocalDb" apps/admin-client/src` and match it.

(d) `apps/admin-client/src/routes/root.tsx` — render `<StepUpModalHost />` as the first child inside the top-level `<div className="min-h-dvh">`, before `<header>`.

**Check the admin server-client:** the slim `ServerClient` in `apps/admin-client/src/lib/server-client.ts` is a partial object typed as full `ServerClient` — Task 4's ripple added the two step-up members with `skipStepUpGate: true` exactly like Task 6's version. If it instead throws on unimplemented members, implement the two for real.

- [ ] **Step 4: Run WS-E closing gates**

Run, in order:
1. `pnpm --filter @chatsundere/admin-client test` — new tests green, rest at baseline.
2. `pnpm typecheck --force` — 14/14.
3. `pnpm build` — green.
4. `pnpm --filter @chatsundere/crypto test`, `pnpm --filter @chatsundere/ui-shared test`, `pnpm --filter @chatsundere/user-client test` — all at baseline.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-client
git commit -m "E: Wire step-up interceptor and passphrase-only modal host into admin-client"
```

---

# Part II — WS-B: onboarding un-gate, Add a device, passkey link

**Mid-plan STOP-guard (operating rule 2): verify `packages/ui-shared/src/state/discovery.store.ts` and `packages/ui-shared/src/state/account-link.store.ts` exist before proceeding. If not: stop, run Task 12's battery for Tasks 1–7, report WS-E as the deliverable.**

### Task 8: Matrix un-gate + probe-validated URL entry

**Files:**
- Modify: `apps/user-client/src/routes/onboarding/matrix.tsx` (remove disabled machinery)
- Modify: `apps/user-client/src/routes/onboarding/invitation/form.tsx` (probe on submit)
- Modify: `apps/user-client/src/routes/onboarding/pairing/form.tsx` (same — the file mirrors invitation/form.tsx)
- Modify: `apps/user-client/src/routes/onboarding/recovery.tsx` (probe before `recoverFromScratch`)
- Modify: `apps/user-client/src/lib/copy.ts` (probe error strings)
- Test: `apps/user-client/tests/component/onboarding-matrix.test.tsx`
- Test: `apps/user-client/tests/component/onboarding-probe.test.tsx`

**Interfaces:**
- Consumes: `probeServer(baseUrl): Promise<ProbeResult>` from `@chatsundere/ui-shared` (WS-0 §5 — `{ kind: 'ok' | 'unreachable' | 'invalid' }`; probing a candidate URL does not mutate global state).
- Produces: four active matrix cells; `copy.onboardingProbe.unreachable` / `copy.onboardingProbe.invalid`.

- [ ] **Step 1: Write the failing tests**

`apps/user-client/tests/component/onboarding-matrix.test.tsx` (mirror render helpers from the nearest existing test under `tests/component/` — router wrapper etc.):

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { OnboardingMatrix } from '../../src/routes/onboarding/matrix.js';

describe('OnboardingMatrix', () => {
  it('renders all four cells as active links (no aria-disabled)', () => {
    render(
      <MemoryRouter>
        <OnboardingMatrix />
      </MemoryRouter>,
    );
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(4);
    expect(document.querySelector('[aria-disabled="true"]')).toBeNull();
    expect(screen.getByText('I have an invitation')).toBeDefined();
    expect(screen.getByText('Add this device')).toBeDefined();
    expect(screen.getByText('Use a recovery key')).toBeDefined();
    expect(screen.getByText('Just this device')).toBeDefined();
  });
});
```

`apps/user-client/tests/component/onboarding-probe.test.tsx` — mock the ui-shared module partially and drive the invitation form:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const probeServer = vi.fn();
vi.mock('@chatsundere/ui-shared', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  probeServer: (url: string) => probeServer(url),
}));

import { copy } from '../../src/lib/copy.js';
import { InvitationForm } from '../../src/routes/onboarding/invitation/form.js';

describe('invitation form probe', () => {
  beforeEach(() => probeServer.mockReset());

  async function fillAndSubmit() {
    render(
      <MemoryRouter>
        <InvitationForm />
      </MemoryRouter>,
    );
    // Field selectors: match JoinFormFields' labels — check the component for
    // the exact accessible names before adjusting these two lines.
    await userEvent.type(screen.getByLabelText(/server/i), 'https://srv.example');
    await userEvent.type(screen.getByLabelText(/code/i), 'ABCDE-FGHJK');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  }

  it('blocks on unreachable with constructive copy, input preserved', async () => {
    probeServer.mockResolvedValue({ kind: 'unreachable' });
    await fillAndSubmit();
    await screen.findByText(copy.onboardingProbe.unreachable);
    expect(screen.getByLabelText(/server/i)).toHaveValue('https://srv.example');
  });

  it('blocks on invalid with the not-a-chatsundere-server copy', async () => {
    probeServer.mockResolvedValue({ kind: 'invalid' });
    await fillAndSubmit();
    await screen.findByText(copy.onboardingProbe.invalid);
  });

  it('proceeds on ok', async () => {
    probeServer.mockResolvedValue({ kind: 'ok', config: { features: [] } });
    await fillAndSubmit();
    expect(probeServer).toHaveBeenCalledWith('https://srv.example');
    expect(screen.queryByText(copy.onboardingProbe.unreachable)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @chatsundere/user-client test tests/component/onboarding-matrix.test.tsx tests/component/onboarding-probe.test.tsx`
Expected: matrix test FAILS (only 1 link, 3 aria-disabled cells); probe test FAILS (`copy.onboardingProbe` undefined, no probe called).

- [ ] **Step 3: Implement**

(a) `matrix.tsx` — delete `disabled`/`disabledTooltip` from the `Cell` interface, set all four cells `disabled`-free, delete `DisabledCell`, render `ActiveCell` for every cell, and rewrite the component JSDoc (the cells are live now; disabled-over-hidden no longer applies to this surface). Keep the `useEffect` reset and grid classes untouched.

(b) `copy.ts` — beside the other onboarding strings:

```ts
  onboardingProbe: {
    unreachable: 'That server isn’t answering. Check the address, or try again in a moment.',
    invalid: 'That address doesn’t look like a Chatsundere server. Check it with whoever invited you.',
  },
```

(c) `invitation/form.tsx` — make `handleContinue` async with a probing state:

```tsx
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);

  async function handleContinue() {
    if (!continueEnabled || probing) return;
    setProbeError(null);
    setProbing(true);
    try {
      const probe = await probeServer(baseUrl);
      if (probe.kind === 'unreachable') {
        setProbeError(copy.onboardingProbe.unreachable);
        return;
      }
      if (probe.kind === 'invalid') {
        setProbeError(copy.onboardingProbe.invalid);
        return;
      }
      setOnboardingState({ kind: 'invitation_input', baseUrl, code });
      navigate(navTarget('/onboarding/invitation/confirm'));
    } finally {
      setProbing(false);
    }
  }
```

Imports: `probeServer` from `@chatsundere/ui-shared`, `copy` from `../../../lib/copy.js`, `useState` already present. Below `<JoinFormFields …/>` add the alert; disable the submit while probing:

```tsx
        {probeError && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {probeError}
          </p>
        )}
        <button type="submit" disabled={!continueEnabled || probing} …>
          {probing ? 'Checking…' : 'Continue'}
        </button>
```

(`'Checking…'` goes into copy as `onboardingProbe.checking` — no inline strings.)

(d) `pairing/form.tsx` — identical treatment (the file is a sibling of invitation/form.tsx with `pairing_input` state kinds).

(e) `recovery.tsx` — inside `handleContinue` after `setScreen({ kind: 'submitting' })`, before `recoverFromScratch`:

```tsx
      const probe = await probeServer(baseUrl);
      if (probe.kind !== 'ok') {
        setScreen({ kind: 'ready' });
        setRecoveryKeyError(null);
        setUrlError(
          probe.kind === 'unreachable'
            ? copy.onboardingProbe.unreachable
            : copy.onboardingProbe.invalid,
        );
        return;
      }
```

Add a `urlError` state + `role="alert"` line under the URL field, mirroring the existing inline-error pattern in that file.

- [ ] **Step 4: Run to verify green**

Run: `pnpm --filter @chatsundere/user-client test`
Expected: new tests PASS; suite at baseline.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client
git commit -m "B: Un-gate the onboarding matrix and probe-validate server URLs"
```

---

### Task 9: Server-linking page becomes real + account-link store migration

**Files:**
- Modify: `apps/user-client/src/routes/app/account/server-linking.tsx` (read the store; linked view)
- Modify: `apps/user-client/src/routes/onboarding/invitation/confirm.tsx` (setLinked after both branches)
- Modify: `apps/user-client/src/routes/onboarding/pairing/confirm.tsx` (same after finish)
- Modify: `apps/user-client/src/routes/onboarding/recovery.tsx` (same after finish)
- Modify: `apps/user-client/src/routes/login/index.tsx` (migrate the ad-hoc `getLinkedAccount` read to the store)
- Modify: `apps/user-client/src/lib/copy.ts` (linked-state strings)
- Test: `apps/user-client/tests/component/server-linking.test.tsx`

**Interfaces:**
- Consumes: `useAccountLinkStore` (WS-0 §6: `{ linkStatus: 'unknown' | 'local-only' | 'linked'; baseUrl; issuerLabel; role }`, actions `setLinked(row)` / `setLocalOnly()`); `getLinkedAccount` (crypto) for `linked_at` only.
- Produces: linked/local-only server-linking page; every successful link path publishes to the store.

- [ ] **Step 1: Write the failing test**

`apps/user-client/tests/component/server-linking.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { ServerLinkingPage } from '../../src/routes/app/account/server-linking.js';

// Adjust the setState shapes to the WS-0 store's actual action signatures.

describe('ServerLinkingPage', () => {
  beforeEach(() => {
    useAccountLinkStore.setState({ linkStatus: 'local-only', baseUrl: null, issuerLabel: null, role: null });
  });

  it('shows local-only state with the link CTA', () => {
    render(
      <MemoryRouter>
        <ServerLinkingPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('Local-only mode')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Link to server' })).toBeDefined();
  });

  it('shows the linked state with server details', () => {
    useAccountLinkStore.setState({
      linkStatus: 'linked',
      baseUrl: 'https://chatsune.me',
      issuerLabel: 'chatsune.me',
      role: 'user',
    });
    render(
      <MemoryRouter>
        <ServerLinkingPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('Linked to https://chatsune.me')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Link to server' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test tests/component/server-linking.test.tsx`
Expected: FAIL — the page hard-codes local-only.

- [ ] **Step 3: Implement**

(a) `server-linking.tsx` — replace the hard-coded `serverUrl` block:

```tsx
  const linkStatus = useAccountLinkStore((s) => s.linkStatus);
  const baseUrl = useAccountLinkStore((s) => s.baseUrl);
  const role = useAccountLinkStore((s) => s.role);
  const issuerLabel = useAccountLinkStore((s) => s.issuerLabel);
```

Render three branches: `'unknown'` → the neutral "Checking…" line (calm, no spinner — WS-0 §14); `'local-only'` → the existing view with refreshed copy (drop the "Block 1/Block 2" developer framing; the explainer becomes `copy.serverLinking.localOnlyBody`); `'linked'` → success `Badge` `Linked to {baseUrl}`, a small `<dl>` with issuer label (when set), role, and linked-since (one-off `getLinkedAccount(getDb())` read in a `useEffect` for `linked_at`; format with the file's locale conventions). The Add-a-device section arrives in Task 10 — leave a clearly-named slot (`{linkStatus === 'linked' && <AddDeviceSection baseUrl={baseUrl} />}` commented OUT or omitted until Task 10; do not ship dead code).

All new strings go to `copy.ts` under a new `serverLinking` section.

(b) Publish-to-store, one line after each successful link/join/recovery (all four call sites already `await` their flow and then navigate — insert between):

```ts
      const linkedRow = await getLinkedAccount(getDb());
      if (linkedRow) useAccountLinkStore.getState().setLinked(linkedRow);
```

Call sites: `invitation/confirm.tsx` (both the late-link and fresh-join branches), `pairing/confirm.tsx` (after `finishJoinByPairing` + `setSession`), `onboarding/recovery.tsx` (after `recoverFromScratch` + `setSession`). Match `setLinked`'s actual parameter shape from the WS-0 store — if it takes the row directly, pass it; if it takes `{ baseUrl, issuerLabel, role }`, map the row's snake_case fields.

(c) `login/index.tsx` — replace the ad-hoc IDB read that computes `hasLinked` (line ~36) with the store: `const hasLinked = useAccountLinkStore((s) => s.linkStatus === 'linked');`. Treat `'unknown'` exactly as the screen's existing loading state treats the pending IDB read (WS-0 boot populates the store before the login screen typically settles). Remove the now-unused import if nothing else in the file reads `getLinkedAccount`.

- [ ] **Step 4: Run to verify green**

Run: `pnpm --filter @chatsundere/user-client test`
Expected: new test PASS, suite at baseline (login-screen tests may need their setup updated to seed the store instead of the IDB — do that in those test files, mirroring what they already stub).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client
git commit -m "B: Make the server-linking page real and publish link state to the account-link store"
```

---

### Task 10: Add a device — pairing-code generation UI

**Files:**
- Modify: `apps/user-client/package.json` (add `"qrcode": "^1.5.0"` to dependencies, `"@types/qrcode": "^1.5.0"` to devDependencies — mirror admin-client's versions; run `pnpm install`)
- Create: `apps/user-client/src/lib/pairing-codes.ts`
- Create: `apps/user-client/src/routes/app/account/add-device-section.tsx`
- Modify: `apps/user-client/src/routes/app/account/server-linking.tsx` (render the section in the linked branch)
- Modify: `apps/user-client/src/lib/copy.ts` (`addDevice` section)
- Test: `apps/user-client/tests/component/add-device-section.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (Task 6 — the step-up gate rides along automatically: `POST` is t1-gated server-side and the interceptor shows the modal); `useAccountLinkStore.baseUrl`.
- Produces:
  ```ts
  interface PairingCode { id: string; code: string | null; qr_url: string | null; created_at: string; expires_at: string; state: 'active'; }
  createPairingCode(baseUrl: string): Promise<PairingCode>       // POST /api/v1/me/pairing-codes
  listPairingCodes(baseUrl: string): Promise<PairingCode[]>       // GET  … → { pairing_codes }
  revokePairingCode(baseUrl: string, id: string): Promise<void>   // DELETE …/:id
  ```

- [ ] **Step 1: Write the failing test**

`apps/user-client/tests/component/add-device-section.test.tsx` — mock `../../src/lib/pairing-codes.js` wholesale and assert the UX contract (reveal-once, standing copy, revoke):

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createPairingCode = vi.fn();
const listPairingCodes = vi.fn();
const revokePairingCode = vi.fn();
vi.mock('../../src/lib/pairing-codes.js', () => ({
  createPairingCode: (...a: unknown[]) => createPairingCode(...a),
  listPairingCodes: (...a: unknown[]) => listPairingCodes(...a),
  revokePairingCode: (...a: unknown[]) => revokePairingCode(...a),
}));
// qrcode draws to canvas — stub it (jsdom has no canvas).
vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn().mockResolvedValue(undefined) } }));

import { copy } from '../../src/lib/copy.js';
import { AddDeviceSection } from '../../src/routes/app/account/add-device-section.js';

const ACTIVE = {
  id: 'pc-1', code: null, qr_url: null,
  created_at: '2026-07-02T10:00:00Z', expires_at: '2026-07-02T10:15:00Z', state: 'active' as const,
};

describe('AddDeviceSection', () => {
  beforeEach(() => {
    createPairingCode.mockReset();
    listPairingCodes.mockReset().mockResolvedValue([ACTIVE]);
    revokePairingCode.mockReset().mockResolvedValue(undefined);
  });

  it('lists active codes with the standing shown-once explainer and a revoke control', async () => {
    render(<AddDeviceSection baseUrl="https://srv.example" />);
    await screen.findByText(copy.addDevice.standingNote);
    expect(await screen.findByRole('button', { name: copy.addDevice.revokeCta })).toBeDefined();
  });

  it('creates a code and reveals it once with the shown-once notice', async () => {
    createPairingCode.mockResolvedValue({ ...ACTIVE, code: 'ABCDE-FGHJK', qr_url: 'https://srv.example/join#ABCDEFGHJK' });
    render(<AddDeviceSection baseUrl="https://srv.example" />);
    await userEvent.click(await screen.findByRole('button', { name: copy.addDevice.createCta }));
    await screen.findByText('ABCDE-FGHJK');
    await screen.findByText(copy.addDevice.shownOnce);
  });

  it('revokes from the list', async () => {
    render(<AddDeviceSection baseUrl="https://srv.example" />);
    await userEvent.click(await screen.findByRole('button', { name: copy.addDevice.revokeCta }));
    expect(revokePairingCode).toHaveBeenCalledWith('https://srv.example', 'pc-1');
  });
});
```

(The POST response carries the code with a hyphen or not — check `codes/token.ts` `generateCode()` output format on the server and match the fixture to reality; the assertion is on rendering what the server returned, not on the format.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test tests/component/add-device-section.test.tsx`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement**

(a) `pnpm add --filter @chatsundere/user-client qrcode` and `pnpm add -D --filter @chatsundere/user-client @types/qrcode` (pin `^1.5.0` to match admin-client).

(b) `apps/user-client/src/lib/pairing-codes.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import { apiFetch } from './fetch.js';

/** Wire shape of a pairing code (GET returns code/qr_url as null — HMAC-only storage). */
export interface PairingCode {
  id: string;
  code: string | null;
  qr_url: string | null;
  created_at: string;
  expires_at: string;
  state: 'active';
}

/** Creates a pairing code. Tier-1 gated server-side; the apiFetch step-up gate handles the prompt. */
export function createPairingCode(baseUrl: string): Promise<PairingCode> {
  return apiFetch<PairingCode>({
    baseUrl,
    path: '/api/v1/me/pairing-codes',
    method: 'POST',
    authMode: 'bearer',
  });
}

export async function listPairingCodes(baseUrl: string): Promise<PairingCode[]> {
  const res = await apiFetch<{ pairing_codes: PairingCode[] }>({
    baseUrl,
    path: '/api/v1/me/pairing-codes',
    authMode: 'bearer',
  });
  return res.pairing_codes;
}

export function revokePairingCode(baseUrl: string, id: string): Promise<void> {
  return apiFetch<void>({
    baseUrl,
    path: `/api/v1/me/pairing-codes/${id}`,
    method: 'DELETE',
    authMode: 'bearer',
  });
}
```

(c) `copy.ts` — `addDevice` section (spec §10.1 incl. the Laura standing note):

```ts
  addDevice: {
    heading: 'Add a device',
    body: 'Create a pairing code, then choose “Add this device” on your other device and scan or type it.',
    createCta: 'Add a device',
    creating: 'Creating…',
    shownOnce: 'You won’t see this code again — the server keeps only a fingerprint. Your other device needs it now.',
    codeLabel: 'Or type this code',
    expiresPrefix: 'Expires',
    doneCta: 'Done',
    standingNote: 'Codes are shown once, when created. Lost one? Add a device to create a fresh one.',
    listHeading: 'Active codes',
    emptyList: 'No active codes. Add a device to create one.',
    createdPrefix: 'Created',
    revokeCta: 'Revoke',
    listError: 'Couldn’t load your active codes. They reappear when your server does.',
    createError: 'Couldn’t create a code right now. Try again in a moment.',
  },
```

(d) `add-device-section.tsx` — a self-contained component: loads the list on mount (`useEffect` + `useState`, no TanStack — this page has none), "Add a device" button → `createPairingCode` → sets a `reveal` state rendered as a transient overlay (`<dialog open>` inline card like `PostOnboardingBiometricPrompt`) containing: QR canvas (`useEffect` → `QRCode.toCanvas(canvasRef.current, reveal.qr_url, { width: 240 })` — precedent `admin-client/src/routes/invitations/reveal-screen.tsx:17`, only when `qr_url` is non-null), the `code` in a monospace block, expiry line, the `shownOnce` notice, and a `Done` button that closes the overlay and refreshes the list. Below the button: `standingNote` (always visible), then the active list (created/expires + Revoke per row) or `emptyList`. Errors: list-load failure → `listError` inline; create failure that is not a cancelled step-up → `createError` inline (a cancelled step-up surfaces as `HttpError` 403 `step_up_required` — treat that as silent: the user chose to cancel). Styling: reuse the page's existing patterns (`bg-ink-soft`, `ring-aurora-700/20`, text sizes from `server-linking.tsx`).

(e) `server-linking.tsx` — in the linked branch, render `<AddDeviceSection baseUrl={baseUrl} />` under the status block (guard `baseUrl` non-null).

- [ ] **Step 4: Run to verify green**

Run: `pnpm --filter @chatsundere/user-client test` and `pnpm typecheck --force`
Expected: PASS at baseline; 14/14.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client pnpm-lock.yaml
git commit -m "B: Add pairing-code generation to the server-linking page"
```

---

### Task 11: Server-synced passkeys — the linkPasskey callers

**Files:**
- Modify: `apps/user-client/src/lib/webauthn.ts` (export `extractCosePublicKey` + `parseAaguid`; they are currently module-private)
- Create: `apps/user-client/src/lib/server-passkey.ts`
- Modify: `apps/user-client/src/components/PostOnboardingBiometricPrompt.tsx` (linked path + failure fall-through + mount-ready)
- Modify: `apps/user-client/src/routes/app/entrance-hall.tsx` (mount the prompt — it is currently an ORPHAN: built, never rendered)
- Modify: `apps/user-client/src/routes/app/account/biometric.tsx` (sync markers + linked add path)
- Modify: `apps/user-client/src/lib/copy.ts` (marker + fall-through strings)
- Test: `apps/user-client/tests/lib/server-passkey.test.ts`
- Test: `apps/user-client/tests/component/biometric-sync-markers.test.tsx`

**Interfaces:**
- Consumes: `linkPasskeyStart` (`httpServerClient`; request `{}` — `LinkPasskeyStartRequest` has only an optional `invitation_token`, omitted post-link); `addPasskeyPostLink` (crypto, exact args at `flows/add-passkey-post-link.ts:15-28`); `PRF_INPUT_SALT`, `toBase64Url`, `fromBase64Url` (crypto); `useSessionStore` (session + mk).
- Produces:
  ```ts
  registerServerSyncedPasskey(label: string): Promise<'synced' | 'local-fallback'>
  // throws PrfRequiredError (no PRF), DOMException NotAllowedError/AbortError (user cancel),
  // StartUnreachableError (linkPasskeyStart failed — nothing was minted)
  class StartUnreachableError extends Error
  ```

- [ ] **Step 1: Write the failing helper test**

`apps/user-client/tests/lib/server-passkey.test.ts` — unit-test the JSON→binary options conversion and the response serialisation via exported pure helpers (keep the credential-driving function thin around them):

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  creationOptionsFromJSON,
  serialiseRegistrationResponse,
} from '../../src/lib/server-passkey.js';

describe('creationOptionsFromJSON', () => {
  it('decodes challenge and user.id, keeps rp/params, injects the PRF eval', () => {
    const json = {
      challenge: 'Y2hhbGxlbmdl',
      rp: { name: 'Chatsundere', id: 'srv.example' },
      user: { id: 'dXNlci1pZA', name: 'casey', displayName: 'casey' },
      pubKeyCredParams: [{ type: 'public-key' as const, alg: -7 }],
      timeout: 60000,
      attestation: 'none' as const,
      authenticatorSelection: { userVerification: 'preferred' as const, residentKey: 'preferred' as const },
    };
    const prfSalt = new Uint8Array(32);
    const opts = creationOptionsFromJSON(json, prfSalt);
    expect(new TextDecoder().decode(opts.challenge as Uint8Array)).toBe('challenge');
    expect(new TextDecoder().decode(opts.user.id as Uint8Array)).toBe('user-id');
    expect(opts.rp.id).toBe('srv.example');
    expect(opts.extensions?.prf?.eval?.first).toBeDefined();
  });
});

describe('serialiseRegistrationResponse', () => {
  it('round-trips a synthetic attestation into the JSON envelope', () => {
    // Build a minimal fake PublicKeyCredential-like object with rawId,
    // response.clientDataJSON / attestationObject / getTransports, and
    // getClientExtensionResults; assert base64url fields decode back to the
    // original bytes and type === 'public-key'.
  });
});

describe('registerServerSyncedPasskey fall-through (spec §11.1 / §14.4)', () => {
  // Module-mock '@chatsundere/crypto' partially: real exports plus
  // addPasskeyPostLink/getLinkedAccount/PRF_INPUT_SALT stubs. Stub
  // navigator.credentials.create via vi.stubGlobal with a fake credential
  // whose getClientExtensionResults returns a PRF result. Seed the session
  // store with a linked session + mk and stub httpServerClient.linkPasskeyStart.

  it('throws StartUnreachableError when linkPasskeyStart rejects, without minting a credential', async () => {
    // linkPasskeyStart rejects → expect StartUnreachableError; assert the
    // credentials.create stub was NOT called and registerLocalBiometric was
    // NOT called (no row of any kind).
  });

  it("degrades to 'local-fallback' when addPasskeyPostLink rejects after creation", async () => {
    // linkPasskeyStart resolves; credentials.create resolves the fake
    // credential; addPasskeyPostLink rejects → expect resolved value
    // 'local-fallback' and session.registerLocalBiometric called once with
    // the SAME credentialId (never a second credentials.create call).
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test tests/lib/server-passkey.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `server-passkey.ts`**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import {
  PRF_INPUT_SALT,
  addPasskeyPostLink,
  getLinkedAccount,
  fromBase64Url,
  toBase64Url,
} from '@chatsundere/crypto';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from '@chatsundere/shared-types';
import { useSessionStore } from '@chatsundere/ui-shared';
import { getDb } from '../boot/open-db.js';
import { httpServerClient } from './server-client.js';
import { PrfRequiredError, extractCosePublicKey, parseAaguid } from './webauthn.js';

/** linkPasskeyStart failed — no credential was minted; safe to retry any time. */
export class StartUnreachableError extends Error {
  constructor() {
    super('Could not reach the server to begin passkey registration.');
    this.name = 'StartUnreachableError';
  }
}

/**
 * Registers a new passkey against the linked server (spec §11): server
 * challenge → credentials.create with PRF → addPasskeyPostLink. On a
 * failure AFTER the credential was created, degrades to a local-only row so
 * the credential is never an orphan and a retry never mints a second one
 * (spec §11.1, Laura hard finding). Tier-1 gated server-side — the apiFetch
 * step-up gate rides along on linkPasskeyStart.
 */
export async function registerServerSyncedPasskey(label: string): Promise<'synced' | 'local-fallback'> {
  const session = useSessionStore.getState().session;
  const mk = useSessionStore.getState().mk;
  if (!session?.accessToken || !mk) throw new Error('no linked session');
  const db = getDb();
  const linked = await getLinkedAccount(db);
  if (!linked) throw new Error('no linked account');

  let start;
  try {
    start = await httpServerClient.linkPasskeyStart({}, linked.base_url, session.accessToken);
  } catch {
    throw new StartUnreachableError();
  }

  const prfSalt = await PRF_INPUT_SALT;
  const credential = (await navigator.credentials.create({
    publicKey: creationOptionsFromJSON(start.options, prfSalt),
  })) as PublicKeyCredential | null;
  if (!credential) throw new PrfRequiredError();

  const extResults = credential.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  const prfFirst = extResults.prf?.results?.first;
  if (!prfFirst) throw new PrfRequiredError();

  const response = credential.response as AuthenticatorAttestationResponse;
  const authData = new Uint8Array(response.getAuthenticatorData());
  const credentialId = new Uint8Array(credential.rawId);
  const publicKey = extractCosePublicKey(authData);
  const aaguid = parseAaguid(authData);
  const prfOutput = new Uint8Array(prfFirst);

  try {
    await addPasskeyPostLink({
      db,
      serverClient: httpServerClient,
      accessToken: session.accessToken,
      mk,
      credentialJson: serialiseRegistrationResponse(credential),
      credentialId,
      publicKey,
      aaguid,
      prfOutput,
      label,
      sessionId: start.session_id,
    });
    return 'synced';
  } catch {
    // Fall back to a local-only row from the material in hand — never an
    // orphan credential, never a dead prompt (spec §11.1).
    await session.registerLocalBiometric({ db, credentialId, publicKey, aaguid, prfOutput, label });
    return 'local-fallback';
  }
}

/** Converts the server's creation-options JSON to binary form and injects the PRF eval. */
export function creationOptionsFromJSON(
  json: PublicKeyCredentialCreationOptionsJSON,
  prfSalt: Uint8Array,
): PublicKeyCredentialCreationOptions {
  return {
    challenge: bufferSource(fromBase64Url(json.challenge)),
    rp: json.rp,
    user: {
      id: bufferSource(fromBase64Url(json.user.id)),
      name: json.user.name,
      displayName: json.user.displayName,
    },
    pubKeyCredParams: json.pubKeyCredParams,
    timeout: json.timeout,
    attestation: json.attestation,
    authenticatorSelection: json.authenticatorSelection,
    excludeCredentials: (json.excludeCredentials ?? []).map((c) => ({
      type: 'public-key' as const,
      id: bufferSource(fromBase64Url(c.id)),
    })),
    extensions: {
      prf: { eval: { first: bufferSource(prfSalt) } },
    },
  };
}

/** Serialises a created PublicKeyCredential into the @simplewebauthn JSON envelope. */
export function serialiseRegistrationResponse(credential: PublicKeyCredential): RegistrationResponseJSON {
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(new Uint8Array(credential.rawId)),
    type: 'public-key',
    response: {
      clientDataJSON: toBase64Url(new Uint8Array(response.clientDataJSON)),
      attestationObject: toBase64Url(new Uint8Array(response.attestationObject)),
      transports: (response.getTransports?.() ?? []) as RegistrationResponseJSON['response']['transports'],
    },
    clientExtensionResults:
      credential.getClientExtensionResults() as RegistrationResponseJSON['clientExtensionResults'],
    authenticatorAttachment: (credential.authenticatorAttachment ??
      undefined) as RegistrationResponseJSON['authenticatorAttachment'],
  };
}

function bufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.slice() as Uint8Array<ArrayBuffer>;
}
```

In `webauthn.ts`, change `function extractCosePublicKey` and `function parseAaguid` to `export function …` (no other changes). Check `@chatsundere/crypto`'s index exports `addPasskeyPostLink` and `PRF_INPUT_SALT` (it exports `PRF_INPUT_SALT` — `webauthn.ts:3` imports it; verify `addPasskeyPostLink` likewise and add the export in `packages/crypto/src/index.ts` if missing).

- [ ] **Step 4: Prompt + biometric page + mount**

(a) `copy.ts` — extend `biometricPrompt` and `settings.authMethods`:

```ts
  // in biometricPrompt:
    startUnreachable: 'Couldn’t reach your server just now — you can add this any time under Account → Biometric unlock.',
    localFallback: 'Your passkey is set up on this device, but couldn’t be synced with your server. It still unlocks Chatsundere here — Account → Biometric unlock shows its status.',
    fallbackOkCta: 'Got it',
  // in settings.authMethods:
    syncedMarker: 'Synced with your server',
    localOnlyMarker: 'On this device only',
    syncedCaption: 'This passkey is registered with your server and can confirm actions on your account.',
    localOnlyCaption: 'Passkeys can’t be copied between devices, so this one only works here. To get one that follows your account, register a new passkey.',
    markerInfoAria: 'What does this mean?',
    localFallbackNotice: 'Saved on this device, but couldn’t be synced with your server just now.',
```

(b) `PostOnboardingBiometricPrompt.tsx` — extend the state union with `{ kind: 'fallback-info' }`; in `handleSetUpNow`, branch on mode:

```tsx
      if (session.mode === 'linked') {
        const result = await registerServerSyncedPasskey(copy.biometricPrompt.defaultLabel);
        await setBiometricPromptShown(getDb());
        if (result === 'local-fallback') {
          setState({ kind: 'fallback-info' });
          return;
        }
        setState({ kind: 'hidden' });
        return;
      }
      await registerLocalBiometric(copy.biometricPrompt.defaultLabel);
```

Error mapping (spec §11.1): `StartUnreachableError` → `setState({ kind: 'error', message: copy.biometricPrompt.startUnreachable })` (prompt stays dismissable — "Maybe later" is already there; do NOT mark shown); `NotAllowedError`/`AbortError` → back to visible (existing branch); `PrfRequiredError`/other → existing error copy. Render `'fallback-info'` as the same card with `copy.biometricPrompt.localFallback` and a single `fallbackOkCta` button that hides the prompt.

(c) Mount the orphan: in `entrance-hall.tsx`, render `<PostOnboardingBiometricPrompt />` as the FIRST child of the page's top-level container element (before the greeting content), with the import added. The component self-hides for local-only/shown/ineligible states, so unconditional rendering is correct.

(d) `biometric.tsx`:
- Each row gains a marker line under the label: marker text + an info-dot `<button aria-label={copy.settings.authMethods.markerInfoAria}>ⓘ</button>` toggling an inline caption `<p>` (press-to-reveal — never `title`-only, Laura §11.2). Choose marker/caption by `pk.is_synced_with_server`.
- The add-passkey handler branches: when the account is linked (`useSessionStore` session `mode === 'linked'`), call `registerServerSyncedPasskey(...)` instead of `registerLocalBiometric(...)`; a `'local-fallback'` result shows `localFallbackNotice` inline (non-error tone); `StartUnreachableError` maps to `copy.biometricPrompt.startUnreachable` in the existing error slot. Local-only accounts keep the existing path bit-for-bit.

(e) `apps/user-client/tests/component/biometric-sync-markers.test.tsx` — render the page with `listPasskeyCredentials` mocked (module-mock `@chatsundere/crypto` partially, as other tests in the repo do) returning one synced and one unsynced row; assert both markers render, captions are hidden until the info button is pressed, and each caption text matches the copy keys.

- [ ] **Step 5: Run to verify green**

Run: `pnpm --filter @chatsundere/user-client test` and `pnpm typecheck --force`
Expected: PASS at baseline; 14/14.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client packages/crypto/src/index.ts
git commit -m "B: Register server-synced passkeys post-onboarding and from the biometric page"
```

---

### Task 12: STATUS update + full verification battery

**Files:**
- Modify: `STATUS-TRANSITION.md` (§6 "Doing now", §7 "Next", `Last updated:` line)

- [ ] **Step 1: Update STATUS-TRANSITION.md**

- `Last updated:` → today's date + one line: WS-E and WS-B built on the branch (or WS-E only, if the rule-2 STOP triggered), awaiting Larissa (auth-service + crypto + interceptor) and Laura (pre-squash) audits, then squash.
- §5 open decisions: mark #3 (server-passkey-linking caller) **resolved — wired in WS-B** (or note it remains if WS-B was skipped).
- §6/§7: move WS-B/WS-E accordingly; next is WS-A per the sprint order.
- Do NOT touch the scope/rules sections.

- [ ] **Step 2: Full battery (operating rule 7)**

Run all, capture numbers:

```bash
pnpm typecheck --force            # expect 14 successful, 14 total, 0 cached
pnpm --filter @chatsundere/crypto test
pnpm --filter @chatsundere/ui-shared test
pnpm --filter @chatsundere/user-client test   # 0 or exactly 8 environmental failures
pnpm --filter @chatsundere/admin-client test
pnpm --filter @chatsundere/auth-service test  # env-gated; note skips honestly
pnpm build
pnpm exec biome check apps packages
```

- [ ] **Step 3: Commit**

```bash
git add STATUS-TRANSITION.md
git commit -m "Update STATUS-TRANSITION: WS-E and WS-B built, awaiting audits [skip ci]"
```

- [ ] **Step 4: Report per operating rule 12.**

---

## Execution notes for Liz (not for the overnight worker)

- **Audit sequencing after the run:** Larissa on the WS-E diff (auth-service + `packages/crypto` + both interceptor paths as courtesy) and on the Task 11 passkey call sites; Laura pre-squash on WS-B's user-reachable flows. Fix findings, then squash as TWO units (`E:` commits → one squash, `B:` commits → one squash) onto `full-backend-transition`.
- **Squash hygiene:** verify no scratch pollution (`git diff --cached --name-only`), verify both squashes contain the full tree state (file-count vs branch tip), `pnpm typecheck --force` on the branch after each squash.
- **Manual verification:** spec §15 — Chris's device matrix, requires the dev backend up.
