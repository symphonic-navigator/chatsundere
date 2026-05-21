# QA Fixes from Squash C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two QA findings from Squash C — the live-database truncation by `full-lifecycle.test.ts`, and the `session.mk` disappearance after disconnect-without-logout — and ship both as one squash before any further dev cycle.

**Architecture:** Two independent bugs, one squash.

1. **Test-isolation fix** introduces a dedicated `auth_db_test` Postgres database (created on first dev-compose boot via `infra/postgres/init/`) and a required `TEST_DATABASE_URL` env var. `full-lifecycle.test.ts` refuses to run without it. The fix is structural — wrong env makes the failure mode impossible rather than discouraged.
2. **`session.mk` fix** is investigation-driven. The root cause is not yet known, only narrowed to "something between `handleDisconnect` and `/linking/confirm` overwrites the session store entry without preserving `mk`". The plan: deterministic reproduction with targeted instrumentation, hypothesis triage, regression test, then a targeted fix. The likely shape (per `obsidian/insights/2026-05-20-mk-lost-after-disconnect.md` §"Fix shape") is to have `useSessionStore` own MK lifecycle so callers cannot accidentally drop it through partial-spread `setSession` calls. The plan locks in the regression-test contract; the implementation shape follows the evidence.

**Tech Stack:** Bun test runner, PostgreSQL 16, Drizzle, React 18, Zustand, Vitest.

**Larissa gate:** Phase 2 touches the in-memory MK lifecycle (`packages/ui-shared` session store + `apps/user-client` consumers). Per CLAUDE.md §9 + `obsidian/insights/2026-05-20-pattern-frontend-changes-affecting-crypto-semantics.md`, Larissa audits before squashing. Phase 1 (test isolation) is auth-service-internal; Liz judgement call whether to include in the Larissa pass.

**Squash boundary:** one commit at the end. Iterative checkpoints during work are encouraged (one per task), squashed at the end via `git reset --soft <pre-Phase-1>` + `git commit`.

---

## File Map

### Phase 1 — Test isolation

- **Create** `infra/postgres/init/02-create-test-db.sql` — Postgres init script that creates `auth_db_test` on first compose-up. Owned by `chatsundere`. Idempotent (`IF NOT EXISTS`).
- **Modify** `apps/auth-service/src/env.ts` — add optional `TEST_DATABASE_URL` to schema; required only when `NODE_ENV=test`.
- **Modify** `apps/auth-service/.env.example` — document `TEST_DATABASE_URL`, including the prod-DB-protection rationale.
- **Modify** `apps/auth-service/tests/integration/full-lifecycle.test.ts` — replace `DATABASE_URL` use with `TEST_DATABASE_URL`; refuse to run if absent (no fallback to `DATABASE_URL`).
- **Modify** `apps/auth-service/drizzle.config.ts` — read `TEST_DATABASE_URL` when `NODE_ENV=test`; otherwise `DATABASE_URL`. (For schema-push into the test DB.)
- **Modify** `apps/auth-service/package.json` — add `test:integration` script that sets `NODE_ENV=test` and `TEST_DATABASE_URL` from `.env.test`.
- **Create** `apps/auth-service/.env.test` (gitignored — see modify below) — local override pointing at `auth_db_test`.
- **Modify** `apps/auth-service/.gitignore` (or root) — ensure `.env.test` is ignored.
- **Modify** `README.md` (root or auth-service) — one paragraph documenting the test-DB setup.

### Phase 2 — `session.mk` investigation + fix

- **Modify** `packages/ui-shared/src/state/session.store.ts` — likely change: replace `setSession(session)` with a method shape that requires `mk` to be passed explicitly (or owns it internally) so that partial updates cannot drop it. Exact shape decided after investigation.
- **Modify** `apps/user-client/src/routes/linking/confirm.tsx:122` — adapt to the new store API.
- **Modify** `apps/user-client/src/routes/login/index.tsx:89,107,183` — adapt to the new store API.
- **Modify** `apps/user-client/src/routes/login/recovery.tsx:182,188` — adapt to the new store API.
- **Modify** `apps/user-client/src/routes/create-account/index.tsx:29` — adapt to the new store API.
- **Modify** `apps/user-client/src/lib/fetch.ts:91` — adapt `updateAccessToken` if the store shape changes (it shouldn't need to, but verify).
- **Create** `packages/ui-shared/src/state/session.store.test.ts` — regression test: "disconnect-then-relink without logout preserves `mk`". This is the contract that locks the fix in place even if the store internals get refactored later.

---

## Phase 1 — Test isolation

### Task 1: Add `auth_db_test` Postgres init script

**Files:**
- Create: `infra/postgres/init/02-create-test-db.sql`

- [ ] **Step 1: Write the init script**

```sql
-- Create the test database used by integration tests. Idempotent so that
-- restarting the dev compose without wiping the postgres volume is a no-op.
--
-- This database is created on first compose-up by virtue of being in the
-- /docker-entrypoint-initdb.d directory. Postgres only runs init scripts
-- when initialising an empty data directory. If you change this file and
-- the test DB already exists, run:
--
--   docker compose -f infra/compose.dev.yml down -v postgres
--   docker compose -f infra/compose.dev.yml up -d postgres
--
-- to rebuild the postgres volume from scratch.

SELECT 'CREATE DATABASE auth_db_test OWNER chatsundere'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'auth_db_test')\gexec
```

The `\gexec` trick is the standard Postgres way to conditionally `CREATE DATABASE`: `CREATE DATABASE` cannot run inside `DO $$ ... $$` blocks or transactions, so the `SELECT ... \gexec` pattern emits the statement only when the WHERE clause matches.

- [ ] **Step 2: Verify the script lands**

Run: `ls infra/postgres/init/`
Expected: shows `01-...` (any existing entry) and `02-create-test-db.sql`.

- [ ] **Step 3: Create `auth_db_test` on the running Postgres instance**

The init script in `infra/postgres/init/` only runs on a **first**-boot Postgres (empty data directory). The running dev instance already has data we don't want to wipe (Chris's `primary_admin`, etc.), so we create the test DB ad-hoc via `psql` against the running container. The init script remains in place for future fresh setups (or CI).

Run (use `-t` not `-it` — there's no interactive TTY in scripted execution):

```bash
docker exec -t chatsundere-dev-postgres-1 \
  psql -U chatsundere -c "CREATE DATABASE auth_db_test OWNER chatsundere;"
```

Expected: `CREATE DATABASE` on stdout, exit code 0.

If the database already exists from a prior run, the command fails with `database "auth_db_test" already exists`. That's fine — proceed to Step 4.

- [ ] **Step 4: Verify `auth_db_test` exists**

Run: `docker exec -t chatsundere-dev-postgres-1 psql -U chatsundere -l`
Expected: lists both `auth_db` and `auth_db_test`, both owned by `chatsundere`.

- [ ] **Step 5: Commit**

```bash
git add infra/postgres/init/02-create-test-db.sql
git commit -m "Add auth_db_test init script for integration-test isolation"
```

---

### Task 2: Add `TEST_DATABASE_URL` to the auth-service env schema

**Files:**
- Modify: `apps/auth-service/src/env.ts`
- Modify: `apps/auth-service/.env.example`

- [ ] **Step 1: Extend the env schema with an optional `TEST_DATABASE_URL`**

Edit `apps/auth-service/src/env.ts` to add the field. The field is `optional` from the schema's perspective so production deployments don't fail validation. The `loadEnv` function returns it; callers that need it (the integration test) check presence themselves.

Apply this edit:

```ts
// Add to imports if not present:
import { optional } from 'valibot';

// In envSchema, alongside DATABASE_URL:
TEST_DATABASE_URL: optional(pipe(string(), regex(/^postgres:\/\//))),

// In the loadEnv return type, add:
TEST_DATABASE_URL?: string;

// In the parse(...) call's input, add:
TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
```

- [ ] **Step 2: Update `.env.example` with documentation**

Edit `apps/auth-service/.env.example`. After the existing `DATABASE_URL` line, add:

```
# Test database — used by integration tests. MUST be a separate database from
# DATABASE_URL; integration tests truncate this DB on each run.
# The dev compose creates auth_db_test on first boot; the URL below matches.
# Production deployments leave this unset.
TEST_DATABASE_URL=postgres://chatsundere:dev@localhost:5432/auth_db_test
```

- [ ] **Step 3: Verify type-check still passes**

Run: `pnpm --filter @chatsundere/auth-service build`
Expected: exit code 0, no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/auth-service/src/env.ts apps/auth-service/.env.example
git commit -m "Add optional TEST_DATABASE_URL env var to auth-service"
```

---

### Task 3: Wire `full-lifecycle.test.ts` to refuse running without `TEST_DATABASE_URL`

**Files:**
- Modify: `apps/auth-service/tests/integration/full-lifecycle.test.ts`

The current test gates on `process.env.DATABASE_URL`. We change the gate so:

1. The test reads `TEST_DATABASE_URL` and `REDIS_URL` for gating.
2. If `TEST_DATABASE_URL` is unset, the test skips with a clear message — *not* a fallback to `DATABASE_URL`.
3. `createDb()` is called with `TEST_DATABASE_URL` overriding `DATABASE_URL` for the duration of the test.

The cleanest path is a small wrapper: at the very top of the test file, before `createDb` is called, set `process.env.DATABASE_URL = process.env.TEST_DATABASE_URL`. The `createDb()` function reads `DATABASE_URL` via `loadEnv()` at call time, so the override is picked up. After the test, restore the original. Defensive: assert that the two URLs differ — refuse to run if they happen to be the same string.

- [ ] **Step 1: Add the env-override and safety assertion at the top of the test**

Replace lines 29-32 (the skip-flag and Origin constants) of `apps/auth-service/tests/integration/full-lifecycle.test.ts` with:

```ts
// The integration test truncates every table in beforeAll. To prevent this
// from ever happening against a real DATABASE_URL (dev or prod), we require
// a separate TEST_DATABASE_URL pointing at a dedicated database.
//
// If TEST_DATABASE_URL is unset, skip entirely — never fall back to
// DATABASE_URL. If it accidentally equals DATABASE_URL, refuse to run.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const skip = !TEST_DATABASE_URL || !REDIS_URL;

if (TEST_DATABASE_URL && TEST_DATABASE_URL === process.env.DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL and DATABASE_URL point at the same database. ' +
      'Set TEST_DATABASE_URL to a dedicated test database (e.g. auth_db_test).',
  );
}

// Override DATABASE_URL for the duration of this process so createDb() picks
// up the test DB. Saved + restored is not strictly needed because the process
// exits after the test, but explicit is better than implicit.
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
if (TEST_DATABASE_URL) process.env.DATABASE_URL = TEST_DATABASE_URL;

const ORIGIN = { Origin: 'http://localhost:3000' };
const JSON_ORIGIN = { 'Content-Type': 'application/json', ...ORIGIN };
```

- [ ] **Step 2: Restore `DATABASE_URL` after the test suite**

Find the `afterAll` block (around line 255). Just before `await closeDb();` add:

```ts
    // Restore the original DATABASE_URL so any subsequent code (e.g. when the
    // test process is reused) sees the unaltered env.
    if (ORIGINAL_DATABASE_URL !== undefined) {
      process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
    } else {
      delete process.env.DATABASE_URL;
    }
```

- [ ] **Step 3: Push the auth-service schema into `auth_db_test`**

Before running the test, the test DB needs the schema. Run the Drizzle migrations against `TEST_DATABASE_URL`:

```bash
cd apps/auth-service
TEST_DATABASE_URL=postgres://chatsundere:dev@localhost:5432/auth_db_test \
  DATABASE_URL=postgres://chatsundere:dev@localhost:5432/auth_db_test \
  bun run db:migrate
```

(The double-setting of both env vars is because `db:migrate` reads `DATABASE_URL`. Setting both is harmless and self-documenting.)

Expected: migrations run, "✓ migrations applied" or similar.

If `db:migrate` does not exist in `package.json`, run the migration script directly:

```bash
DATABASE_URL=postgres://chatsundere:dev@localhost:5432/auth_db_test \
  bun run src/db/migrations.ts
```

(Verify the actual path by inspecting `package.json` scripts and the migrations entry-point.)

- [ ] **Step 4: Run the integration test against the test DB**

```bash
cd apps/auth-service
TEST_DATABASE_URL=postgres://chatsundere:dev@localhost:5432/auth_db_test \
  REDIS_URL=redis://localhost:6379/0 \
  bun test tests/integration/full-lifecycle.test.ts
```

Expected: all 10 steps pass.

- [ ] **Step 5: Verify the live `auth_db` is untouched**

Connect to the live DB and check Chris's primary admin user is still there (assuming it existed before — if not, this step just verifies the user count is unchanged):

```bash
docker exec -it chatsundere-dev-postgres-1 \
  psql -U chatsundere -d auth_db -c "SELECT username, role FROM users;"
```

Expected: lists Chris's primary admin (or whatever was there before), unchanged.

- [ ] **Step 6: Verify the test refuses to run without `TEST_DATABASE_URL`**

```bash
cd apps/auth-service
REDIS_URL=redis://localhost:6379/0 bun test tests/integration/full-lifecycle.test.ts
```

Expected: the `describe.skipIf(skip)` block reports skipped tests; no DB access happens.

- [ ] **Step 7: Commit**

```bash
git add apps/auth-service/tests/integration/full-lifecycle.test.ts
git commit -m "Gate full-lifecycle integration test on TEST_DATABASE_URL"
```

---

### Task 4: Document the test-DB setup

**Files:**
- Modify: `apps/auth-service/README.md` (or root `README.md` — choose the one that already covers running tests; if both, the auth-service one is canonical for this)

- [ ] **Step 1: Add a "Running integration tests" section**

If a README section about tests already exists, extend it. Otherwise add a new top-level section. Contents:

```markdown
## Running integration tests

The full-lifecycle integration test truncates every table in `beforeAll`.
To prevent this from destroying dev or production data, it requires a
**separate** Postgres database via the `TEST_DATABASE_URL` env var.

The dev compose creates `auth_db_test` automatically on first boot
(see `infra/postgres/init/02-create-test-db.sql`). Apply the schema once:

\`\`\`bash
DATABASE_URL=postgres://chatsundere:dev@localhost:5432/auth_db_test \\
  bun run src/db/migrations.ts
\`\`\`

Then run integration tests:

\`\`\`bash
TEST_DATABASE_URL=postgres://chatsundere:dev@localhost:5432/auth_db_test \\
  REDIS_URL=redis://localhost:6379/0 \\
  bun test tests/integration/
\`\`\`

The test will refuse to run if `TEST_DATABASE_URL` is unset, and will
**throw** if `TEST_DATABASE_URL` equals `DATABASE_URL`.
```

- [ ] **Step 2: Verify it renders cleanly**

`cat` the file in the terminal; check that the code fences and headers look sensible.

- [ ] **Step 3: Commit**

```bash
git add apps/auth-service/README.md
git commit -m "Document TEST_DATABASE_URL setup for integration tests [skip ci]"
```

---

## Phase 2 — `session.mk` investigation + fix

### Task 5: Reproduce the bug deterministically

**Files:**
- Temporarily modify (will be reverted): `apps/user-client/src/routes/settings/server-linking.tsx`, `apps/user-client/src/routes/linking/confirm.tsx`, `apps/user-client/src/routes/login/index.tsx`

The goal of this task is to reproduce the bug reliably and add targeted instrumentation that tells us *exactly* where `mk` disappears. The instrumentation is throwaway — reverted before squash.

- [ ] **Step 1: Set up a reproducible local scenario**

1. Boot dev compose: `docker compose -f infra/compose.dev.yml up -d postgres redis`
2. Boot auth-service in dev: `cd apps/auth-service && bun run dev`
3. Boot user-client in dev: `cd apps/user-client && pnpm dev`
4. Create a primary_admin via bootstrap CLI (or use existing).
5. In the user-client, log in as primary_admin (passphrase path), then go to `/settings/server-linking` and confirm a linked state is shown.

- [ ] **Step 2: Add instrumentation that logs `session.mk` presence at every store transition**

Open `packages/ui-shared/src/state/session.store.ts` and add temporary logging inside `setSession`, `updateAccessToken`, `closeAndForget`, **and** at the top of every render of the consumer routes:

```ts
// TEMPORARY — remove before squash. Logs every store write with a stack
// trace so we can see who is mutating the session.
setSession: (session) => {
  // eslint-disable-next-line no-console
  console.log('[SESSION] setSession called', {
    hasMk: !!session.mk,
    mode: session.mode,
    mkLength: session.mk?.length,
    stack: new Error().stack?.split('\n').slice(1, 5).join('\n'),
  });
  set({ session });
},
```

Repeat the same `console.log` shape inside `updateAccessToken` and `closeAndForget`. In the latter, log just before `current.close()` runs.

- [ ] **Step 3: Add a render-time log in confirm.tsx and server-linking.tsx**

In `apps/user-client/src/routes/linking/confirm.tsx`, right after line 64 (`const [screen, setScreen] = ...`), add:

```ts
// TEMPORARY
const debugSession = useSessionStore.getState().session;
// eslint-disable-next-line no-console
console.log('[CONFIRM] render', {
  hasMk: !!debugSession?.mk,
  mkLength: debugSession?.mk?.length,
  mode: debugSession?.mode,
  screen: screen.kind,
});
```

Same shape in `server-linking.tsx` near the top of the component body.

- [ ] **Step 4: Walk the bug-reproducing sequence and capture the log**

In the browser dev-tools console, clear the log. Then execute the sequence from the insight (`obsidian/insights/2026-05-20-mk-lost-after-disconnect.md` §"What we saw"):

1. Confirm a linked-state in `/settings/server-linking`.
2. Click Disconnect, type the confirm token, confirm.
3. Wait for the UI to flip to "Not linked".
4. Click "Scan QR" or "Paste link" — paste a fresh invitation URL.
5. On the confirm screen, type the passphrase and click Confirm.

Save the full console log to a scratch file (`/tmp/session-mk-investigation.log`) for the next step.

- [ ] **Step 5: Identify the exact store transition that loses `mk`**

Scan the log. The expected pattern under the bug is:

- `[SESSION] setSession called` with `hasMk: true` (from initial login)
- `[CONFIRM] render` with `hasMk: true` (initial render)
- … various renders / mutations …
- Some store transition where `hasMk: false` first appears

The stack trace on the `setSession` call where `hasMk` flips to `false` names the culprit. Note the file:line.

If the culprit is *not* a `setSession` call (i.e. `hasMk` flips between renders with no intervening `setSession` log), the cause is something else — likely React strict-mode double-render or an effect that mutates the object reference outside the store. In that case, escalate: add a `Object.defineProperty` getter trap on `session.mk` inside the store to log access (this is heavier instrumentation; only do this if the lighter instrumentation does not name the culprit).

**Expected outcome:** one of the four candidates below is named in the stack trace:

| Candidate | File | Line |
|---|---|---|
| disconnect flow's connectivity transition | `server-linking.tsx` (or downstream `connectivity.ts`) | — |
| confirm-screen render-time `setSession` | `linking/confirm.tsx` | 122 |
| login-flow `setSession({ ...session, mk })` | `login/index.tsx` | 89, 107, 183 |
| router gate or root-level effect | `routes/gate.tsx` or `routes/root.tsx` | — |

Document the identified culprit in a scratch file at `obsidian/insights/2026-05-21-session-mk-rootcause.md`.

- [ ] **Step 6: Do NOT commit the instrumentation**

The instrumentation is throwaway. Leave it in the working tree for now — Task 6 may need to extend it. We revert all of it in Task 9 before squashing.

---

### Task 6: Write the failing regression test

**Files:**
- Create: `packages/ui-shared/src/state/session.store.test.ts`

This test locks in the contract: a sequence of plausible session updates after a disconnect must not drop `mk`. The test is store-level (no React, no router) so it runs fast and stays focused on the contract — the actual bug may be in the consumer code, but the *test contract* is at the store boundary, because that is where the fix should live (per the insight's "Fix shape" recommendation).

- [ ] **Step 1: Write the test**

```ts
// SPDX-License-Identifier: LGPL-3.0-only

import { describe, expect, it, beforeEach } from 'vitest';
import { useSessionStore } from './session.store.js';
import type { AppSession } from './session.store.js';

// Minimal AppSession stub. Real MasterKeySession comes from packages/crypto;
// for store-shape testing we only need the same property surface.
function makeStubSession(opts?: { mk?: Uint8Array }): AppSession {
  return {
    userId: 'u1',
    username: 'tester',
    mode: 'linked',
    accessToken: 'access-token-stub',
    mk: opts?.mk ?? new Uint8Array(32),
    close: () => {},
    // Any extra MasterKeySession fields the store may touch get stubbed
    // here as no-ops. Extend if the store's API surface grows.
  } as unknown as AppSession;
}

describe('useSessionStore', () => {
  beforeEach(() => {
    useSessionStore.setState({ session: null });
  });

  it('preserves mk after a partial-update sequence that mimics disconnect+relink', () => {
    const session = makeStubSession();
    useSessionStore.getState().setSession(session);

    // Simulate a sequence of partial updates that the disconnect+relink
    // flow exercises in production:
    // 1. updateAccessToken (typical refresh during the flow)
    useSessionStore.getState().updateAccessToken('new-token');

    // 2. setSession with a partial spread that does NOT explicitly carry mk.
    // This is the exact shape used by linking/confirm.tsx:122 after a
    // successful link: { ...currentSession, mode: 'linked' }.
    const current = useSessionStore.getState().session;
    if (!current) throw new Error('session unexpectedly null');
    useSessionStore.getState().setSession({ ...current, mode: 'linked' });

    // Contract: mk survives the sequence.
    const after = useSessionStore.getState().session;
    expect(after?.mk).toBeDefined();
    expect(after?.mk?.length).toBe(32);
  });

  it('preserves mk when re-linking after a disconnect-without-logout', () => {
    // This is the exact bug reported in
    // obsidian/insights/2026-05-20-mk-lost-after-disconnect.md.
    const session = makeStubSession();
    useSessionStore.getState().setSession(session);

    // Disconnect: handleDisconnect does NOT call setSession or closeAndForget.
    // So nothing happens to the store from the disconnect itself. We simulate
    // any intermediate store activity that might happen during the routing.
    useSessionStore.getState().updateAccessToken('refreshed-during-routing');

    // Re-link confirm screen: doLink reads currentSession.mk for linkToServer.
    // The pre-flight check at confirm.tsx:103 is the bug surface.
    const preflight = useSessionStore.getState().session;
    expect(preflight?.mk).toBeDefined(); // The bug is THIS being undefined.
  });
});
```

- [ ] **Step 2: Run the test — expect at least one failure**

```bash
cd packages/ui-shared
pnpm test session.store.test.ts
```

Expected:
- The first test (`preserves mk after a partial-update sequence`) — should *pass* on the current code because the partial spread does carry `mk` via `{...current, mode: 'linked'}`. If it fails, that itself reveals the bug.
- The second test (`preserves mk when re-linking after a disconnect-without-logout`) — depending on what Task 5 found, this may pass or fail at the store level. If the bug is in consumer code (e.g. a router-level effect), this store-level test cannot reproduce it; in that case the test needs to be elevated to a user-client integration test that mounts the actual route components.

If the store-level tests pass but the bug still happens in the browser, write a user-client integration test using Vitest + React Testing Library that mounts the relevant routes and reproduces the sequence. File path: `apps/user-client/src/routes/__tests__/disconnect-then-relink.test.tsx`. This is the more expensive route but it is the only honest way to lock in the contract if the bug lives above the store.

- [ ] **Step 3: Commit the failing test**

```bash
git add packages/ui-shared/src/state/session.store.test.ts
git commit -m "Add regression test for session.mk preservation through partial updates"
```

(Or, if the failing test ended up at the user-client integration level:)

```bash
git add apps/user-client/src/routes/__tests__/disconnect-then-relink.test.tsx
git commit -m "Add regression test for disconnect-then-relink session.mk preservation"
```

---

### Task 7: Implement the targeted fix

**Files:**
- Modify: `packages/ui-shared/src/state/session.store.ts`
- Modify: each consumer of `setSession` whose call shape changes (see File Map above)

The fix shape depends on what Task 5 found. The two most likely shapes:

**Shape A — Investigation found that a specific `setSession` call drops `mk`.**

If the culprit is a partial-spread in a known site (most likely `linking/confirm.tsx:122`), the minimal fix is to spread `mk` explicitly at that site. But this is fragile — anyone adding a future call to `setSession` can repeat the mistake.

The better fix per the insight's "Fix shape" recommendation: move `mk` out of `AppSession`'s spread surface and into the store as a separate slice. Concretely:

```ts
interface SessionState {
  session: AppSession | null;
  mk: MasterKey | null;
  setSession(session: AppSession, mk?: MasterKey): void;
  updateAccessToken(token: string): void;
  closeAndForget(): void;
}
```

`setSession` takes `mk` as an explicit second argument. If omitted, the existing `mk` is preserved (this is the key change — partial updates no longer drop it). Consumers that want to update only the session metadata (e.g. `mode: 'linked'`) call `setSession(newSession)` without touching `mk`.

Pick this shape. Apply the corresponding changes to all consumers.

**Shape B — Investigation found a non-store culprit (router gate, App.tsx effect, strict-mode interaction).**

If the bug is *outside* the store, fixing the store alone is insufficient — but the store change above still makes the codebase more robust. Apply Shape A *plus* the targeted fix at the actual culprit site (whatever Task 5 named).

**For the plan below, assume Shape A. Adjust as the investigation requires.**

- [ ] **Step 1: Refactor `session.store.ts` to own `mk`**

Replace the entire body of `packages/ui-shared/src/state/session.store.ts` with:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { MasterKey, MasterKeySession } from '@chatsundere/crypto';
import { create } from 'zustand';

// AppSession is the session metadata. `mk` is kept in a separate slice of
// the store so partial-spread updates (`setSession({ ...current, mode: ... })`)
// cannot accidentally drop it. The store owns the MK lifecycle.
export type AppSession = MasterKeySession & { accessToken?: string };

interface SessionState {
  session: AppSession | null;
  mk: MasterKey | null;
  /**
   * Replace the session metadata. If `mk` is provided, it replaces the
   * current MK. If omitted, the existing MK is preserved — this is the
   * intentional default for partial-update flows like linking confirmation.
   */
  setSession(session: AppSession, mk?: MasterKey): void;
  updateAccessToken(token: string): void;
  closeAndForget(): void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  session: null,
  mk: null,
  setSession: (session, mk) => {
    if (mk !== undefined) {
      set({ session, mk });
    } else {
      set({ session });
    }
  },
  updateAccessToken: (token) => {
    const current = get().session;
    if (!current) return;
    set({ session: { ...current, accessToken: token } });
  },
  closeAndForget: () => {
    const current = get().session;
    if (current) current.close();
    set({ session: null, mk: null });
  },
}));
```

- [ ] **Step 2: Update consumers — `login/index.tsx`**

In `apps/user-client/src/routes/login/index.tsx`:

- Line 89: change `useSessionStore.getState().setSession({ ...session, mk });` to `useSessionStore.getState().setSession(session, mk);`
- Line 107: same change.
- Line 183 (`useSessionStore.getState().setSession(session);`): leave as-is — biometric unlock already passes the session-with-mk-in-closure path; the test will verify this case still works. If the biometric flow returns a session that includes `mk` as a closure property, decide based on the actual shape returned by `loginWithLocalBiometric`. Worst case, add `mk` as a second arg if the flow exposes it.

- [ ] **Step 3: Update consumers — `linking/confirm.tsx`**

In `apps/user-client/src/routes/linking/confirm.tsx`:

- Line 102-106: read `currentSession.mk` no longer works (mk is no longer on the session). Replace `useSessionStore.getState().session` with `useSessionStore.getState()` and read `.session` + `.mk` separately:

```ts
async function doLink() {
  const { session: currentSession, mk } = useSessionStore.getState();
  if (!currentSession || !mk) {
    setScreen({ kind: 'error', message: ce.unknown });
    return;
  }

  setScreen({ kind: 'working' });

  try {
    await linkToServer({
      db: getDb(),
      serverClient: httpServerClient,
      invitationToken: payload.token,
      baseUrl: payload.base_url,
      issuerLabel: payload.issuer_label,
      passphrase,
      mk,
    });

    useConnectivityStore.getState().onServerOk();
    useSessionStore.getState().setSession({ ...currentSession, mode: 'linked' });
    // mk is preserved automatically because setSession is called without an mk arg.

    // … rest unchanged …
  }
}
```

- Line 163-168: same destructure shape in `handleBiometricSync`.

- [ ] **Step 4: Update consumers — `login/recovery.tsx`**

The recovery flow already separates `session` and `mk` from `loginLocalWithRecoveryKey` (lines 172-173), but currently passes only `session` to `setSession` — that silently drops `mk` under the old store. The Shape A refactor *requires* passing `mk` explicitly here, which makes the implicit behaviour explicit (and actually correct).

In `apps/user-client/src/routes/login/recovery.tsx`:

```ts
// Line 182 — OLD:
useSessionStore.getState().setSession(session);
// NEW:
useSessionStore.getState().setSession(session, mk);

// Line 188 — OLD:
useSessionStore.getState().setSession(session);
// NEW:
useSessionStore.getState().setSession(session, mk);
```

Both sites have `mk` in lexical scope (lines 173 + 187 in the step2-deferred / step2-local branches respectively); the change is two characters per site.

- [ ] **Step 5: Update consumer — `create-account/index.tsx`**

`createLocalAccount` returns a `result` with `session`, `recoveryKeyString`, and (per the existing crypto package contract) the freshly-minted `mk`. Verify by reading `packages/crypto/src/flows/create-account.ts` to confirm the return shape includes `mk`.

In `apps/user-client/src/routes/create-account/index.tsx:28-29`:

```ts
// OLD:
const result = await createLocalAccount({ db: getDb(), username, passphrase });
useSessionStore.getState().setSession(result.session);

// NEW:
const result = await createLocalAccount({ db: getDb(), username, passphrase });
useSessionStore.getState().setSession(result.session, result.mk);
```

If `result.mk` does not exist on the current return type (because `mk` was being silently stuffed into `result.session` as an extra property), the right move is to **change `createLocalAccount`** to expose `mk` as a separate field of its return. That is a small `packages/crypto` change consistent with the store refactor — make the implicit explicit at the source.

- [ ] **Step 6: Update consumers that READ `session.mk` — `change-passphrase.tsx`, `auth-methods.tsx`, `webauthn.ts`**

After Step 1, `mk` no longer lives on the session — it lives on the store as its own slice. Every reader of `session.mk` migrates to read the store's `mk` directly.

Use grep to find every reader:

```bash
rg -n 'session\?\.mk|session\.mk' apps/user-client/src packages/ui-shared/src
```

Expected hits (apply each):

**`apps/user-client/src/routes/change-passphrase.tsx`** — two reader sites:

```ts
// Lines 150-155 — OLD:
const session = useSessionStore.getState().session;
if (!session?.mk) {
  setScreen({ kind: 'form', busy: true, error: c.errors.unknown });
  return;
}

// NEW:
const { session, mk } = useSessionStore.getState();
if (!session || !mk) {
  setScreen({ kind: 'form', busy: true, error: c.errors.unknown });
  return;
}
```

Then wherever the function body uses `session.mk` below this guard, use the locally-bound `mk` instead. Run `rg -n '\bmk\b|session\.mk' apps/user-client/src/routes/change-passphrase.tsx` after the edit to confirm every reference resolves correctly.

The same pattern applies to the second occurrence around line 91 (the redirect guard) — but that guard only checks `!session`, not `session.mk`, so it likely needs no change. Verify by re-reading.

**`apps/user-client/src/routes/settings/auth-methods.tsx`** — two reader sites:

```ts
// Lines 167-174 (in confirmRegen) — OLD:
const session = useSessionStore.getState().session;
if (!session?.mk) { setRegenState({ kind: 'idle' }); return; }
setRegenState({ kind: 'busy' });
try {
  const { recoveryKeyString } = await regenerateRecoveryKey({ db: getDb(), mk: session.mk });

// NEW:
const { mk } = useSessionStore.getState();
if (!mk) { setRegenState({ kind: 'idle' }); return; }
setRegenState({ kind: 'busy' });
try {
  const { recoveryKeyString } = await regenerateRecoveryKey({ db: getDb(), mk });
```

```ts
// Line 211 — OLD:
const canRegen = useSessionStore.getState().session?.mk !== undefined;

// NEW:
const canRegen = useSessionStore.getState().mk !== null;
```

**`apps/user-client/src/lib/webauthn.ts`** — one reader site:

```ts
// Lines 44-48 — OLD:
export async function registerLocalBiometric(label: string): Promise<void> {
  const session = useSessionStore.getState().session;
  if (!session) throw new Error('no active session');
  const userId = new TextEncoder().encode(session.userId);

// NEW (no functional change — registerLocalBiometric uses session metadata,
// not mk, so reads session as before; only adjust if a downstream call needs mk):
// (no change required here — verify by re-reading the function)
```

The `registerLocalBiometric` function passes `session` to `session.registerLocalBiometric(...)` which internally uses the MasterKeySession's closed-over MK. The function does not read `session.mk` directly, so no edit is needed. Verify by reading `packages/crypto/src/flows/...` (`registerLocalBiometric` method) to confirm it does not depend on the `mk` property surface.

- [ ] **Step 6b: Re-run the grep to confirm no `session.mk` reads remain**

```bash
rg -n 'session\?\.mk|session\.mk' apps/user-client/src packages/ui-shared/src
```

Expected: zero hits. If any remain, migrate them using the same pattern.

- [ ] **Step 7: Update `fetch.ts` if needed**

`apps/user-client/src/lib/fetch.ts:87,94` calls `closeAndForget()`. That now also nulls `mk`, which is correct — log-out paths should drop the MK. No change needed there. Verify by re-reading.

- [ ] **Step 8: Run the regression test — expect it to pass**

```bash
cd packages/ui-shared
pnpm test session.store.test.ts
```

Expected: both tests pass.

- [ ] **Step 9: Run the full user-client test suite**

```bash
cd apps/user-client
pnpm test
```

Expected: all green. If any test breaks because it assumed `session.mk`, fix it to read `mk` from the store directly (or pass a stub `mk` value where the test creates a session).

- [ ] **Step 10: Commit**

```bash
git add packages/ui-shared/src/state/session.store.ts apps/user-client/src
git commit -m "Move mk out of session-spread surface to prevent partial-update drops"
```

---

### Task 8: Remove instrumentation from Task 5

**Files:**
- Modify: `packages/ui-shared/src/state/session.store.ts` (revert temporary logging)
- Modify: `apps/user-client/src/routes/linking/confirm.tsx` (revert temporary logging)
- Modify: `apps/user-client/src/routes/settings/server-linking.tsx` (revert temporary logging)
- Delete: `obsidian/insights/2026-05-21-session-mk-rootcause.md` if it was a working note; promote it to a real insight if it contains learnings worth keeping.

- [ ] **Step 1: Search for any leftover `[SESSION]` or `[CONFIRM]` console.log lines**

```bash
rg -n '\[SESSION\]|\[CONFIRM\]' apps/ packages/
```

Expected: no hits. If hits remain, remove them.

- [ ] **Step 2: Promote or delete the scratch insight**

If `2026-05-21-session-mk-rootcause.md` contains learnings the next session would benefit from (e.g. "this was actually a router-level effect — watch out for X"), rename it to a descriptive name and link it from `obsidian/insights/follow-ups-index.md`. Otherwise delete.

- [ ] **Step 3: Verify the test suite still passes**

```bash
cd packages/ui-shared && pnpm test
cd apps/user-client && pnpm test
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Remove session-mk debug instrumentation"
```

---

### Task 9: Manual verification

Chris exercises the original bug-reproducing sequence on the device matrix:

- [ ] **Step 1: Sequence A — disconnect-then-relink without logout**

1. Log in as `primary_admin` (passphrase).
2. Settings → Server linking → Disconnect → confirm.
3. Scan/paste a fresh bootstrap invitation.
4. Type the passphrase, click Confirm.

Expected: linking completes successfully. No `"Couldn't complete linking"` error.

- [ ] **Step 2: Sequence B — biometric path (still works)**

1. Log in with biometric (if a passkey is registered).
2. Navigate around the app, change settings.

Expected: nothing regressed.

- [ ] **Step 3: Sequence C — passphrase change flow (still works)**

1. Log in (any path).
2. Settings → Change passphrase → enter old + new.

Expected: completes successfully. The `mk` is still readable inside the flow.

- [ ] **Step 4: Sequence D — recovery flow (still works)**

1. Use a recovery key on the login screen.
2. Verify `mk` is populated post-recovery (no error about missing `mk`).

Expected: completes successfully.

If any sequence regresses, stop and root-cause before squashing.

---

### Task 10: Larissa pre-squash audit

Per CLAUDE.md §9 + the frontend-changes-affecting-crypto-semantics pattern, MK custody changes go through Larissa.

- [ ] **Step 1: Summon Larissa with the staged diff**

Use the Agent tool with subagent_type=Explore (or general-purpose) and a prompt of the form:

```
You are Larissa, an Opus-class security auditor for Chatsundere. Audit the
changes in this branch (since master) that move `mk` out of the session
spread surface into a dedicated store slice. The diff touches MK custody —
the in-memory master key lifecycle.

Files to focus on:
- packages/ui-shared/src/state/session.store.ts (store shape change)
- apps/user-client/src/routes/linking/confirm.tsx (consumer)
- apps/user-client/src/routes/login/index.tsx (consumer)
- apps/user-client/src/routes/login/recovery.tsx (consumer)
- apps/user-client/src/routes/create-account/index.tsx (consumer)
- apps/user-client/src/routes/change-passphrase.tsx (consumer)
- apps/user-client/src/routes/settings/auth-methods.tsx (consumer)
- apps/user-client/src/lib/webauthn.ts (consumer)
- apps/user-client/src/lib/fetch.ts (logout path)

Concerns to evaluate:
1. Does the new store shape correctly null mk on closeAndForget? Are all logout/disconnect paths reaching it?
2. Does any consumer leak mk beyond its needed lifetime (e.g. stash it in a long-lived variable, log it, send it over the wire)?
3. Does the regression test (`packages/ui-shared/src/state/session.store.test.ts`) sufficiently cover the contract, or are there gaps a future regression could slip through?
4. Reference `obsidian/insights/security-deferrals.md` for the existing "Raw MK in login-flow returns" deferred concern. Does this change advance or undermine that follow-up?

Report findings with severity (Critical / High / Medium / Low) and concrete file:line references. Be terse.
```

- [ ] **Step 2: Address all Critical and High findings**

Per CLAUDE.md §9, these are not deferrable without Chris sign-off.

- [ ] **Step 3: Document deferred findings**

Move any Medium / Low findings into `obsidian/insights/security-deferrals.md` with a follow-up trigger. Update `obsidian/insights/follow-ups-index.md` to match.

---

### Task 11: Squash and final commit

- [ ] **Step 1: Inspect the working tree**

```bash
git status
git log --oneline master..HEAD
```

Expected: a small stack of per-task commits since the last master commit.

- [ ] **Step 2: Soft-reset to master and re-commit as one squash**

```bash
git reset --soft master
git status
```

Expected: all the per-task changes show as staged. Nothing in the working directory is lost.

- [ ] **Step 3: Create the final squash commit**

```bash
git commit -m "$(cat <<'EOF'
Fix QA findings from Squash C: test-isolation and session.mk lifecycle

Two independent bugs from Squash C manual QA, shipped together:

1. full-lifecycle.test.ts was truncating the live auth_db on every run.
   Now gated on TEST_DATABASE_URL pointing at a separate auth_db_test
   database (created by infra/postgres/init/02-create-test-db.sql on
   compose-up). The test refuses to run without it and throws if
   TEST_DATABASE_URL equals DATABASE_URL.

2. useSessionStore.session.mk could disappear after disconnect-without-logout
   because partial-spread setSession calls dropped the mk property. Moved mk
   to a separate store slice so partial updates can no longer drop it; all
   consumers updated to read mk from the store directly.

Larissa-audited. See obsidian/insights/2026-05-20-test-isolation-leak-full-lifecycle.md
and obsidian/insights/2026-05-20-mk-lost-after-disconnect.md for context.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -3
git status
```

Expected: one new commit on top of master, working tree clean.

- [ ] **Step 5: Update STATUS.md and follow-ups-index**

- Move the two QA-fund rows in `obsidian/insights/follow-ups-index.md` from "Active — Hygiene & Tooling" to "Resolved".
- Update `obsidian/STATUS.md` "Done" section with a one-liner for this squash. Refresh "Last updated:" date. Re-set "Doing now" to empty. Update "Next session" to the UV-relaxation plan.

- [ ] **Step 6: Commit the documentation update**

```bash
git add obsidian/STATUS.md obsidian/insights/follow-ups-index.md
git commit -m "Update STATUS and follow-ups-index after QA-fixes squash [skip ci]"
```
