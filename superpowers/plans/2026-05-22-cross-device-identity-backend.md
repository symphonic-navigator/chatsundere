# Cross-Device-Identity Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the backend half of the cross-device-identity feature per [`superpowers/specs/2026-05-22-cross-device-identity-api-shapes-design.md`](../specs/2026-05-22-cross-device-identity-api-shapes-design.md) — DB migration, repo-wide path migration `/v1/...` → `/api/v1/...`, reshape `POST /admin/invitations`, three new pairing-code endpoints, unified two-round `POST /api/v1/join/{start,finish}` absorbing the existing `link/opaque` endpoints, plus the supporting infra (HMAC env var, `requireStepUp` helper, wrapping-integrity check).

**Architecture:** Two squashes with Larissa audit each. Squash α is infrastructure-and-reshape: route prefix migration, DB rename + extend, new code-token helpers with leak-domain-isolated HMAC key, `requireStepUp` helper, Tier 4 gate on admin invitations. Squash β is the cross-device feature itself: three pairing-code endpoints plus the unified join endpoints, with the wrapped-MK return and three-layer integrity guarantee. Client-side work (user-client onboarding overhaul, admin-client invitation-form fields) is **out of scope for this plan** — separate plans to follow.

**Tech Stack:** Bun, Hono, Drizzle, PostgreSQL 16, Redis 7, Valibot, `@serenity-kit/opaque`, `pino`, `prom-client`. Tests via Bun's built-in runner.

**Larissa gate:** Mandatory on both squashes — every touched file is under `apps/auth-service/**`. Cross-reference [`CLAUDE.md`](../../CLAUDE.md) §9. Squash α's audit focuses on the new HMAC key and step-up helper; Squash β's audit focuses on the unified join flow, wrapped-MK return, and the integrity check.

**Squash boundaries:** marked inline as `### Squash α boundary` / `### Squash β boundary`. Per-task checkpoint commits during work; squash via `git reset --soft <pre-squash-sha>` + final commit per [ADR 0003](../../obsidian/decisions/0003-squash-per-feature.md).

---

## File Map

### Squash α — infrastructure + reshape

- **Create** `apps/auth-service/migrations/0003_rename_invitations_to_pending_codes.sql` — schema migration: rename `invitations` → `pending_codes`, add `type`, `suggested_username`, `note` columns, rename `token_hmac` → `code_hmac`.
- **Modify** `apps/auth-service/src/db/schema.ts` — Drizzle model: rename `invitations` export → `pendingCodes`, add new fields, add `type` enum.
- **Create** `apps/auth-service/src/codes/token.ts` — replaces `invitations/token.ts`. New helpers: `generateCode()` (10-char ambiguity-removed Base32), `hashCode(code)` (HMAC with new key), `isValidCodeFormat(code)`. Uses `HMAC_KEY_PENDING_CODES` env.
- **Delete** `apps/auth-service/src/invitations/token.ts` — superseded by `codes/token.ts`.
- **Modify** `apps/auth-service/src/invitations/rate-limit.ts` — rename file path-internally to `apps/auth-service/src/codes/rate-limit.ts`, update import sites; behaviour unchanged. (Note: do the rename via `git mv` to preserve blame.)
- **Modify** `apps/auth-service/src/env.ts` — add `HMAC_KEY_PENDING_CODES` (Valibot schema, `loadEnv()` mapping, exported type).
- **Modify** `apps/auth-service/.env.example` + root `.env.example` (if present) — document the new env var.
- **Modify** `README.md` or wherever env vars are documented — add `HMAC_KEY_PENDING_CODES` row with format and a `bunx --bun crypto.randomBytes(32).toString('base64url')` snippet for generation.
- **Create** `apps/auth-service/src/auth/step-up.ts` — new module exporting `requireStepUp({ sessionId, tier })` (Redis GET, validates timestamp against tier grace window). Throws `ApiError(403, 'step_up_required', { tier })` on miss.
- **Modify all of** `apps/auth-service/src/routes/**/*.ts` — change route prefix from `/v1/` to `/api/v1/`. **Exception:** `apps/auth-service/src/routes/link.ts` keeps `/v1/link/opaque/{start,finish}` for now — replaced wholesale in Squash β by `/api/v1/join/*`. All other route files are mechanical sed-able.
- **Modify** `apps/auth-service/src/routes/admin/invitations.ts` — reshape `POST` to accept `suggested_username`, `note`; return `qr_url` (a real URL, not base64url-JSON) constructed from `env.API_BASE_URL + '/join#' + code`. `GET` response items include `suggested_username` and `note`.
- **Modify** `apps/auth-service/src/jwt/issue.ts` — `refreshCookieFor()` updates cookie `Path` attribute from `/v1/token/refresh` to `/api/v1/token/refresh`.
- **Modify** `apps/auth-service/tests/integration/admin-invitations.test.ts` — update path prefix, assert new response shape (`qr_url`, `suggested_username`, `note`).
- **Modify** all of `apps/auth-service/tests/integration/*.test.ts` and `apps/auth-service/tests/unit/*.test.ts` — update path prefix. `link-opaque.test.ts` stays on `/v1/link/opaque/*` (deleted in Squash β).
- **Modify** `apps/admin-client/src/data/api-live.ts` (or equivalent) and `apps/user-client/src/lib/api.ts` (or equivalent) — update `baseURL` constants from `/v1/` to `/api/v1/`. Search for `'/v1/'` usage in those packages.
- **Modify** `packages/ui-shared/src/login/*` — if any explicit `/v1/` paths exist (probably yes for login flow); update.

### Squash β — cross-device endpoints

- **Create** `apps/auth-service/src/routes/me/pairing-codes.ts` — `POST` (Tier 1 gated), `GET`, `DELETE /:id` handlers.
- **Create** `apps/auth-service/src/routes/join.ts` — unified `POST /api/v1/join/{start,finish}` handlers. Branches on `kind` discriminator. Invitation logic ported from `routes/link.ts`; pairing logic new.
- **Modify** `apps/auth-service/src/server.ts` — register the new route modules; deregister `registerLinkRoutes` for the OPAQUE subset (passkey-link routes stay if structurally unrelated to the join flow — verify in Task 12).
- **Delete** `apps/auth-service/src/routes/link.ts` *OR* keep only the passkey-link routes if those remain in scope (likely yes — they manage post-login passkey enrolment, not join).
- **Create** `apps/auth-service/src/auth/wrapping-integrity.ts` — `assertOpaqueWrappingPresent(db, userId)`: throws `500 wrapping_invariant_violated` if not exactly one auth_method row of type `opaque` with non-null `wrapped_master_key`, `wrap_nonce`, `wrap_aad`.
- **Create** `apps/auth-service/tests/integration/pairing-codes.test.ts` — POST/GET/DELETE happy paths plus 403 step_up_required, 404 not_found, 409 already_revoked.
- **Create** `apps/auth-service/tests/integration/join-invitation.test.ts` — full `/api/v1/join/{start,finish}` round-trip for `kind=invitation`. Mirrors the structure of the old `link-opaque.test.ts`.
- **Create** `apps/auth-service/tests/integration/join-pairing.test.ts` — pairing round-trip with new device claiming an existing account. Asserts wrapped-MK material returned, tokens issued.
- **Create** `apps/auth-service/tests/integration/wrapping-integrity.test.ts` — deliberately corrupt the wrapping (NULL out columns) and assert the join-pairing flow rejects with 500 `wrapping_invariant_violated`, writes the audit event, increments the Prometheus counter.
- **Delete** `apps/auth-service/tests/integration/link-opaque.test.ts` — superseded by `join-invitation.test.ts`.
- **Modify** `apps/auth-service/src/metrics.ts` — add `auth_wrapping_invariant_violations_total` counter, `auth_pairing_codes_created_total` counter, `auth_pairing_codes_redeemed_total` counter, `auth_pairing_codes_revoked_total` counter.
- **Modify** `apps/auth-service/src/audit/log.ts` (or wherever audit event types live) — add `pairing_code.created`, `pairing_code.revoked`, `pairing_code.redeemed`, `wrapping_invariant_violated` event types.

### Wrap-up (post-Squash β)

- **Modify** `obsidian/decisions/0023-server-at-root-https-api-prefix.md` — amendment block at the bottom relaxing the rule for transparent-reverse-proxy sub-path hosting (Baalnet model).
- **Create** `obsidian/decisions/0028-unified-two-round-join-flow.md` — new ADR documenting the unification rationale.
- **Modify** `obsidian/STATUS.md` — move cross-device-identity from "Briefed" to "Done"; refresh "Next session".
- **Modify** `obsidian/insights/follow-ups-index.md` — close out the relevant open follow-ups.

---

## Task 1: Path migration `/v1/` → `/api/v1/` (everything except `link/opaque/*`)

**Files:**
- Modify: every file under `apps/auth-service/src/routes/**/*.ts` except `routes/link.ts`
- Modify: every file under `apps/auth-service/tests/**/*.ts` except `tests/integration/link-opaque.test.ts`
- Modify: `apps/auth-service/src/jwt/issue.ts` (cookie path)
- Modify: `apps/admin-client/src/data/*.ts`, `apps/user-client/src/lib/api.ts`, `packages/ui-shared/src/login/*.ts`

Mechanical change with one semantic twist (cookie path). No new behaviour. Test suite must still be green after.

- [ ] **Step 1: Baseline green**

```bash
bun test apps/auth-service
```

Expected: all tests pass on `master`. Capture the test count.

- [ ] **Step 2: Migrate route registrations**

For each file under `apps/auth-service/src/routes/` *except* `link.ts`, replace `app.<method>('/v1/` with `app.<method>('/api/v1/`. Confirm with:

```bash
rg -n "app\.(get|post|put|delete)\('/v1/" apps/auth-service/src/routes/
```

Expected output: only matches inside `link.ts` (the OPAQUE-link routes, which we leave for now).

- [ ] **Step 3: Migrate test fetches**

For each file under `apps/auth-service/tests/` *except* `link-opaque.test.ts`, replace `app.request('/v1/` with `app.request('/api/v1/`. Confirm:

```bash
rg -n "app\.request\('/v1/" apps/auth-service/tests/
```

Expected: only `link-opaque.test.ts` matches.

- [ ] **Step 4: Update refresh-cookie path**

In `apps/auth-service/src/jwt/issue.ts`, find `refreshCookieFor()`. Update the cookie `Path` attribute from `/v1/token/refresh` to `/api/v1/token/refresh`. The function signature stays the same.

- [ ] **Step 5: Update admin-client + user-client + ui-shared baseURLs**

```bash
rg -n "'/v1/" apps/admin-client apps/user-client packages/ui-shared
```

For each hit, replace `/v1/` with `/api/v1/` (preserve trailing path). The change is in the strings used to call `fetch()` or compute base URLs.

- [ ] **Step 6: Run full test suite**

```bash
bun test apps/auth-service
```

Expected: same count as baseline, all pass. If anything fails, the cookie path or a missed string is the culprit.

- [ ] **Step 7: Run frontend test suites**

```bash
pnpm --filter user-client test --run
pnpm --filter admin-client test --run
```

Expected: green. If `/v1/`-related test data lingers (e.g., MSW mocks), update those too.

- [ ] **Step 8: Checkpoint commit**

```bash
git add -p   # stage intentional changes only
git commit -m "Migrate route prefix /v1/ to /api/v1/ across repo (link/opaque/* deferred to join unification)"
```

---

## Task 2: DB migration — rename `invitations` → `pending_codes`

**Files:**
- Create: `apps/auth-service/migrations/0003_rename_invitations_to_pending_codes.sql`
- Modify: `apps/auth-service/src/db/schema.ts`

The chatsundere project is pre-public so destructive migration is acceptable. Existing test data is destroyed; tests re-seed.

- [ ] **Step 1: Write the SQL migration**

Create `apps/auth-service/migrations/0003_rename_invitations_to_pending_codes.sql` with:

```sql
-- Rename invitations to pending_codes and extend for cross-device-identity.
-- Adds the type discriminator (invitation vs pairing) and the new
-- suggested_username / note fields per the cross-device-identity API spec.

ALTER TABLE "invitations" RENAME TO "pending_codes";
ALTER TABLE "pending_codes" RENAME COLUMN "token_hmac" TO "code_hmac";

-- type discriminator. Existing rows are pre-public invitations.
ALTER TABLE "pending_codes" ADD COLUMN "type" text NOT NULL DEFAULT 'invitation';
ALTER TABLE "pending_codes" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "pending_codes" ADD CONSTRAINT "pending_codes_type_check"
  CHECK ("type" IN ('invitation', 'pairing'));

-- invitation-only fields (NULL for pairing rows)
ALTER TABLE "pending_codes" ADD COLUMN "suggested_username" text;
ALTER TABLE "pending_codes" ADD COLUMN "note" text;
```

Notes:
- `role`, `issuer_label`, `attempt_count`, `created_by`, `created_at`, `expires_at`, `redeemed_at`, `redeemed_by_user_id`, `revoked_at` stay on the renamed table unchanged.
- `created_by` is set to the operator for invitations, to the user themselves for pairing codes. Same column, different semantic per `type`.

- [ ] **Step 2: Update the Drizzle schema**

In `apps/auth-service/src/db/schema.ts`, rename the `invitations` export to `pendingCodes`. Add the new columns. Example shape (verify against existing file):

```ts
export const pendingCodes = pgTable('pending_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').$type<'invitation' | 'pairing'>().notNull(),
  codeHmac: bytea('code_hmac').notNull(),
  role: text('role').$type<'primary_admin' | 'admin' | 'user'>(),     // invitation-only
  suggestedUsername: text('suggested_username'),                      // invitation-only
  issuerLabel: text('issuer_label'),                                  // invitation-only
  note: text('note'),                                                 // invitation-only
  attemptCount: integer('attempt_count').notNull().default(0),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
  redeemedByUserId: uuid('redeemed_by_user_id').references(() => users.id),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});
```

- [ ] **Step 3: Drop the old `invitations` export reference**

Search for `from '../db/schema'` (or relative variants) and replace `invitations` import → `pendingCodes`. Inside the importing file, rename usage too.

```bash
rg -n "\binvitations\b" apps/auth-service/src
```

Expected: zero hits after fixing. Comments inside `apps/auth-service/src/routes/admin/invitations.ts` may still say "invitations" — leave those; they're contextually correct.

- [ ] **Step 4: Run the migration locally**

```bash
DATABASE_URL=postgres://chatsundere:chatsundere@localhost:5432/auth_db \
  bun run --cwd apps/auth-service migrate
```

Adjust connection string per `.envrc`. Confirm the migration applies cleanly.

- [ ] **Step 5: Run integration tests**

```bash
TEST_DATABASE_URL=postgres://chatsundere:chatsundere@localhost:5432/auth_db_test \
  bun test apps/auth-service
```

Expected: every test that references `invitations` table must be updated to `pending_codes`. Failures here are exactly the call sites that need updating in subsequent steps.

- [ ] **Step 6: Update call sites that fail**

Edit each failing test or source file to use `pendingCodes` import + table name. Re-run until green.

- [ ] **Step 7: Checkpoint commit**

```bash
git add apps/auth-service/migrations/0003_*.sql apps/auth-service/src/db/schema.ts apps/auth-service/src apps/auth-service/tests
git commit -m "Rename invitations table to pending_codes and add type/suggested_username/note"
```

---

## Task 3: New code-token helpers in `codes/token.ts`

**Files:**
- Create: `apps/auth-service/src/codes/token.ts`
- Create: `apps/auth-service/tests/unit/codes-token.test.ts`
- Delete: `apps/auth-service/src/invitations/token.ts`
- Rename via `git mv`: `apps/auth-service/src/invitations/rate-limit.ts` → `apps/auth-service/src/codes/rate-limit.ts`

The current `invitations/token.ts` generates 32-byte base64url tokens. The spec wants 10-character ambiguity-removed Base32 codes (`AB7K3-MN9PX`). Replace wholesale.

- [ ] **Step 1: Write the failing test**

Create `apps/auth-service/tests/unit/codes-token.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import { generateCode, hashCode, isValidCodeFormat } from '../../src/codes/token.js';

const VALID_ALPHABET = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]$/;

describe('codes/token', () => {
  describe('generateCode', () => {
    it('returns a 10-character token in the format AAAAA-BBBBB', () => {
      const code = generateCode();
      expect(code).toMatch(/^[23456789A-Z]{5}-[23456789A-Z]{5}$/);
    });

    it('uses only ambiguity-removed Base32 characters (no 0, O, 1, I)', () => {
      for (let i = 0; i < 500; i++) {
        const code = generateCode();
        for (const ch of code.replace('-', '')) {
          expect(VALID_ALPHABET.test(ch)).toBe(true);
        }
      }
    });

    it('produces distinct codes across many calls', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 1000; i++) seen.add(generateCode());
      expect(seen.size).toBe(1000);
    });
  });

  describe('hashCode', () => {
    it('returns a 32-byte digest', async () => {
      const digest = await hashCode('AB7K3-MN9PX');
      expect(digest.length).toBe(32);
    });

    it('is deterministic for the same input', async () => {
      const a = await hashCode('AB7K3-MN9PX');
      const b = await hashCode('AB7K3-MN9PX');
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    });

    it('differs for different inputs', async () => {
      const a = await hashCode('AB7K3-MN9PX');
      const b = await hashCode('CD8L4-NP6QY');
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    });
  });

  describe('isValidCodeFormat', () => {
    it('accepts properly-formatted codes', () => {
      expect(isValidCodeFormat('AB7K3-MN9PX')).toBe(true);
      expect(isValidCodeFormat('22222-33333')).toBe(true);
    });

    it('rejects codes with ambiguous characters', () => {
      expect(isValidCodeFormat('AB7K3-MN0PX')).toBe(false); // contains 0
      expect(isValidCodeFormat('AB7K3-MNOPX')).toBe(false); // contains O
      expect(isValidCodeFormat('AB7K3-MN1PX')).toBe(false); // contains 1
      expect(isValidCodeFormat('AB7K3-MNIPX')).toBe(false); // contains I
    });

    it('rejects codes with wrong length or shape', () => {
      expect(isValidCodeFormat('AB7K3MN9PX')).toBe(false);    // no hyphen
      expect(isValidCodeFormat('AB7K3-MN9P')).toBe(false);    // too short
      expect(isValidCodeFormat('AB7K3-MN9PXX')).toBe(false);  // too long
      expect(isValidCodeFormat('ab7k3-mn9px')).toBe(false);   // lowercase
    });
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
bun test apps/auth-service/tests/unit/codes-token.test.ts
```

Expected: FAIL — `cannot find module '../../src/codes/token.js'`.

- [ ] **Step 3: Add the env var to the schema**

In `apps/auth-service/src/env.ts`, add a `HMAC_KEY_PENDING_CODES` field next to the existing `INVITATION_HMAC_KEY`:

```ts
// in the Valibot schema:
HMAC_KEY_PENDING_CODES: pipe(string(), minLength(40)),

// in the loadEnv() return type:
HMAC_KEY_PENDING_CODES: string;

// in the loadEnv() body:
HMAC_KEY_PENDING_CODES: process.env.HMAC_KEY_PENDING_CODES,
```

Note: `INVITATION_HMAC_KEY` is **not** removed — Task 4 migrates the existing route to use the new key, then we drop the old one in Task 7 (last step of Squash α).

- [ ] **Step 4: Implement `codes/token.ts`**

Create `apps/auth-service/src/codes/token.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import { loadEnv } from '../env.js';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 32 chars, RFC 4648 Base32 minus 0/O/1/I
const CODE_RE = /^[23456789A-HJ-NP-Z]{5}-[23456789A-HJ-NP-Z]{5}$/;

let keyCache: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (keyCache) return keyCache;
  const env = loadEnv();
  const raw = Buffer.from(env.HMAC_KEY_PENDING_CODES, 'base64url');
  keyCache = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return keyCache;
}

/**
 * Generates a 10-character ambiguity-removed Base32 code formatted as
 * AAAAA-BBBBB. Entropy: 50 bits.
 */
export function generateCode(): string {
  const buf = new Uint8Array(10);
  crypto.getRandomValues(buf);
  const chars = Array.from(buf, (b) => ALPHABET[b % 32]!);
  return `${chars.slice(0, 5).join('')}-${chars.slice(5, 10).join('')}`;
}

/** HMAC-SHA-256 digest of the code, keyed by HMAC_KEY_PENDING_CODES. */
export async function hashCode(code: string): Promise<Uint8Array> {
  const key = await getKey();
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(code));
  return new Uint8Array(sig);
}

/** Lightweight format check before any DB lookup. */
export function isValidCodeFormat(code: string): boolean {
  return CODE_RE.test(code);
}
```

- [ ] **Step 5: Set the env var locally**

In `.envrc` (or wherever local env lives), add:

```bash
export HMAC_KEY_PENDING_CODES="$(bun --eval 'console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(40))).toString("base64url"))')"
```

In `apps/auth-service/.env.example`:

```
# HMAC key for pending-code hashing (invitations + pairing codes).
# Distinct from INVITATION_HMAC_KEY and REFRESH_TOKEN_HMAC_KEY for
# leak-domain isolation. Generate via:
#   bun --eval 'console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(40))).toString("base64url"))'
HMAC_KEY_PENDING_CODES=
```

- [ ] **Step 6: Run the tests to verify success**

```bash
bun test apps/auth-service/tests/unit/codes-token.test.ts
```

Expected: PASS.

- [ ] **Step 7: Rename `rate-limit.ts` via `git mv`**

```bash
git mv apps/auth-service/src/invitations/rate-limit.ts apps/auth-service/src/codes/rate-limit.ts
```

Inside the renamed file, rename the exported function (probably `consumeInvitationAttempt` → `consumePendingCodeAttempt`); update the Drizzle import (`invitations` → `pendingCodes`). Search for callers:

```bash
rg -n "consumeInvitationAttempt" apps/auth-service
```

Update each caller's import path and renamed function call.

- [ ] **Step 8: Delete the old `invitations/token.ts`**

After Task 4 migrates the admin-invitations route to the new helper, the old file is unused. For now, leave it in place — it's still called by `link.ts` (which migrates in Squash β). Mark it `@deprecated` with a JSDoc comment pointing at `codes/token.ts`.

- [ ] **Step 9: Run the full suite**

```bash
bun test apps/auth-service
```

Expected: green.

- [ ] **Step 10: Checkpoint commit**

```bash
git add apps/auth-service/src/codes apps/auth-service/src/env.ts apps/auth-service/tests/unit/codes-token.test.ts apps/auth-service/.env.example
git commit -m "Add codes/token helpers with HMAC_KEY_PENDING_CODES env var"
```

---

## Task 4: Reshape `POST /api/v1/admin/invitations`

**Files:**
- Modify: `apps/auth-service/src/routes/admin/invitations.ts`
- Modify: `apps/auth-service/tests/integration/admin-invitations.test.ts`

Add `suggested_username` + `note` to request body; replace base64url-JSON QR with `qr_url` (a real URL); switch token generation to the new `codes/token.ts` helpers.

- [ ] **Step 1: Update the integration test first (TDD)**

In `apps/auth-service/tests/integration/admin-invitations.test.ts`, find the existing "creates an invitation" test. Update its expectation block:

```ts
const body = await res.json() as {
  invitation_id: string;
  code: string;
  qr_url: string;
  expires_at: string;
  state: string;
};

expect(body.code).toMatch(/^[23456789A-HJ-NP-Z]{5}-[23456789A-HJ-NP-Z]{5}$/);
expect(body.qr_url).toBe(`${process.env.API_BASE_URL}/join#${body.code}`);
expect(body.state).toBe('active');
```

Add a new test for `suggested_username` + `note`:

```ts
it('persists suggested_username and note on creation', async () => {
  const res = await app.request('/api/v1/admin/invitations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      role: 'user',
      expires_in_seconds: 86400,
      suggested_username: 'chris.tidesson',
      note: 'kenne ich von X, leiwander typ',
    }),
  });
  expect(res.status).toBe(201);

  const list = await app.request('/api/v1/admin/invitations', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const body = await list.json() as { invitations: Array<{
    suggested_username: string | null;
    note: string | null;
  }> };
  const found = body.invitations.find(
    (i) => i.suggested_username === 'chris.tidesson',
  );
  expect(found).toBeDefined();
  expect(found?.note).toBe('kenne ich von X, leiwander typ');
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
bun test apps/auth-service/tests/integration/admin-invitations.test.ts
```

Expected: FAIL on the shape assertions (`code` is base64url not 10-char, `qr_url` is missing, `suggested_username`/`note` not persisted).

- [ ] **Step 3: Update the request schema**

In `apps/auth-service/src/routes/admin/invitations.ts`:

```ts
const createInvitationReq = object({
  role: picklist(['admin', 'user']),
  expires_in_seconds: pipe(
    number(),
    transform((n) => Math.floor(n)),
  ),
  issuer_label: optional(string()),
  suggested_username: optional(string()),
  note: optional(string()),
});
```

- [ ] **Step 4: Update the POST handler**

Replace the existing handler body. Critical changes:

- Replace `generateInvitationToken()` + `hashInvitationToken()` calls with `generateCode()` + `hashCode()` from `../../codes/token.js`.
- Replace the base64url-JSON QR construction with `${env.API_BASE_URL}/join#${code}`.
- Insert `type: 'invitation'`, `suggestedUsername`, `note` into the `pendingCodes` row.
- Response shape: `{ invitation_id, code, qr_url, expires_at, state }`. Drop the old `qr_payload` field.

Reference shape (verify exact field names against schema):

```ts
const code = generateCode();
const codeHmac = await hashCode(code);
const expiresAt = new Date(Date.now() + body.expires_in_seconds * 1000);

const { db } = createDb();
const [row] = await db
  .insert(pendingCodes)
  .values({
    type: 'invitation',
    codeHmac,
    role: body.role,
    issuerLabel: body.issuer_label ?? null,
    suggestedUsername: body.suggested_username ?? null,
    note: body.note ?? null,
    createdBy: claims.sub,
    expiresAt,
  })
  .returning({ id: pendingCodes.id });

const env = loadEnv();
const qrUrl = `${env.API_BASE_URL}/join#${code}`;

return c.json(
  {
    invitation_id: row!.id,
    code,
    qr_url: qrUrl,
    expires_at: expiresAt.toISOString(),
    state: 'active',
  },
  201,
);
```

- [ ] **Step 5: Update the GET handler response items**

In the same file, update the GET handler's per-row mapper to include `suggested_username` and `note` (already in the test from Step 1). Confirm `code`/`code_hmac`/`qr_url` are still **absent** from list responses — once-only at creation per the spec.

- [ ] **Step 6: Run the integration test**

```bash
bun test apps/auth-service/tests/integration/admin-invitations.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run the full auth-service suite**

```bash
bun test apps/auth-service
```

Expected: PASS. Anything that referenced `qr_payload` in old shape needs updating.

- [ ] **Step 8: Checkpoint commit**

```bash
git add apps/auth-service/src/routes/admin/invitations.ts apps/auth-service/tests/integration/admin-invitations.test.ts
git commit -m "Reshape POST /api/v1/admin/invitations to use 10-char codes and qr_url"
```

---

## Task 5: `requireStepUp` helper

**Files:**
- Create: `apps/auth-service/src/auth/step-up.ts`
- Create: `apps/auth-service/tests/unit/step-up.test.ts`

The helper checks Redis for a recent step-up confirmation per ADR 0027. Issuing the confirmation (`POST /api/v1/auth/step-up`) is a **separate spec** — out of scope. The helper alone is sufficient to gate Tier 1+ endpoints; gating endpoints will return 403 until the issuer endpoint exists.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { createRedis } from '../../src/redis/client.js';
import { requireStepUp } from '../../src/auth/step-up.js';

const skip = !process.env.REDIS_URL;

describe.skipIf(skip)('requireStepUp', () => {
  const sessionId = 'test-session-' + Math.random().toString(36).slice(2);
  const redis = createRedis();

  beforeAll(async () => { await redis.del(`step_up:${sessionId}:t1`, `step_up:${sessionId}:t4`); });
  beforeEach(async () => { await redis.del(`step_up:${sessionId}:t1`, `step_up:${sessionId}:t4`); });
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

  it('throws 403 when the key value timestamp is older than the grace window', async () => {
    const oldTs = String(Date.now() - 130_000);
    await redis.set(`step_up:${sessionId}:t1`, oldTs, 'EX', 200);
    await expect(requireStepUp({ sessionId, tier: 1 })).rejects.toMatchObject({
      status: 403,
      code: 'step_up_required',
    });
  });

  it('honours the tier-specific grace window (Tier 4 = 300s)', async () => {
    const ts = String(Date.now() - 250_000);
    await redis.set(`step_up:${sessionId}:t4`, ts, 'EX', 400);
    await expect(requireStepUp({ sessionId, tier: 4 })).resolves.toBeUndefined();
  });

  it('throws when Tier 3 is requested (Tier 3 has no grace window)', async () => {
    await expect(requireStepUp({ sessionId, tier: 3 })).rejects.toMatchObject({
      status: 403,
      code: 'step_up_required',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
bun test apps/auth-service/tests/unit/step-up.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement the helper**

Create `apps/auth-service/src/auth/step-up.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import { ApiError } from '../middleware/error-envelope.js';
import { createRedis } from '../redis/client.js';

const GRACE_MS: Record<number, number> = {
  1: 120_000,  // Tier 1: 2 minutes
  4: 300_000,  // Tier 4: 5 minutes
  // Tier 2 and Tier 3 have no grace window — every call re-prompts.
};

interface RequireStepUpInput {
  sessionId: string;
  tier: 1 | 2 | 3 | 4;
}

/**
 * Verifies the session has a fresh step-up confirmation for the given tier
 * per ADR 0027. Throws ApiError(403, 'step_up_required', { tier }) on miss.
 *
 * Tier 0 callers should not invoke this helper. Tier 2 and Tier 3 always
 * throw because they have no grace window — the calling endpoint must
 * re-prompt every time.
 */
export async function requireStepUp({ sessionId, tier }: RequireStepUpInput): Promise<void> {
  const graceMs = GRACE_MS[tier];
  if (graceMs === undefined) {
    throw new ApiError(403, 'step_up_required', `Step-up tier ${tier} requires re-prompt`, { tier });
  }
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

If `ApiError` does not currently accept a metadata object as a 4th arg, extend its constructor accordingly (the existing error-envelope middleware will pick it up).

- [ ] **Step 4: Run the test to verify success**

```bash
REDIS_URL=redis://localhost:6379 bun test apps/auth-service/tests/unit/step-up.test.ts
```

Expected: PASS.

- [ ] **Step 5: Checkpoint commit**

```bash
git add apps/auth-service/src/auth/step-up.ts apps/auth-service/tests/unit/step-up.test.ts
git commit -m "Add requireStepUp helper (Redis-backed step-up check per ADR 0027)"
```

---

## Task 6: Apply Tier 4 step-up to `POST /api/v1/admin/invitations`

**Files:**
- Modify: `apps/auth-service/src/routes/admin/invitations.ts`
- Modify: `apps/auth-service/tests/integration/admin-invitations.test.ts`

- [ ] **Step 1: Add a test that asserts 403 without step-up**

In the admin-invitations integration test:

```ts
it('returns 403 step_up_required when admin lacks fresh Tier 4 step-up', async () => {
  // Ensure no step-up key exists for this session.
  await redis.del(`step_up:${adminSessionId}:t4`);

  const res = await app.request('/api/v1/admin/invitations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ role: 'user', expires_in_seconds: 3600 }),
  });
  expect(res.status).toBe(403);
  const body = await res.json() as { error: string; tier?: number };
  expect(body.error).toBe('step_up_required');
  expect(body.tier).toBe(4);
});

it('succeeds when admin has fresh Tier 4 step-up', async () => {
  await redis.set(`step_up:${adminSessionId}:t4`, String(Date.now()), 'EX', 400);
  const res = await app.request('/api/v1/admin/invitations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ role: 'user', expires_in_seconds: 3600 }),
  });
  expect(res.status).toBe(201);
});
```

Both tests assume the test setup exposes `adminSessionId` — that's the value the bearer-auth middleware would derive from `adminToken`. If the auth-middleware does not currently expose a session_id, factor it out as part of this task: middleware should write `sessionId` to the Hono context alongside `claims`.

- [ ] **Step 2: Run the test to verify failure**

```bash
REDIS_URL=redis://localhost:6379 bun test apps/auth-service/tests/integration/admin-invitations.test.ts
```

Expected: FAIL — current handler does not call `requireStepUp`, so 201 returned for both tests.

- [ ] **Step 3: Wire the helper into the handler**

At the top of the POST handler in `routes/admin/invitations.ts`:

```ts
app.post('/api/v1/admin/invitations', bearerAuth({ minRole: 'admin' }), async (c) => {
  const claims = c.get('claims') as AccessClaims;
  const sessionId = c.get('sessionId') as string;
  await requireStepUp({ sessionId, tier: 4 });

  // ... rest of handler ...
});
```

- [ ] **Step 4: Ensure middleware exposes `sessionId`**

If `bearerAuth` does not currently set `sessionId`, add it. The session id is **derived** from the access token (e.g., `jti` claim if present, or HMAC of token tail) — never the token itself. Check `apps/auth-service/src/jwt/issue.ts` for what claim is set; if no session-id-style claim exists, add `jti` to the JWT and propagate it as `sessionId` in middleware.

- [ ] **Step 5: Update existing passing tests to seed step-up**

Every existing admin-invitations test that POSTs and expects 201 now needs a `redis.set('step_up:...:t4', ...)` in its setup. The cleanest place is in `beforeEach` or in a helper `withFreshStepUp(adminSessionId, 4)`.

- [ ] **Step 6: Run the integration suite**

```bash
REDIS_URL=redis://localhost:6379 bun test apps/auth-service/tests/integration/admin-invitations.test.ts
```

Expected: PASS — both new tests + every existing test that received its step-up seed.

- [ ] **Step 7: Checkpoint commit**

```bash
git add apps/auth-service/src/routes/admin/invitations.ts apps/auth-service/src/middleware/auth.ts apps/auth-service/tests/integration/admin-invitations.test.ts
git commit -m "Apply Tier 4 step-up gate to POST /api/v1/admin/invitations"
```

---

## Task 7: Audit + squash α

**Files:**
- No code changes; only Larissa pre-squash audit + git operations.

- [ ] **Step 1: Summon Larissa**

Per [`CLAUDE.md`](../../CLAUDE.md) §9, dispatch a Larissa subagent (Opus, security-audit role). Provide:

- The diff range (the per-task checkpoint commits accumulated so far on `master`).
- The spec: `superpowers/specs/2026-05-22-cross-device-identity-api-shapes-design.md`.
- Relevant ADRs: 0021, 0023, 0027.
- Focus areas: HMAC_KEY_PENDING_CODES isolation, `requireStepUp` helper correctness, route-prefix migration completeness (no leftover `/v1/` outside `link.ts`), cookie path migration.

- [ ] **Step 2: Address findings**

Apply fixes for High/Critical findings. Document any conscious defers in `obsidian/insights/security-deferrals.md` per `CLAUDE.md` §9.5.

- [ ] **Step 3: Squash to a single commit**

Find the SHA of `master` *before* Task 1 started; soft-reset to it:

```bash
git log --oneline -20
# identify the pre-Task-1 SHA, e.g., db58e1e (the spec commit)
git reset --soft db58e1e
git status   # verify all tasks 1–6 changes are staged
git commit -m "$(cat <<'EOF'
Migrate auth-service routes to /api/v1/ and add cross-device-identity infrastructure

Reshapes the auth-service for the cross-device-identity feature spec without
yet exposing the new pairing-code or unified-join endpoints.

- Repo-wide route prefix migration /v1/... -> /api/v1/... (except
  /v1/link/opaque/{start,finish}, retained pending Squash β unification)
- Refresh-token cookie Path attribute migrated in lockstep
- DB rename invitations -> pending_codes; adds type discriminator,
  suggested_username, note columns
- New codes/token.ts helpers for 10-char ambiguity-removed Base32 codes,
  hashed with a leak-domain-isolated HMAC_KEY_PENDING_CODES env var
- POST /api/v1/admin/invitations reshape: accepts suggested_username and
  note; returns a real URL qr_url (https://host/join#CODE) instead of
  the old base64url-JSON payload
- requireStepUp helper (Redis-backed per ADR 0027); Tier 4 gate wired
  onto POST /api/v1/admin/invitations
- bearerAuth middleware exposes sessionId on Hono context

ADR 0023 amendment + new ADR for unified join flow land in Squash β.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

### Squash α boundary

---

## Task 8: `POST /api/v1/me/pairing-codes` (Tier 1)

**Files:**
- Create: `apps/auth-service/src/routes/me/pairing-codes.ts`
- Modify: `apps/auth-service/src/server.ts` (register new routes)
- Create: `apps/auth-service/tests/integration/pairing-codes.test.ts`

- [ ] **Step 1: Write the integration test (happy path + step-up failure)**

Create `apps/auth-service/tests/integration/pairing-codes.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { closeDb, createDb } from '../../src/db/client.js';
import { pendingCodes, users } from '../../src/db/schema.js';
import { createRedis } from '../../src/redis/client.js';
import { createServer } from '../../src/server.js';
// Test fixtures helper assumed; if not present, inline a registerTestUser() that
// creates a user via the linking flow and returns { userId, accessToken, sessionId }.
import { registerTestUser } from '../helpers/register.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;

describe.skipIf(skip)('POST /api/v1/me/pairing-codes', () => {
  let app: ReturnType<typeof createServer>;
  let userId: string;
  let accessToken: string;
  let sessionId: string;
  const redis = createRedis();

  beforeAll(async () => {
    app = createServer();
    ({ userId, accessToken, sessionId } = await registerTestUser());
  });

  beforeEach(async () => {
    await redis.del(`step_up:${sessionId}:t1`);
  });

  afterAll(async () => {
    const { db } = createDb();
    await db.delete(pendingCodes).where(eq(pendingCodes.createdBy, userId));
    await db.delete(users).where(eq(users.id, userId));
    await closeDb();
    await redis.quit();
  });

  it('returns 403 step_up_required without Tier 1 step-up', async () => {
    const res = await app.request('/api/v1/me/pairing-codes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });

  it('returns 201 with code + qr_url + 5-minute TTL when step-up is fresh', async () => {
    await redis.set(`step_up:${sessionId}:t1`, String(Date.now()), 'EX', 200);
    const res = await app.request('/api/v1/me/pairing-codes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: '{}',
    });
    expect(res.status).toBe(201);
    const body = await res.json() as {
      id: string;
      code: string;
      qr_url: string;
      expires_at: string;
      created_at: string;
      state: string;
    };
    expect(body.code).toMatch(/^[23456789A-HJ-NP-Z]{5}-[23456789A-HJ-NP-Z]{5}$/);
    expect(body.qr_url).toBe(`${process.env.API_BASE_URL}/join#${body.code}`);
    expect(body.state).toBe('active');

    const ttlMs = new Date(body.expires_at).getTime() - new Date(body.created_at).getTime();
    expect(ttlMs).toBeGreaterThanOrEqual(290_000);
    expect(ttlMs).toBeLessThanOrEqual(310_000);
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
bun test apps/auth-service/tests/integration/pairing-codes.test.ts
```

Expected: FAIL — route not registered.

- [ ] **Step 3: Implement the handler**

Create `apps/auth-service/src/routes/me/pairing-codes.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import type { Hono } from 'hono';
import { writeAudit } from '../../audit/log.js';
import { requireStepUp } from '../../auth/step-up.js';
import { generateCode, hashCode } from '../../codes/token.js';
import { createDb } from '../../db/client.js';
import { pendingCodes } from '../../db/schema.js';
import { loadEnv } from '../../env.js';
import type { AccessClaims } from '../../jwt/verify.js';
import { metrics } from '../../metrics.js';
import { bearerAuth } from '../../middleware/auth.js';

const PAIRING_TTL_SECONDS = 300;

export function registerMePairingCodeRoutes(app: Hono): void {
  app.post('/api/v1/me/pairing-codes', bearerAuth(), async (c) => {
    const claims = c.get('claims') as AccessClaims;
    const sessionId = c.get('sessionId') as string;
    await requireStepUp({ sessionId, tier: 1 });

    const code = generateCode();
    const codeHmac = await hashCode(code);
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + PAIRING_TTL_SECONDS * 1000);

    const { db } = createDb();
    const [row] = await db
      .insert(pendingCodes)
      .values({
        type: 'pairing',
        codeHmac,
        createdBy: claims.sub,
        createdAt,
        expiresAt,
      })
      .returning({ id: pendingCodes.id });

    const env = loadEnv();
    const qrUrl = `${env.API_BASE_URL}/join#${code}`;

    await writeAudit({
      db,
      eventType: 'pairing_code.created',
      userId: claims.sub,
      metadata: { pairing_code_id: row!.id, expires_at: expiresAt.toISOString() },
    });
    metrics.authPairingCodesCreatedTotal.inc();

    return c.json(
      {
        id: row!.id,
        code,
        qr_url: qrUrl,
        expires_at: expiresAt.toISOString(),
        created_at: createdAt.toISOString(),
        state: 'active',
      },
      201,
    );
  });
}
```

- [ ] **Step 4: Add the Prometheus counter**

In `apps/auth-service/src/metrics.ts`, register `authPairingCodesCreatedTotal`:

```ts
export const metrics = {
  // ... existing counters ...
  authPairingCodesCreatedTotal: new Counter({
    name: 'auth_pairing_codes_created_total',
    help: 'Total pairing codes created via POST /api/v1/me/pairing-codes',
  }),
};
```

(Pattern: match the style of `authInvitationsCreatedTotal` already in the file.)

- [ ] **Step 5: Register the route module in `server.ts`**

In `apps/auth-service/src/server.ts`, import and call `registerMePairingCodeRoutes(app)` alongside the other `register*Routes` calls.

- [ ] **Step 6: Run the test**

```bash
REDIS_URL=redis://localhost:6379 \
TEST_DATABASE_URL=postgres://chatsundere:chatsundere@localhost:5432/auth_db_test \
  bun test apps/auth-service/tests/integration/pairing-codes.test.ts
```

Expected: PASS.

- [ ] **Step 7: Checkpoint commit**

```bash
git add apps/auth-service/src/routes/me apps/auth-service/src/metrics.ts apps/auth-service/src/server.ts apps/auth-service/tests/integration/pairing-codes.test.ts
git commit -m "Add POST /api/v1/me/pairing-codes (Tier 1)"
```

---

## Task 9: `GET /api/v1/me/pairing-codes` + `DELETE /api/v1/me/pairing-codes/:id`

**Files:**
- Modify: `apps/auth-service/src/routes/me/pairing-codes.ts` (extend)
- Modify: `apps/auth-service/tests/integration/pairing-codes.test.ts` (extend)

- [ ] **Step 1: Add tests**

Append to `pairing-codes.test.ts`:

```ts
describe('GET /api/v1/me/pairing-codes', () => {
  it('lists only active pairing codes for the authenticated user', async () => {
    await redis.set(`step_up:${sessionId}:t1`, String(Date.now()), 'EX', 200);
    const createRes = await app.request('/api/v1/me/pairing-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: '{}',
    });
    const createBody = await createRes.json() as { id: string; code: string };

    const listRes = await app.request('/api/v1/me/pairing-codes', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(listRes.status).toBe(200);
    const list = await listRes.json() as { pairing_codes: Array<{ id: string; code: string; state: string }> };
    const found = list.pairing_codes.find((p) => p.id === createBody.id);
    expect(found).toBeDefined();
    expect(found?.code).toBe(createBody.code);
    expect(found?.state).toBe('active');
  });
});

describe('DELETE /api/v1/me/pairing-codes/:id', () => {
  it('revokes an active code and returns ok=true', async () => {
    await redis.set(`step_up:${sessionId}:t1`, String(Date.now()), 'EX', 200);
    const createRes = await app.request('/api/v1/me/pairing-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: '{}',
    });
    const { id } = await createRes.json() as { id: string };

    const delRes = await app.request(`/api/v1/me/pairing-codes/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(delRes.status).toBe(200);
    expect(await delRes.json()).toEqual({ ok: true });

    // After revoke, GET should no longer include it.
    const listRes = await app.request('/api/v1/me/pairing-codes', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const list = await listRes.json() as { pairing_codes: Array<{ id: string }> };
    expect(list.pairing_codes.find((p) => p.id === id)).toBeUndefined();
  });

  it('returns 404 for an id that does not belong to the user', async () => {
    const res = await app.request('/api/v1/me/pairing-codes/00000000-0000-0000-0000-000000000000', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(404);
  });

  it('returns 409 when revoking an already-revoked code', async () => {
    await redis.set(`step_up:${sessionId}:t1`, String(Date.now()), 'EX', 200);
    const createRes = await app.request('/api/v1/me/pairing-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: '{}',
    });
    const { id } = await createRes.json() as { id: string };

    await app.request(`/api/v1/me/pairing-codes/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const dup = await app.request(`/api/v1/me/pairing-codes/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(dup.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run the tests to verify failure**

```bash
bun test apps/auth-service/tests/integration/pairing-codes.test.ts
```

Expected: FAIL — handlers not registered.

- [ ] **Step 3: Implement GET and DELETE**

Add to `pairing-codes.ts`:

```ts
import { and, eq, gt, isNull } from 'drizzle-orm';

// inside registerMePairingCodeRoutes(app):

app.get('/api/v1/me/pairing-codes', bearerAuth(), async (c) => {
  const claims = c.get('claims') as AccessClaims;
  const { db } = createDb();
  const env = loadEnv();
  const rows = await db
    .select()
    .from(pendingCodes)
    .where(
      and(
        eq(pendingCodes.createdBy, claims.sub),
        eq(pendingCodes.type, 'pairing'),
        isNull(pendingCodes.redeemedAt),
        isNull(pendingCodes.revokedAt),
        gt(pendingCodes.expiresAt, new Date()),
      ),
    );

  // We cannot return the plaintext code because we stored only the HMAC.
  // For pairing-list views, surface the id, qr_url placeholder, and lifecycle
  // — the user must re-display the original code from the creation response
  // or revoke + reissue. (Decision: GET cannot recover plaintext from HMAC.)
  return c.json({
    pairing_codes: rows.map((r) => ({
      id: r.id,
      code: null,                                           // intentionally null; see comment
      qr_url: null,                                         // ditto
      expires_at: r.expiresAt.toISOString(),
      created_at: r.createdAt.toISOString(),
      state: 'active' as const,
    })),
  });
});

app.delete('/api/v1/me/pairing-codes/:id', bearerAuth(), async (c) => {
  const claims = c.get('claims') as AccessClaims;
  const id = c.req.param('id');
  const { db } = createDb();

  const row = (
    await db
      .select()
      .from(pendingCodes)
      .where(and(eq(pendingCodes.id, id), eq(pendingCodes.createdBy, claims.sub)))
      .limit(1)
  )[0];
  if (!row) throw new ApiError(404, 'not_found', 'Pairing code not found');
  if (row.revokedAt) throw new ApiError(409, 'already_revoked', 'Pairing code already revoked');
  if (row.redeemedAt) throw new ApiError(409, 'already_redeemed', 'Pairing code already redeemed');

  await db.update(pendingCodes).set({ revokedAt: new Date() }).where(eq(pendingCodes.id, id));

  await writeAudit({
    db,
    eventType: 'pairing_code.revoked',
    userId: claims.sub,
    metadata: { pairing_code_id: id },
  });
  metrics.authPairingCodesRevokedTotal.inc();

  return c.json({ ok: true });
});
```

**Important — `code` / `qr_url` in GET:** The spec §4.5 shows full `code` in the list response. That assumes we can recover the plaintext, but we only stored the HMAC. Two options:

- **Update the spec** to mark `code` and `qr_url` as `null` after creation (the user must save the code from the create response themselves, or revoke+reissue).
- **Store the plaintext code reversibly** (e.g., encrypted under a server key) so the GET can decrypt and surface it. Adds a new key-management surface.

**Decision for this task: surface `null` and update the spec.** Add a follow-up note in `obsidian/insights/follow-ups-index.md` to revisit at v0.1.0+ if user feedback wants the full code visible after creation. This deviates from spec §4.5 — flag in the Larissa audit; fix the spec in the same commit if Chris confirms.

- [ ] **Step 4: Update the test expectations**

Adjust the GET test from Step 1 to expect `code: null` (and `qr_url: null`):

```ts
expect(found?.code).toBeNull();
expect(found?.qr_url).toBeNull();
```

- [ ] **Step 5: Run the tests**

```bash
REDIS_URL=redis://localhost:6379 \
TEST_DATABASE_URL=postgres://chatsundere:chatsundere@localhost:5432/auth_db_test \
  bun test apps/auth-service/tests/integration/pairing-codes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Register the new metrics counter**

In `metrics.ts`, add `authPairingCodesRevokedTotal` following the same pattern as `authPairingCodesCreatedTotal`.

- [ ] **Step 7: Add a spec-deviation note**

Append to `obsidian/insights/follow-ups-index.md`:

```markdown
- **Pairing-code GET returns `code: null` (spec §4.5 deviation).** HMAC-stored
  codes are not recoverable. Surfaced as `null` for now; revisit at v0.1.0+ if
  users want post-creation code re-display. See join.ts implementation note.
```

Update spec §4.5 inline if Chris agrees: change `"code": "RWVG3-K8YJL"` → `"code": null` with a footnote explaining HMAC-only storage.

- [ ] **Step 8: Checkpoint commit**

```bash
git add apps/auth-service/src/routes/me apps/auth-service/src/metrics.ts apps/auth-service/tests/integration/pairing-codes.test.ts obsidian/insights/follow-ups-index.md
git commit -m "Add GET + DELETE /api/v1/me/pairing-codes (GET returns code:null, see follow-ups)"
```

---

## Task 10: Unified `POST /api/v1/join/start`

**Files:**
- Create: `apps/auth-service/src/routes/join.ts`
- Modify: `apps/auth-service/src/server.ts`
- Create: `apps/auth-service/tests/integration/join-invitation.test.ts`
- Create: `apps/auth-service/tests/integration/join-pairing.test.ts`

This task implements the START side of both `kind=invitation` and `kind=pairing`. The FINISH side comes in Task 11.

- [ ] **Step 1: Write the failing tests for invitation-start**

Create `apps/auth-service/tests/integration/join-invitation.test.ts`. Mirror the structure of the existing `link-opaque.test.ts` but with the new endpoint and body shape:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { client as opaqueClient, ready as opaqueReady } from '@serenity-kit/opaque';
import { eq } from 'drizzle-orm';
import { closeDb, createDb } from '../../src/db/client.js';
import { hashCode } from '../../src/codes/token.js';
import { pendingCodes, users } from '../../src/db/schema.js';
import { createServer } from '../../src/server.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;

describe.skipIf(skip)('POST /api/v1/join/start (invitation kind)', () => {
  let app: ReturnType<typeof createServer>;
  let invitationCode: string;
  let invitationId: string;

  beforeAll(async () => {
    await opaqueReady;
    app = createServer();
  });

  beforeEach(async () => {
    const { db } = createDb();
    invitationCode = 'AB7K3-MN9PX'; // any valid-format string; we set the hmac
    const codeHmac = await hashCode(invitationCode);
    const [row] = await db
      .insert(pendingCodes)
      .values({
        type: 'invitation',
        codeHmac,
        role: 'user',
        suggestedUsername: 'chris.tidesson',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        createdBy: '00000000-0000-0000-0000-000000000000', // synthetic operator id
      })
      .returning({ id: pendingCodes.id });
    invitationId = row!.id;
  });

  afterAll(async () => {
    const { db } = createDb();
    await db.delete(pendingCodes).where(eq(pendingCodes.id, invitationId));
    await closeDb();
  });

  it('returns 200 with session_id, registration_response, and suggested_username', async () => {
    const { registrationRequest } = opaqueClient.startRegistration({ password: 'pw' });
    const res = await app.request('/api/v1/join/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'invitation',
        code: invitationCode,
        registration_request: registrationRequest,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      session_id: string;
      registration_response: string;
      suggested_username: string | null;
    };
    expect(body.session_id).toBeTruthy();
    expect(body.registration_response).toBeTruthy();
    expect(body.suggested_username).toBe('chris.tidesson');
  });

  it('returns 404 when the code does not exist', async () => {
    const { registrationRequest } = opaqueClient.startRegistration({ password: 'pw' });
    const res = await app.request('/api/v1/join/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'invitation',
        code: '22222-33333', // valid format, no DB row
        registration_request: registrationRequest,
      }),
    });
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toBe('code_not_found_or_expired');
  });

  it('returns 400 invalid_code_format for malformed codes', async () => {
    const res = await app.request('/api/v1/join/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'invitation',
        code: 'lowercase-bad',
        registration_request: 'irrelevant',
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('invalid_code_format');
  });

  it('returns 400 kind_mismatch when invitation kind sent for a pairing code', async () => {
    // Replace the existing row's type to 'pairing' for this test only.
    const { db } = createDb();
    await db.update(pendingCodes).set({ type: 'pairing' }).where(eq(pendingCodes.id, invitationId));

    const { registrationRequest } = opaqueClient.startRegistration({ password: 'pw' });
    const res = await app.request('/api/v1/join/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'invitation',
        code: invitationCode,
        registration_request: registrationRequest,
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('kind_mismatch');
  });
});
```

Similarly create `join-pairing.test.ts` for the pairing-start variant (will fail on the `/finish` round-trip until Task 11; for now assert the `/start` response shape and the `username` field).

- [ ] **Step 2: Run the tests to verify failure**

```bash
bun test apps/auth-service/tests/integration/join-invitation.test.ts apps/auth-service/tests/integration/join-pairing.test.ts
```

Expected: FAIL — route not registered.

- [ ] **Step 3: Implement the handler**

Create `apps/auth-service/src/routes/join.ts`. Structurally:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import { server as opaqueServer } from '@serenity-kit/opaque';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Hono } from 'hono';
import { object, parse, picklist, string } from 'valibot';
import { consumePendingCodeAttempt } from '../codes/rate-limit.js';
import { hashCode, isValidCodeFormat } from '../codes/token.js';
import { createDb } from '../db/client.js';
import { authMethods, pendingCodes, users } from '../db/schema.js';
import { ApiError } from '../middleware/error-envelope.js';
import {
  ensureOpaqueReady,
  generateSessionId,
  getServerSetup,
  storeOpaqueState,
} from '../opaque/server.js';

const startReq = object({
  kind: picklist(['invitation', 'pairing']),
  code: string(),
  registration_request: string(),  // present for invitation
  login_request: string(),         // present for pairing
});

export function registerJoinRoutes(app: Hono): void {
  app.post('/api/v1/join/start', async (c) => {
    await ensureOpaqueReady();
    const body = parse(startReq, await c.req.json());

    if (!isValidCodeFormat(body.code)) {
      throw new ApiError(400, 'invalid_code_format', 'Code does not match the expected format');
    }

    const codeHmac = await hashCode(body.code);
    const row = await consumePendingCodeAttempt(codeHmac);
    // consumePendingCodeAttempt throws ApiError(404, 'code_not_found_or_expired')
    // on miss, expired, or used. Otherwise returns the pending_codes row.

    if (row.type !== body.kind) {
      throw new ApiError(400, 'kind_mismatch', `Code is type ${row.type}, request kind ${body.kind}`);
    }

    const sessionId = generateSessionId();

    if (body.kind === 'invitation') {
      const { registrationResponse } = opaqueServer.createRegistrationResponse({
        serverSetup: getServerSetup(),
        userIdentifier: row.id,
        registrationRequest: body.registration_request,
      });

      await storeOpaqueState({
        scope: 'join-invitation',
        sessionId,
        payload: {
          pending_code_id: row.id,
          invitation_role: row.role,
          suggested_username: row.suggestedUsername,
          opaque_user_identifier: row.id,
        },
      });

      return c.json({
        session_id: sessionId,
        registration_response: registrationResponse,
        suggested_username: row.suggestedUsername,
      });
    }

    // kind === 'pairing'
    // Look up the user who owns the pairing code.
    const { db } = createDb();
    const ownerRow = (
      await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(eq(users.id, row.createdBy))
        .limit(1)
    )[0];
    if (!ownerRow) {
      // Should not happen: pending_codes.created_by FK guarantees presence.
      throw new ApiError(500, 'internal', 'Pairing code owner missing');
    }

    // Look up the user's OPAQUE auth_method to drive the login round.
    const opaqueRow = (
      await db
        .select()
        .from(authMethods)
        .where(and(eq(authMethods.userId, ownerRow.id), eq(authMethods.methodType, 'opaque')))
        .limit(1)
    )[0];
    if (!opaqueRow) {
      throw new ApiError(500, 'wrapping_invariant_violated', 'User missing OPAQUE auth method');
    }

    const { loginResponse, serverLogin } = opaqueServer.startLogin({
      serverSetup: getServerSetup(),
      userIdentifier: opaqueRow.opaqueUserIdentifier!,
      registrationRecord: Buffer.from(opaqueRow.opaqueCredential!).toString('base64url'),
      startLoginRequest: body.login_request,
    });

    await storeOpaqueState({
      scope: 'join-pairing',
      sessionId,
      payload: {
        pending_code_id: row.id,
        user_id: ownerRow.id,
        username: ownerRow.username,
        server_login_state: serverLogin,
      },
    });

    return c.json({
      session_id: sessionId,
      login_response: loginResponse,
      username: ownerRow.username,
    });
  });
}
```

Notes:
- `consumePendingCodeAttempt(codeHmac)` returns the full row (rename of `consumeInvitationAttempt`). Both `invitation` and `pairing` rows pass through the same rate-limiter; the function checks `expires_at > now() AND redeemed_at IS NULL AND revoked_at IS NULL`.
- Storing the OPAQUE login state (`serverLogin`) in Redis lets `/finish` resume the protocol. The `storeOpaqueState` helper already exists; verify it can serialise the `serverLogin` object (it likely returns a base64-encoded blob).

- [ ] **Step 4: Register the route in `server.ts`**

Call `registerJoinRoutes(app)` alongside other registrations.

- [ ] **Step 5: Run the tests**

```bash
REDIS_URL=redis://localhost:6379 \
TEST_DATABASE_URL=postgres://chatsundere:chatsundere@localhost:5432/auth_db_test \
  bun test apps/auth-service/tests/integration/join-invitation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Checkpoint commit**

```bash
git add apps/auth-service/src/routes/join.ts apps/auth-service/src/server.ts apps/auth-service/tests/integration/join-invitation.test.ts apps/auth-service/tests/integration/join-pairing.test.ts
git commit -m "Add POST /api/v1/join/start (kind=invitation|pairing)"
```

---

## Task 11: Unified `POST /api/v1/join/finish` (invitation + pairing) + wrapping integrity

**Files:**
- Modify: `apps/auth-service/src/routes/join.ts`
- Create: `apps/auth-service/src/auth/wrapping-integrity.ts`
- Modify: `apps/auth-service/src/metrics.ts`
- Modify: `apps/auth-service/src/audit/log.ts` (add new event types)
- Extend: `apps/auth-service/tests/integration/join-invitation.test.ts` and `join-pairing.test.ts`
- Create: `apps/auth-service/tests/integration/wrapping-integrity.test.ts`

- [ ] **Step 1: Add the invitation-finish test (extending join-invitation.test.ts)**

Append to `join-invitation.test.ts` the equivalent of the existing `link-opaque.test.ts:58–end` round-trip but against `/api/v1/join/{start,finish}` and with the new `kind: 'invitation'` body. Reference the deletion of `link-opaque.test.ts` will follow in Task 12.

- [ ] **Step 2: Add the pairing-finish test (extending join-pairing.test.ts)**

The test must:

1. Register a user via the invitation flow (the helper from Task 8 if available, else inline).
2. Generate a pairing code for that user.
3. From a fresh "device", call `/api/v1/join/start` with `kind=pairing` + `login_request`.
4. Compute OPAQUE evidence client-side using the user's known passphrase.
5. Call `/api/v1/join/finish` with `kind=pairing` + `login_evidence`.
6. Assert the response contains `user_id`, `username`, `role`, `access_token`, `wrapped_mk_opaque`, `wrap_nonce_opaque`, `wrap_aad_opaque`, `is_new_account: false`.
7. Assert the pairing code's row in DB now has `redeemed_at` set and `redeemed_by_user_id` set.

Full test body in the actual file; structurally:

```ts
it('completes pairing round-trip and returns wrapped MK material', async () => {
  // ... setup: register user, generate pairing code ...
  const startRes = await app.request('/api/v1/join/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'pairing',
      code: pairingCode,
      login_request: loginRequest,
    }),
  });
  const startBody = await startRes.json() as { session_id: string; login_response: string };

  const { finishLoginRequest } = opaqueClient.finishLogin({
    clientLoginState,
    loginResponse: startBody.login_response,
    password,
  });

  const finishRes = await app.request('/api/v1/join/finish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'pairing',
      session_id: startBody.session_id,
      login_evidence: finishLoginRequest,
    }),
  });
  expect(finishRes.status).toBe(200);
  const body = await finishRes.json() as {
    user_id: string;
    username: string;
    role: string;
    access_token: string;
    is_new_account: boolean;
    wrapped_mk_opaque: string;
    wrap_nonce_opaque: string;
    wrap_aad_opaque: string;
  };
  expect(body.is_new_account).toBe(false);
  expect(body.username).toBe(originallyRegisteredUsername);
  expect(body.wrapped_mk_opaque).toBeTruthy();
});
```

- [ ] **Step 3: Write the wrapping-integrity test**

Create `apps/auth-service/tests/integration/wrapping-integrity.test.ts`:

```ts
// ... boilerplate setup ...

it('refuses pairing-finish when OPAQUE wrapping is missing', async () => {
  // Set up user normally, then NULL the wrapping columns on their opaque auth_method.
  const { db } = createDb();
  await db
    .update(authMethods)
    .set({ wrappedMasterKey: null, wrapNonce: null, wrapAad: null })
    .where(and(eq(authMethods.userId, userId), eq(authMethods.methodType, 'opaque')));

  // Drive the join-pairing flow as normal.
  // ... (same as in join-pairing.test.ts) ...

  const finishRes = await app.request('/api/v1/join/finish', { ... });
  expect(finishRes.status).toBe(500);
  const body = await finishRes.json() as { error: string };
  expect(body.error).toBe('wrapping_invariant_violated');
});
```

- [ ] **Step 4: Run the tests to verify failure**

```bash
bun test apps/auth-service/tests/integration/join-*.test.ts apps/auth-service/tests/integration/wrapping-integrity.test.ts
```

Expected: FAIL — `/finish` not implemented.

- [ ] **Step 5: Implement `wrapping-integrity.ts`**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import { and, eq } from 'drizzle-orm';
import { writeAudit } from '../audit/log.js';
import { createDb } from '../db/client.js';
import { authMethods } from '../db/schema.js';
import { metrics } from '../metrics.js';
import { ApiError } from '../middleware/error-envelope.js';

interface AssertOpaqueWrappingPresentInput {
  userId: string;
}

interface OpaqueWrapping {
  wrappedMasterKey: Uint8Array;
  wrapNonce: Uint8Array;
  wrapAad: Uint8Array;
}

/**
 * Defence-in-depth check for the join-pairing flow: ensures the user has
 * exactly one OPAQUE auth_method row with non-null wrapping material.
 *
 * Per ADR 0021, every account has an OPAQUE method from registration; the
 * wrapping is updated on passphrase change and never deleted. A violation
 * here indicates either a code bug in those flows or external tampering.
 * Returns the wrapping on success; throws 500 wrapping_invariant_violated
 * on any anomaly.
 */
export async function assertOpaqueWrappingPresent(
  { userId }: AssertOpaqueWrappingPresentInput,
): Promise<OpaqueWrapping> {
  const { db } = createDb();
  const rows = await db
    .select({
      wrappedMasterKey: authMethods.wrappedMasterKey,
      wrapNonce: authMethods.wrapNonce,
      wrapAad: authMethods.wrapAad,
    })
    .from(authMethods)
    .where(and(eq(authMethods.userId, userId), eq(authMethods.methodType, 'opaque')));

  if (rows.length !== 1) {
    await writeAudit({
      db,
      eventType: 'wrapping_invariant_violated',
      userId,
      metadata: { reason: rows.length === 0 ? 'no_opaque_method' : 'multiple_opaque_methods' },
    });
    metrics.authWrappingInvariantViolationsTotal.inc({ reason: rows.length === 0 ? 'missing' : 'duplicate' });
    throw new ApiError(500, 'wrapping_invariant_violated', 'Cannot complete pairing — please contact your operator');
  }

  const r = rows[0]!;
  if (!r.wrappedMasterKey || !r.wrapNonce || !r.wrapAad) {
    await writeAudit({
      db,
      eventType: 'wrapping_invariant_violated',
      userId,
      metadata: { reason: 'null_wrapping_columns' },
    });
    metrics.authWrappingInvariantViolationsTotal.inc({ reason: 'null_columns' });
    throw new ApiError(500, 'wrapping_invariant_violated', 'Cannot complete pairing — please contact your operator');
  }

  return { wrappedMasterKey: r.wrappedMasterKey, wrapNonce: r.wrapNonce, wrapAad: r.wrapAad };
}
```

- [ ] **Step 6: Register the metric**

In `metrics.ts`:

```ts
authWrappingInvariantViolationsTotal: new Counter({
  name: 'auth_wrapping_invariant_violations_total',
  help: 'Times the OPAQUE-wrapping integrity check failed (should always be zero)',
  labelNames: ['reason'],
}),
authPairingCodesRedeemedTotal: new Counter({
  name: 'auth_pairing_codes_redeemed_total',
  help: 'Total pairing codes successfully redeemed via POST /api/v1/join/finish',
}),
```

- [ ] **Step 7: Implement `/api/v1/join/finish`**

In `routes/join.ts`, add the finish handler. Branch on `kind`. The invitation branch is structurally identical to the existing `/v1/link/opaque/finish` handler (lifted from `routes/link.ts`); the pairing branch is new:

```ts
const finishReq = object({
  kind: picklist(['invitation', 'pairing']),
  session_id: string(),
  // invitation-only:
  username: optional(string()),
  registration_record: optional(string()),
  wrapped_mk_opaque: optional(string()),
  wrap_nonce_opaque: optional(string()),
  wrap_aad_opaque: optional(string()),
  wrapped_mk_recovery: optional(string()),
  wrap_nonce_recovery: optional(string()),
  wrap_aad_recovery: optional(string()),
  recovery_verifier_key: optional(string()),
  // pairing-only:
  login_evidence: optional(string()),
});

app.post('/api/v1/join/finish', async (c) => {
  await ensureOpaqueReady();
  const body = parse(finishReq, await c.req.json());

  if (body.kind === 'invitation') {
    // ... port the body of /v1/link/opaque/finish, swapping `invitations` →
    // pendingCodes, `invitation_id` state field → pending_code_id ...
    // Mark the pending_codes row as redeemed atomically.
    // Issue tokens, set cookie, return is_new_account: true.
  } else {
    // pairing
    const state = await fetchOpaqueState('join-pairing', body.session_id);
    if (!state) throw new ApiError(410, 'session_expired', 'Session expired');
    if (!body.login_evidence) throw new ApiError(400, 'invalid_input', 'login_evidence required for pairing');

    const { sessionKey } = opaqueServer.finishLogin({
      serverSetup: getServerSetup(),
      serverLogin: state.server_login_state,
      finishLoginRequest: body.login_evidence,
    });
    // If finishLogin throws, the passphrase was wrong:
    //   catch and re-throw ApiError(401, 'opaque_evidence_invalid', '...')

    // Atomically mark the pending_code as redeemed; refuse if already used.
    const { db } = createDb();
    const [redemption] = await db
      .update(pendingCodes)
      .set({ redeemedAt: new Date(), redeemedByUserId: state.user_id })
      .where(
        and(
          eq(pendingCodes.id, state.pending_code_id),
          isNull(pendingCodes.redeemedAt),
          isNull(pendingCodes.revokedAt),
          gt(pendingCodes.expiresAt, new Date()),
        ),
      )
      .returning({ id: pendingCodes.id });
    if (!redemption) {
      throw new ApiError(410, 'session_expired', 'Pairing code already redeemed or expired');
    }

    // Wrapping integrity check + retrieval.
    const wrapping = await assertOpaqueWrappingPresent({ userId: state.user_id });

    const tokens = await issueTokens({
      userId: state.user_id,
      role: 'user', // load actual role from users table — see note below
      userAgent: c.req.header('User-Agent') ?? undefined,
    });

    await writeAudit({
      db,
      eventType: 'pairing_code.redeemed',
      userId: state.user_id,
      metadata: { pending_code_id: state.pending_code_id },
    });
    metrics.authPairingCodesRedeemedTotal.inc();

    c.header('Set-Cookie', refreshCookieFor(tokens.refreshToken));
    return c.json({
      user_id: state.user_id,
      username: state.username,
      role: tokens.role,                                            // returned from issueTokens or re-queried
      access_token: tokens.accessToken,
      expires_in: tokens.expiresIn,
      is_new_account: false,
      wrapped_mk_opaque: Buffer.from(wrapping.wrappedMasterKey).toString('base64url'),
      wrap_nonce_opaque: Buffer.from(wrapping.wrapNonce).toString('base64url'),
      wrap_aad_opaque: Buffer.from(wrapping.wrapAad).toString('base64url'),
    });
  }
});
```

Note on `role`: `issueTokens` may or may not require role as input. If it does, query the users table for the role first; if it computes the JWT from the user_id alone, propagate the role through `tokens.role`. Adjust based on the actual signature.

- [ ] **Step 8: Run the tests**

```bash
REDIS_URL=redis://localhost:6379 \
TEST_DATABASE_URL=postgres://chatsundere:chatsundere@localhost:5432/auth_db_test \
  bun test apps/auth-service/tests/integration/join-invitation.test.ts \
          apps/auth-service/tests/integration/join-pairing.test.ts \
          apps/auth-service/tests/integration/wrapping-integrity.test.ts
```

Expected: PASS on all three.

- [ ] **Step 9: Checkpoint commit**

```bash
git add apps/auth-service/src/routes/join.ts apps/auth-service/src/auth/wrapping-integrity.ts apps/auth-service/src/metrics.ts apps/auth-service/src/audit/log.ts apps/auth-service/tests/integration/join-*.test.ts apps/auth-service/tests/integration/wrapping-integrity.test.ts
git commit -m "Add POST /api/v1/join/finish (invitation+pairing) with wrapping-integrity check"
```

---

## Task 12: Remove dead `/v1/link/opaque/*` routes + tests

**Files:**
- Modify: `apps/auth-service/src/routes/link.ts` (delete the OPAQUE handlers, keep passkey-link handlers)
- Modify: `apps/auth-service/src/server.ts` (remove registration if appropriate)
- Delete: `apps/auth-service/tests/integration/link-opaque.test.ts`
- Delete: `apps/auth-service/src/invitations/token.ts` (now truly unused)

- [ ] **Step 1: Confirm passkey-link handlers are independent**

```bash
rg -n "app\.post\('/v1/link" apps/auth-service/src/routes/link.ts
```

Expected: two matches each for opaque + passkey. The OPAQUE pair is being removed; the passkey pair (`/v1/link/passkey/start`, `/v1/link/passkey/finish`) stays. Confirm they don't share imports with OPAQUE-only logic.

- [ ] **Step 2: Migrate passkey-link routes to `/api/v1/` prefix**

(Per Task 1 we deferred these. Now we do it.) In `routes/link.ts`, change `'/v1/link/passkey/...'` to `'/api/v1/link/passkey/...'`. Update any callers in tests / front-end.

- [ ] **Step 3: Delete the OPAQUE-link handlers**

In `routes/link.ts`, remove the two `app.post('/v1/link/opaque/...')` blocks and their helpers if no longer used. Verify imports — remove any that are no longer referenced.

- [ ] **Step 4: Delete the integration test file**

```bash
git rm apps/auth-service/tests/integration/link-opaque.test.ts
```

- [ ] **Step 5: Delete `invitations/token.ts`**

```bash
git rm apps/auth-service/src/invitations/token.ts
rmdir apps/auth-service/src/invitations 2>/dev/null   # only if empty
```

- [ ] **Step 6: Run the full suite**

```bash
REDIS_URL=redis://localhost:6379 \
TEST_DATABASE_URL=postgres://chatsundere:chatsundere@localhost:5432/auth_db_test \
  bun test apps/auth-service
```

Expected: PASS. Any test or import that referenced the deleted symbols needs fixing now.

- [ ] **Step 7: Run typecheck**

```bash
pnpm --filter auth-service typecheck
```

Expected: clean.

- [ ] **Step 8: Checkpoint commit**

```bash
git add -A apps/auth-service
git commit -m "Remove /v1/link/opaque/* routes (superseded by unified /api/v1/join/*) and migrate passkey-link to /api/v1/"
```

---

## Task 13: Audit + squash β

**Files:** no code; Larissa pass + git operations.

- [ ] **Step 1: Summon Larissa**

Provide:

- Diff range: Squash α SHA → current HEAD.
- Spec: `superpowers/specs/2026-05-22-cross-device-identity-api-shapes-design.md`.
- Focus: the unified `/api/v1/join/*` flow (invitation + pairing); wrapped MK return; `assertOpaqueWrappingPresent` correctness; pairing-code lifecycle (creation → redemption → revocation); rate-limit behaviour on `consumePendingCodeAttempt`.

- [ ] **Step 2: Address findings, document defers**

Same protocol as Task 7.

- [ ] **Step 3: Soft-reset and squash**

```bash
git log --oneline -30   # find Squash α SHA
git reset --soft <squash-α-sha>
git status
git commit -m "$(cat <<'EOF'
Add cross-device-identity endpoints: pairing codes + unified join flow

Replaces /v1/link/opaque/{start,finish} with unified
POST /api/v1/join/{start,finish} that branches on a `kind` discriminator
covering both invitation-driven first-link and pairing-driven device-add.

- POST/GET/DELETE /api/v1/me/pairing-codes for user-issued cross-device
  pairing codes (Tier 1 step-up on POST; 5-minute TTL; HMAC-stored)
- POST /api/v1/join/start: two-round OPAQUE entry for both kinds;
  returns suggested_username for invitations, username for pairings
- POST /api/v1/join/finish: completes registration (invitation) or
  login (pairing); pairing response includes the user's wrapped MK
  material so the new device joins the existing crypto domain
- assertOpaqueWrappingPresent defence-in-depth check on every pairing
  redemption; refuses with 500 wrapping_invariant_violated + audit +
  Prometheus counter if the wrapping invariant from ADR 0021 ever fails
- Audit events: pairing_code.created/.revoked/.redeemed,
  wrapping_invariant_violated
- Passkey-link routes also migrated to /api/v1/ prefix in this squash
- Old /v1/link/opaque/* + invitations/token.ts removed

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

### Squash β boundary

---

## Task 14: ADR amendments + new ADR

**Files:**
- Modify: `obsidian/decisions/0023-server-at-root-https-api-prefix.md`
- Create: `obsidian/decisions/0028-unified-two-round-join-flow.md`

- [ ] **Step 1: Append amendment block to ADR 0023**

At the bottom of `0023-server-at-root-https-api-prefix.md`, add:

```markdown
## Amendment — 2026-05-22 (cross-device-identity)

The "server hosted at domain root" constraint is **relaxed** to permit
transparent reverse-proxy sub-path hosting. The auth-service still mounts
at `/api/v1/...` from its own perspective; deployers may front it with a
path-rewriting reverse-proxy (e.g., a Baalnet-style relay at
`https://relay.baalnet.io/t4524.../`) that strips the external prefix
before forwarding to the instance.

Sub-path hosting *without* a path-rewriting proxy (i.e., the instance
itself serving from `/chatsundere/api/v1/...`) remains unsupported.

Driven by the cross-device-identity spec
([`superpowers/specs/2026-05-22-cross-device-identity-api-shapes-design.md`](../../superpowers/specs/2026-05-22-cross-device-identity-api-shapes-design.md))
and the Web-of-Trust use case requiring path-routed relays.
```

- [ ] **Step 2: Write ADR 0028**

Create `obsidian/decisions/0028-unified-two-round-join-flow.md`:

```markdown
# 0028 — Unified two-round join flow

Date: 2026-05-22
Status: Accepted

## Context

The cross-device-identity brief proposed a single `POST /api/join` endpoint
handling both invitation-driven first-link and pairing-driven device-add
via a `type` discriminator. The endpoint was sketched as one-shot.

OPAQUE is a two-round protocol for both registration (server sends a
RegistrationResponse the client incorporates into its RegistrationRecord)
and login (server sends a LoginResponse the client uses to compute its
LoginEvidence). One-shot redemption cannot fit the OPAQUE roundtrip.

The existing auth-service already implemented invitation linking as
`/v1/link/opaque/{start,finish}` — separate from pairing entirely.

## Decision

We unify both flows under `POST /api/v1/join/{start,finish}` with a `kind`
discriminator (`invitation` | `pairing`) in the request body. Existing
`/v1/link/opaque/*` is removed and its logic absorbed into the
invitation branch of the new endpoints.

## Consequences

- One external surface for "joining a server" (whether first-link or new
  device on existing account). The client-side onboarding code branches
  on input, not on endpoint URL.
- The OPAQUE primitives (`createRegistrationResponse`, `startLogin`,
  `finishLogin`) are invoked per-branch within the same handler;
  shared concerns (session state in Redis, atomic code redemption,
  rate-limiting) are written once.
- A single integration test file (`join-invitation.test.ts`) covers
  both new and pre-existing OPAQUE registration behaviour; pairing
  has its own (`join-pairing.test.ts`) plus a defence-in-depth test
  for the wrapping-integrity check (`wrapping-integrity.test.ts`).
- The brief's one-shot framing is rejected. Any future client docs
  describe the join flow as start+finish.

## Alternatives considered

1. **Keep `/v1/link/opaque/*` and add `/v1/pair/*` as a twin pair.**
   Rejected — duplicates session-handling, rate-limit, and atomic-redemption
   logic across two code paths that are 90 % identical.
2. **Brief-style one-shot with the OPAQUE round hidden behind a single
   request.** Mechanically impossible — server cannot produce a
   `registrationRecord` from a `registrationRequest` without the client
   round trip in between.
3. **Single endpoint pair without `kind` discriminator (look up the
   pending_codes row, branch on its `type`).** Rejected — clients
   already know which kind they hold (they chose the input flow);
   declaring it explicitly catches mismatches early (`400 kind_mismatch`)
   rather than silently entering the wrong branch.
```

- [ ] **Step 3: Doc-only commit with `[skip ci]`**

```bash
git add obsidian/decisions/0023-server-at-root-https-api-prefix.md obsidian/decisions/0028-unified-two-round-join-flow.md
git commit -m "Amend ADR 0023 (relax for sub-path proxy) and add ADR 0028 (unified join) [skip ci]"
```

---

## Task 15: STATUS.md + follow-ups updates

**Files:**
- Modify: `obsidian/STATUS.md`
- Modify: `obsidian/insights/follow-ups-index.md`

- [ ] **Step 1: Move cross-device-identity from Briefed → Done**

In `obsidian/STATUS.md`:

- In **Done**, add:
  ```markdown
  - **Cross-device-identity backend (2026-05-XX)**: implemented per spec
    ([[../superpowers/specs/2026-05-22-cross-device-identity-api-shapes-design]]);
    plan at [[../superpowers/plans/2026-05-22-cross-device-identity-backend]].
    Squashes α (infra + reshape) and β (pairing-codes + unified join) both
    Larissa-approved. ADR 0023 amended, ADR 0028 added.
  ```
- Remove the corresponding entries from **Briefed**.
- Update **Next session**: cross-device-identity client-side work (user-client cross-device onboarding, admin-client invitation-form fields), step-up backend (`POST /api/v1/auth/step-up`).
- Update **Last updated** line.

- [ ] **Step 2: Close out follow-ups**

In `obsidian/insights/follow-ups-index.md`, mark closed any items resolved by Squashes α/β. Add any new follow-ups surfaced by the work (e.g., the GET pairing-codes `code: null` deviation flagged in Task 9 Step 7).

- [ ] **Step 3: Doc-only commit with `[skip ci]`**

```bash
git add obsidian/STATUS.md obsidian/insights/follow-ups-index.md
git commit -m "Update STATUS and follow-ups after cross-device-identity backend squashes [skip ci]"
```

---

## Self-Review (post-write checklist)

Skim the spec section by section and confirm a task covers each:

| Spec section | Task |
|---|---|
| §2.1 URL/path semantics; sub-path hosting | Tasks 1, 14 |
| §2.2 10-char / 50-bit code | Task 3 |
| §2.3 QR fragment URL | Tasks 4, 8, 14 (ADR amendment) |
| §2.4 Username collision 409 | Task 11 (inherits from existing link-opaque/finish behaviour) |
| §2.5 Unified join endpoints | Tasks 10, 11, 12 |
| §2.6 Step-up implicit Redis check | Tasks 5, 6, 8 |
| §2.7 issuer_label + note both retained | Task 4 |
| §2.8 Empty pairing-code body | Task 8 |
| §2.9 Pairing /finish returns wrapped MK | Task 11 |
| §2.10 Wrapping-integrity guarantee | Task 11 |
| §2.11 username in pairing /start response | Task 10 |
| §3 Endpoint table | Tasks 1, 4, 8, 9, 10, 11, 12 |
| §4 All endpoint shapes | Tasks 4, 8, 9, 10, 11 |
| §5 Step-up integration | Tasks 5, 6 |
| §6 Rate limits | Inherits from existing `consumePendingCodeAttempt` (Task 3 rename); needs verification in Task 11 audit |
| §7 DB schema | Task 2 |
| §8 ADR migration impact | Task 14 |
| §9 Manual verification | Chris runs after Squash β before any signal of "done" |

**Spec deviation to flag:** §4.5 GET response with `code: "RWVG3-K8YJL"` is impossible because we HMAC-store codes. Task 9 surfaces `null` and updates the spec inline. Flag during Squash β Larissa audit.

---

## Execution Handoff

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for this plan because Squashes α and β are large and a fresh context per task keeps quality up.

2. **Inline Execution** — Execute tasks in this session via `superpowers:executing-plans`, with checkpoints at the end of each task. Slower to spawn but no subagent context-handoff overhead.

Pick one.
