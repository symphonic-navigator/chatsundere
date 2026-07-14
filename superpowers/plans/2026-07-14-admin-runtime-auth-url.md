# Admin Runtime Auth URL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin console resolve its auth base URL at runtime from the linked account row, so it mounts in the generic production image instead of throwing at module scope.

**Architecture:** The linked account row in the crypto IndexedDB is the source of truth. `decision-tree.ts` already reads that row on every start and discards it — it will publish it into `useAccountLinkStore` (the shared store the user-client already uses). A new `effectiveAuthUrl()` reads the store, mirroring `apps/user-client/src/lib/server-urls.ts` including its dev-override rule. `VITE_SYNC_URL` and `VITE_PROXY_URL` are deleted outright (zero usages); `VITE_AUTH_URL` becomes an optional dev-only override.

**Tech Stack:** TypeScript (strict), React 18, valibot, zustand (via `@chatsundere/ui-shared`), Vitest.

**Spec:** `superpowers/specs/2026-07-14-admin-runtime-auth-url-design.md`

## Global Constraints

- Every text artefact is **British English** — code, comments, commit messages, error strings (CLAUDE.md §3.7).
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. No `any` without an inline justification.
- Every package-public function carries at least a one-line JSDoc (CLAUDE.md §10).
- No comments that restate the code. Comments explain non-obvious *why*.
- Commit messages: free-form imperative, subject line capitalised, no Conventional Commits prefix. Co-author trailer: `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`.
- **Do not merge, push, tag, or switch branches.** Those are Liz's alone.
- Frontend tests run under Vitest: `pnpm --filter admin-client test`.
- The gate before hand-back is `pnpm typecheck --force` (not `build` alone, and `--force` because Turbo caches typecheck).

## Task Order

Ordered by import dependency so every intermediate state compiles. `server-urls.ts` is created first while `env.ts` still declares `VITE_AUTH_URL` as a required string (assignable either way); `api.ts` moves onto it next; `env.ts` is slimmed **last**, once nothing references the deleted keys. Reordering breaks `tsc` mid-plan.

---

### Task 1: `effectiveAuthUrl()`

**Files:**
- Create: `apps/admin-client/src/lib/server-urls.ts`
- Test: `apps/admin-client/tests/unit/server-urls.test.ts`

**Interfaces:**
- Consumes: `useAccountLinkStore` from `@chatsundere/ui-shared` (exported at `packages/ui-shared/src/index.ts:14`; state field `baseUrl: string | null`). `env` from `../env.js`.
- Produces: `effectiveAuthUrl(): string` — returns the auth base URL, throws `Error` when none is available.

- [ ] **Step 1: Write the failing test**

Create `apps/admin-client/tests/unit/server-urls.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/env.js', () => ({
  env: { VITE_AUTH_URL: 'http://dev-override.test', VITE_USER_CLIENT_URL: '/' },
}));

import { effectiveAuthUrl } from '../../src/lib/server-urls.js';

describe('effectiveAuthUrl', () => {
  beforeEach(() => {
    useAccountLinkStore.setState({
      linkStatus: 'unknown',
      baseUrl: null,
      issuerLabel: null,
      role: null,
    });
  });

  it('returns the linked account base URL', () => {
    useAccountLinkStore.getState().setLinked({
      base_url: 'https://auth.example.com',
      issuer_label: 'Example',
      role: 'primary_admin',
    });
    expect(effectiveAuthUrl()).toBe('https://auth.example.com');
  });

  // Pins the property the user-client's server-urls.ts documents: a build that
  // is not the Vite dev server must never honour VITE_*. Vitest runs with
  // MODE === 'test', so devOverridesActive() is false here and the store wins
  // even though the mock supplies a VITE_AUTH_URL.
  it('ignores VITE_AUTH_URL outside the dev server', () => {
    useAccountLinkStore.getState().setLinked({
      base_url: 'https://auth.example.com',
      issuer_label: null,
      role: 'admin',
    });
    expect(effectiveAuthUrl()).toBe('https://auth.example.com');
  });

  it('throws when no linked account is published', () => {
    useAccountLinkStore.getState().setLocalOnly();
    expect(() => effectiveAuthUrl()).toThrow(/no linked account/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter admin-client test -- server-urls`
Expected: FAIL — cannot resolve `../../src/lib/server-urls.js`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/admin-client/src/lib/server-urls.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { env } from '../env.js';

/**
 * Mirrors apps/user-client/src/lib/server-urls.ts: the VITE_* values are
 * dev-only overrides, honoured exclusively under the Vite dev server, so a
 * production build can never pin a stale URL and tests never inherit a
 * developer's `.env`.
 */
function devOverridesActive(): boolean {
  return import.meta.env.DEV && import.meta.env.MODE !== 'test';
}

/**
 * The auth-service base URL for this session, taken from the linked account
 * row that the pre-login decision tree publishes.
 *
 * Throws rather than returning null: the decision tree guarantees a linked row
 * before the login form renders, and every data-layer call runs after login. A
 * missing value here is a wiring fault (a route past the login), not a user
 * state, and naming it at the point of failure beats twelve null-checks that
 * defer the diagnosis (spec §5).
 */
export function effectiveAuthUrl(): string {
  const override = devOverridesActive() ? env.VITE_AUTH_URL : undefined;
  const url = override ?? useAccountLinkStore.getState().baseUrl;
  if (!url) {
    throw new Error('No linked account — the pre-login decision tree must run first');
  }
  return url;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter admin-client test -- server-urls`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-client/src/lib/server-urls.ts apps/admin-client/tests/unit/server-urls.test.ts
git commit -m "Add effectiveAuthUrl for the admin console

Mirrors the user-client's server-urls dev-override rule so a production
build can never pin a stale URL. Reads the linked account base URL from
the shared account-link store.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 2: Publish the linked account row from the decision tree

**Files:**
- Modify: `apps/admin-client/src/routes/login/decision-tree.ts:22-33`
- Test: `apps/admin-client/tests/unit/decision-tree-publishes-account.test.ts` (create)

**Interfaces:**
- Consumes: `getLinkedAccount`, `getLocalAccount`, `openLocalDb` from `@chatsundere/crypto` (already imported). `useAccountLinkStore` from `@chatsundere/ui-shared`; `setLinked` takes `Pick<LinkedAccountRow, 'base_url' | 'issuer_label' | 'role'>`, so the row passes through unchanged.
- Produces: no signature change. `runDecisionTreePreLogin()` still returns `Promise<PreLoginResult>`; it now has the side effect of populating `useAccountLinkStore`.

- [ ] **Step 1: Write the failing test**

Create `apps/admin-client/tests/unit/decision-tree-publishes-account.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getLocalAccountMock = vi.fn();
const getLinkedAccountMock = vi.fn();
const closeMock = vi.fn();

vi.mock('@chatsundere/crypto', () => ({
  openLocalDb: () => Promise.resolve({ close: closeMock }),
  getLocalAccount: (db: unknown) => getLocalAccountMock(db),
  getLinkedAccount: (db: unknown) => getLinkedAccountMock(db),
}));

import { runDecisionTreePreLogin } from '../../src/routes/login/decision-tree.js';

const LINKED_ROW = {
  server_user_id: 'u-1',
  base_url: 'https://auth.example.com',
  issuer_label: 'Example',
  role: 'primary_admin' as const,
};

describe('runDecisionTreePreLogin account publication', () => {
  beforeEach(() => {
    getLocalAccountMock.mockReset();
    getLinkedAccountMock.mockReset();
    closeMock.mockReset();
    useAccountLinkStore.setState({
      linkStatus: 'unknown',
      baseUrl: null,
      issuerLabel: null,
      role: null,
    });
  });

  it('publishes the linked row so the data layer can reach the server', async () => {
    getLocalAccountMock.mockResolvedValue({ id: 'local' });
    getLinkedAccountMock.mockResolvedValue(LINKED_ROW);
    // jsdom reports navigator.onLine as true by default, which is the
    // 'ready' precondition — no stubbing needed.

    const result = await runDecisionTreePreLogin();

    expect(result.branch).toBe('ready');
    expect(useAccountLinkStore.getState().baseUrl).toBe('https://auth.example.com');
    expect(useAccountLinkStore.getState().role).toBe('primary_admin');
  });

  it('marks the store local-only when the account is not linked', async () => {
    getLocalAccountMock.mockResolvedValue({ id: 'local' });
    getLinkedAccountMock.mockResolvedValue(null);

    const result = await runDecisionTreePreLogin();

    expect(result.branch).toBe('no_link');
    expect(useAccountLinkStore.getState().linkStatus).toBe('local-only');
    expect(useAccountLinkStore.getState().baseUrl).toBeNull();
  });

  it('closes the database even when a branch returns early', async () => {
    getLocalAccountMock.mockResolvedValue(null);
    await runDecisionTreePreLogin();
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter admin-client test -- decision-tree-publishes-account`
Expected: FAIL — `baseUrl` is `null`, expected `'https://auth.example.com'`.

- [ ] **Step 3: Write minimal implementation**

In `apps/admin-client/src/routes/login/decision-tree.ts`, add the import:

```ts
import { useAccountLinkStore } from '@chatsundere/ui-shared';
```

Replace the body of `runDecisionTreePreLogin` (currently lines 22-33):

```ts
export async function runDecisionTreePreLogin(): Promise<PreLoginResult> {
  const db = await openLocalDb();
  try {
    const local = await getLocalAccount(db);
    if (!local) return { branch: 'no_account' };
    const linked = await getLinkedAccount(db);
    if (!linked) {
      useAccountLinkStore.getState().setLocalOnly();
      return { branch: 'no_link' };
    }
    // The row we just read carries the auth base URL the data layer needs
    // (spec §3). Publishing it here avoids a second IndexedDB open racing
    // this one; ui-shared's initAccountLinkFromDb is deliberately not used.
    useAccountLinkStore.getState().setLinked(linked);
    if (!navigator.onLine) return { branch: 'offline' };
    return { branch: 'ready' };
  } finally {
    db.close();
  }
}
```

Note the publication happens **before** the `navigator.onLine` check: an offline operator still has a valid linked row, and the retry path must not depend on ordering.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter admin-client test -- decision-tree-publishes-account`
Expected: PASS, 3 tests.

- [ ] **Step 5: Verify the existing decision-tree tests still pass**

Run: `pnpm --filter admin-client test -- login-decision-tree`
Expected: PASS. That suite mocks `decision-tree.js` wholesale, so it is unaffected — confirm rather than assume.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-client/src/routes/login/decision-tree.ts apps/admin-client/tests/unit/decision-tree-publishes-account.test.ts
git commit -m "Publish the linked account row from the admin decision tree

The tree already read the row on every start and discarded it, while the
data layer answered the same question from a build-time env value. It now
publishes what it reads into the shared account-link store.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 3: Move the data layer onto `effectiveAuthUrl()`

**Files:**
- Modify: `apps/admin-client/src/data/api.ts` — the `env` import at line 16, and `baseUrl:` at lines 54, 68, 81, 90, 99, 108, 117, 130, 148, 157, 175, 189
- Modify: `apps/admin-client/tests/unit/data-api.test.ts:9-11`

**Interfaces:**
- Consumes: `effectiveAuthUrl()` from Task 1 (`../lib/server-urls.js`).
- Produces: no public signature change. All twelve exported data functions keep their names and types.

- [ ] **Step 1: Update the test mock to the new seam**

In `apps/admin-client/tests/unit/data-api.test.ts`, replace the env mock (lines 9-11):

```ts
vi.mock('../../src/lib/server-urls.js', () => ({
  effectiveAuthUrl: () => 'http://auth.test',
}));
```

The existing assertions on `opts.baseUrl === 'http://auth.test'` stay valid unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter admin-client test -- data-api`
Expected: FAIL — `api.ts` still reads `env.VITE_AUTH_URL` while the mock now supplies `effectiveAuthUrl`, so `opts.baseUrl` no longer matches `'http://auth.test'`.

The *shape* of the failure depends on the machine: Vite loads `.env` files into `import.meta.env` under Vitest too. With a local `apps/admin-client/.env` present, the real `env.ts` parses fine and the assertions fail on the wrong `baseUrl`. Without one, `env.ts` throws at import and the whole file errors — which is this bug reproduced in a test. Either failure is expected; Step 3 is the fix in both cases. Do not "fix" it by adding a `.env`.

- [ ] **Step 3: Write minimal implementation**

In `apps/admin-client/src/data/api.ts`, replace the import on line 16:

```ts
import { effectiveAuthUrl } from '../lib/server-urls.js';
```

Then replace every one of the twelve occurrences of:

```ts
    baseUrl: env.VITE_AUTH_URL,
```

with:

```ts
    baseUrl: effectiveAuthUrl(),
```

Line 189 is indented one level deeper (six spaces, inside a nested call) — preserve its indentation.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter admin-client test -- data-api`
Expected: PASS.

- [ ] **Step 5: Verify no env references remain in the data layer**

Run: `rg -n "env\.VITE_AUTH_URL" apps/admin-client/src`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-client/src/data/api.ts apps/admin-client/tests/unit/data-api.test.ts
git commit -m "Resolve the admin data layer's base URL at runtime

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 4: Slim the env schema so it cannot throw

**Files:**
- Modify: `apps/admin-client/src/env.ts`
- Modify: `apps/admin-client/.env.example`
- Test: `apps/admin-client/tests/unit/env-schema.test.ts` (create)

**Interfaces:**
- Produces: `EnvSchema` (newly exported — the seam the regression test asserts against) and `env: { VITE_AUTH_URL?: string; VITE_USER_CLIENT_URL: string }`.

- [ ] **Step 1: Write the failing test**

Create `apps/admin-client/tests/unit/env-schema.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { EnvSchema } from '../../src/env.js';

describe('EnvSchema', () => {
  // The regression test for the bug this plan fixes: the production image
  // supplies no VITE_* at all (apps/user-client/Dockerfile:60 passes only
  // VITE_BASE). A schema that rejects that empty environment throws at module
  // scope, before createRoot runs, and the admin renders nothing but its
  // background.
  it('accepts an environment with no VITE_ values at all', () => {
    const result = v.safeParse(EnvSchema, {});
    expect(result.success).toBe(true);
  });

  it('defaults the user-client URL to the domain root', () => {
    const result = v.safeParse(EnvSchema, {});
    expect(result.success && result.output.VITE_USER_CLIENT_URL).toBe('/');
  });

  it('still rejects a malformed dev override, loudly', () => {
    const result = v.safeParse(EnvSchema, { VITE_AUTH_URL: 'not-a-url' });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter admin-client test -- env-schema`
Expected: FAIL — `EnvSchema` is not exported, and the first case would fail anyway because the schema requires three URLs.

- [ ] **Step 3: Write minimal implementation**

Replace `apps/admin-client/src/env.ts` in full:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import * as v from 'valibot';

/**
 * Every field is optional, so this schema cannot reject the production
 * environment — the image supplies no VITE_* values and the parse below runs
 * at module scope, before React mounts (spec §1). Exported so the regression
 * test can assert that property directly.
 *
 * VITE_AUTH_URL is a dev-only override; the auth base URL comes from the
 * linked account row at runtime (see lib/server-urls.ts). VITE_SYNC_URL and
 * VITE_PROXY_URL were removed — the admin never read them.
 */
export const EnvSchema = v.object({
  VITE_AUTH_URL: v.optional(v.pipe(v.string(), v.url())),
  // Where "Open user-client" sends the operator. In production the user-client
  // sits at the domain root and the admin-client under /admin/, so `/` is
  // correct; in dev the two run on separate ports, so this is the full origin
  // (e.g. http://localhost:3000). Not v.url() — `/` is a valid relative value.
  VITE_USER_CLIENT_URL: v.optional(v.pipe(v.string(), v.minLength(1)), '/'),
});

export const env = v.parse(EnvSchema, import.meta.env);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter admin-client test -- env-schema`
Expected: PASS, 3 tests.

- [ ] **Step 5: Prune the example env file**

Replace `apps/admin-client/.env.example` in full:

```
# Dev-only override. In production the admin reads the auth base URL from the
# linked account row in the shared IndexedDB (see src/lib/server-urls.ts).
VITE_AUTH_URL=http://localhost:3100
# In production leave this as `/` (user-client at the domain root, admin under
# /admin/). In dev the user-client runs on its own port.
VITE_USER_CLIENT_URL=http://localhost:3000
```

- [ ] **Step 6: Verify the deleted keys are gone repo-wide**

Run: `rg -n "VITE_SYNC_URL|VITE_PROXY_URL" apps/admin-client`
Expected: no output.

Note: `apps/user-client` keeps both keys — they are live there (`src/lib/server-urls.ts:16,21`). Do not touch them.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-client/src/env.ts apps/admin-client/.env.example apps/admin-client/tests/unit/env-schema.test.ts
git commit -m "Stop the admin env parse from throwing on a production build

Drop VITE_SYNC_URL and VITE_PROXY_URL, which the admin never read but
whose absence crashed it at module scope, and make VITE_AUTH_URL an
optional dev override.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 5: Full gate

**Files:** none — verification only.

- [ ] **Step 1: Run the whole admin suite**

Run: `pnpm --filter admin-client test`
Expected: PASS, no failures. Report the exact counts; do not round or summarise.

- [ ] **Step 2: Run the typecheck gate**

Run: `pnpm typecheck --force`
Expected: 14/14 successful, 0 cached. `--force` is required — Turbo will otherwise serve a cached pass and hide a real break.

- [ ] **Step 3: Run Biome**

Run: `pnpm exec biome check apps/admin-client`
Expected: no errors. The pre-commit hook runs Biome only, so a formatting miss blocks the commit rather than the tests.

- [ ] **Step 4: Verify the admin builds and mounts without any VITE_ values**

Run: `pnpm --filter admin-client build`
Expected: build succeeds.

Then confirm the built bundle carries no baked auth host:

Run: `rg -c "localhost:3100" apps/admin-client/dist/assets/*.js || echo "no dev URL baked in"`
Expected: `no dev URL baked in`.

- [ ] **Step 5: Report back to Liz**

Do not merge, push, or tag. Report: the test counts, the typecheck result, and anything that surprised you.

## Notes for the implementer

- **Why the order matters.** `env.ts` is slimmed last on purpose. Making `VITE_AUTH_URL` optional while `api.ts` still reads `env.VITE_AUTH_URL` gives `string | undefined` where `apiFetch` wants `string`, so `tsc` breaks mid-plan. `server-urls.ts` compiles against both the old and the new schema, which is what makes the ordering safe.
- **The dev-override path is not unit-tested.** Under Vitest `import.meta.env.MODE` is `'test'`, so `devOverridesActive()` is always false; forcing it true means stubbing Vite's statically-replaced env, which is brittle. The property that matters for production — that the override is *not* honoured — is covered by Task 1's second test. The dev path is exercised by `./dev.sh` daily.
- **Do not touch `packages/ui-shared`.** `useAccountLinkStore` and `setLinked` already fit exactly; `setLinked` takes `Pick<LinkedAccountRow, 'base_url' | 'issuer_label' | 'role'>` and the row is passed straight through.
- **Task 2's `@chatsundere/crypto` mock may need widening.** It replaces the module for that test file, and `ui-shared` also imports from `crypto` (`account-link.store.ts` pulls in `getLinkedAccount`). The three functions in the factory cover what `decision-tree.ts` and the store need today. If the import graph pulls in another `crypto` export and the test dies with "… is not a function", add that export to the factory — do not delete the mock or reach past the package boundary to import the store from its source path.
- **Vite HMR ignores `packages/*`.** If you change anything under `packages/` (you should not need to), restart the dev server — HMR will not pick it up.
