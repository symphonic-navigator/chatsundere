# Admin Client (Squash C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-05-20
**Spec:** `superpowers/specs/2026-05-20-admin-client-design.md`
**Parent spec:** `superpowers/specs/2026-05-18-foundational-auth-layer-design.md` §6
**Related ADRs:** 0001 (Postgres over Mongo, for stub schema reference), 0008 (local-first identity), 0021 (OPAQUE-first linking; informs login flow)
**Related deferrals:** Live admin endpoints (suspend/delete/role-change/transfer-primary/invitations/audit) are explicitly deferred to a later auth-service squash once Lyra's invitation-and-pairing briefs land. This squash builds the UI against in-memory stubs.

**Goal:** Build `apps/admin-client` — the Catppuccin-themed operator console covering login, dashboard, users, invitations, and audit log. Reads `local_account` and `linked_account` from the shared IndexedDB (same-origin as user-client). Live login + role check against the auth-service; admin actions ride a stub layer until backend lands. Establish `packages/ui-shared` as the home for cross-app components (login hooks, session-store, connectivity-store, ConfirmTyped, InlineMarker, motion utilities).

**Architecture:** React 18 + TypeScript (strict) on Vite 6. Routing via React Router. State split: TanStack Query for any server interaction; Zustand for session and connectivity (both moved into `packages/ui-shared` so admin-client and user-client share). Form validation via Valibot. Tailwind v4 with a Catppuccin tokens layer (Mocha + Latte, system-preference-respecting). Login hooks are shared (`@chatsundere/ui-shared/login`) — UI is per-app.

**Data layer:** `AdminApi` interface (TS types) with three implementations: `live` (real HTTP against `/auth/v1/*`), `mock` (in-memory fixtures), `hybrid` (live for login + `/me`, mock for admin endpoints). Env-switched via `VITE_ADMIN_API_MODE=mock|live|hybrid`. Phase 0 default: `hybrid`. Mock state is in-memory only; reload resets to fixtures.

**Squash boundary:** A single squashed commit titled `Add admin-client and ui-shared package` once all tasks pass. Larissa audits two slices only: (a) self-target predicates + Users-detail action gating (audit H5 defence-in-depth) and (b) the delete-user ConfirmTyped flow. Rest is conventional frontend per CLAUDE.md §9. The audit runs *before* final-squash on the diff slice.

**Out of scope for Squash C (explicit):** Live admin endpoints in auth-service. Audit-event-write side from admin-client. WebSocket-driven live updates. Mobile-first responsive design for sub-600 px viewports (admin tool, operator UX assumed laptop+). Self-service auth-method management in admin-client (stays user-client only).

---

## File Structure

Files created or substantially rewritten in this squash:

```
packages/ui-shared/                              ← NEW workspace package
├── package.json
├── tsconfig.json
├── tsconfig.test.json
├── README.md
└── src/
    ├── index.ts                                 barrel exports
    ├── components/
    │   ├── ConfirmTyped.tsx                     moved from apps/user-client
    │   ├── InlineMarker.tsx                     moved from apps/user-client
    │   └── motion.ts                            moved from apps/user-client
    ├── login/
    │   ├── use-opaque-login-flow.ts             new — hook wrapping the OPAQUE login flow
    │   ├── use-passkey-login-flow.ts            new — hook wrapping the passkey login flow
    │   ├── login-error-copy.ts                  new — CryptoError → copy-key map
    │   └── index.ts
    ├── state/
    │   ├── session.store.ts                    moved from apps/user-client
    │   ├── connectivity.store.ts               moved from apps/user-client
    │   └── index.ts
    └── tests/
        ├── login-error-copy.test.ts             new
        ├── session.store.test.ts                moved
        └── connectivity.store.test.ts           moved

apps/user-client/                                ← MODIFIED — switch imports to @chatsundere/ui-shared
├── package.json                                 dep added: @chatsundere/ui-shared
└── src/                                          ConfirmTyped, InlineMarker, motion.ts,
                                                 session.store.ts, connectivity.store.ts
                                                 deleted; imports updated repo-wide

apps/admin-client/
├── package.json                                 deps added (react-router-dom, tanstack/react-query,
│                                                zustand, ui-shared, crypto, shared-types, vitest,
│                                                @testing-library/*, jsdom, fake-indexeddb,
│                                                qrcode for QR rendering on Create-invitation)
├── tsconfig.json                                kept
├── tsconfig.test.json                           new — typecheck tests without emit
├── tsconfig.node.json                           kept
├── vite.config.ts                               rewritten — vitest jsdom config, alias setup
├── tailwind.config.ts                           new — Catppuccin theme tokens
├── index.html                                   extended — manifest link, theme-color, title
├── .env.example                                 new — VITE_AUTH_URL, VITE_SYNC_URL, VITE_PROXY_URL,
│                                                VITE_ADMIN_API_MODE
├── README.md                                    rewritten — description, scripts, manual verification
├── src/
│   ├── main.tsx                                 rewritten — root + router + queryClient + boot
│   ├── App.tsx                                  rewritten — router only
│   ├── env.ts                                   modified — VITE_ADMIN_API_MODE added
│   ├── index.css                                rewritten — Tailwind layer + Catppuccin tokens
│   ├── copy.ts                                  new — British English UI strings
│   ├── lib/
│   │   ├── fetch.ts                             new — admin fetch wrapper (uses joinUrl)
│   │   ├── joinUrl.ts                           new — re-export of the joinUrl helper from ui-shared
│   │   ├── admin-route-guard.tsx                new — <AdminRouteGuard> component
│   │   ├── self-target.ts                       new — isSelfTarget, isPrimaryAdmin predicates
│   │   ├── format.ts                            new — relative time, pretty status pills
│   │   └── query-client.ts                      new — TanStack Query singleton
│   ├── data/
│   │   ├── admin-api.ts                         new — AdminApi interface + types
│   │   ├── admin-api.live.ts                    new — real HTTP impl
│   │   ├── admin-api.mock.ts                    new — in-memory stub impl
│   │   ├── admin-api.hybrid.ts                  new — composer
│   │   ├── mock-fixtures.ts                     new — initial in-memory state
│   │   └── index.ts                             new — env-driven switch
│   ├── routes/
│   │   ├── root.tsx                             new — layout + top-bar + sign-out button
│   │   ├── gate.tsx                             new — decides /login vs /dashboard on boot
│   │   ├── login/
│   │   │   ├── index.tsx                        new — login screen
│   │   │   ├── decision-tree.ts                 new — five-branch logic
│   │   │   └── failure-states.tsx               new — five sub-screens
│   │   ├── dashboard/
│   │   │   └── index.tsx                        new — counters + recent-activity
│   │   ├── users/
│   │   │   ├── index.tsx                        new — list + filters + pagination
│   │   │   ├── detail.tsx                       new — /users/:id panel
│   │   │   └── actions.tsx                      new — action buttons + self-target gating
│   │   ├── invitations/
│   │   │   ├── index.tsx                        new — list + status filter
│   │   │   ├── create-modal.tsx                 new — create form
│   │   │   └── reveal-screen.tsx                new — one-time QR + URL reveal
│   │   └── audit/
│   │       └── index.tsx                        new — list + filters + pagination + JSON expand
│   └── tests/
│       ├── unit/
│       │   ├── admin-api.mock.test.ts           new
│       │   ├── admin-route-guard.test.tsx       new
│       │   ├── self-target.test.ts              new
│       │   └── users-list-filter.test.ts        new
│       └── integration/
│           ├── login-decision-tree.test.tsx     new
│           └── invitation-create.test.tsx       new
```

**Branching:** Pre-public phase per ADR 0003, work directly on `master`. One squashed commit at the end. Intermediate commits use `Squash C / Task N: <title>` and may include `[skip ci]` for doc-only intermediates.

---

## Task 1 — Set up `packages/ui-shared` workspace package

**Files:**
- Create: `packages/ui-shared/package.json`
- Create: `packages/ui-shared/tsconfig.json`
- Create: `packages/ui-shared/tsconfig.test.json`
- Create: `packages/ui-shared/README.md`
- Create: `packages/ui-shared/src/index.ts`
- Create: `packages/ui-shared/src/components/.gitkeep`
- Create: `packages/ui-shared/src/login/.gitkeep`
- Create: `packages/ui-shared/src/state/.gitkeep`

- [ ] **Step 1: Write package.json**

```json
{
  "name": "@chatsundere/ui-shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "LGPL-3.0-only",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "rm -rf dist && tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.test.json",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@chatsundere/crypto": "workspace:^",
    "@chatsundere/shared-types": "workspace:^",
    "valibot": "^0.42.0",
    "zustand": "^5.0.0"
  },
  "peerDependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "fake-indexeddb": "^6.0.0",
    "jsdom": "^25.0.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "jsx": "react-jsx"
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*"]
}
```

- [ ] **Step 3: Write tsconfig.test.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 4: Write README.md**

```markdown
# @chatsundere/ui-shared

Shared client-side primitives used by `apps/user-client` and `apps/admin-client`.

Contents:

- `components/` — small UI building blocks reused in both clients (ConfirmTyped, InlineMarker, motion utilities). Pure JSX with no theme assumptions.
- `login/` — hooks and helpers that orchestrate OPAQUE and passkey login. Each client renders its own form on top.
- `state/` — Zustand stores for session and connectivity, shared across clients on the same origin.

Licence: LGPL-3.0-only. The crypto, login, and state code is library code per ADR 0002 and may be embedded in proprietary clients.
```

- [ ] **Step 5: Write src/index.ts as an empty barrel**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
// Re-exports populated by subsequent tasks.
export {};
```

- [ ] **Step 6: Create placeholder dirs**

Run: `touch packages/ui-shared/src/components/.gitkeep packages/ui-shared/src/login/.gitkeep packages/ui-shared/src/state/.gitkeep`

- [ ] **Step 7: Install deps**

Run: `pnpm install`
Expected: `+ @chatsundere/ui-shared@workspace`, no lockfile churn beyond the new package.

- [ ] **Step 8: Verify typecheck + build**

Run: `pnpm --filter @chatsundere/ui-shared typecheck && pnpm --filter @chatsundere/ui-shared build`
Expected: both pass, `dist/index.js` and `dist/index.d.ts` created.

- [ ] **Step 9: Commit**

```bash
git add packages/ui-shared pnpm-lock.yaml
git commit -m "Squash C / Task 1: scaffold packages/ui-shared workspace"
```

---

## Task 2 — Move state stores and shared components into ui-shared

**Files:**
- Move: `apps/user-client/src/state/session.store.ts` → `packages/ui-shared/src/state/session.store.ts`
- Move: `apps/user-client/src/state/connectivity.store.ts` → `packages/ui-shared/src/state/connectivity.store.ts`
- Move: `apps/user-client/src/components/ConfirmTyped.tsx` → `packages/ui-shared/src/components/ConfirmTyped.tsx`
- Move: `apps/user-client/src/components/InlineMarker.tsx` → `packages/ui-shared/src/components/InlineMarker.tsx`
- Move: `apps/user-client/src/lib/motion.ts` → `packages/ui-shared/src/components/motion.ts`
- Move: `apps/user-client/tests/unit/session.store.test.ts` → `packages/ui-shared/tests/state/session.store.test.ts`
- Move: `apps/user-client/tests/unit/connectivity.store.test.ts` → `packages/ui-shared/tests/state/connectivity.store.test.ts`
- Move: `apps/user-client/tests/unit/motion.test.ts` → `packages/ui-shared/tests/components/motion.test.ts`
- Modify: `packages/ui-shared/src/index.ts` (export the moved modules)
- Modify: `apps/user-client/package.json` (add `@chatsundere/ui-shared: "workspace:^"`)
- Modify: every `apps/user-client/src/**/*.{ts,tsx}` that imported from the moved paths.

- [ ] **Step 1: Add ui-shared dep to user-client**

Edit `apps/user-client/package.json` — under `dependencies`, add `"@chatsundere/ui-shared": "workspace:^"` (keep keys sorted alphabetically).

Run: `pnpm install`

- [ ] **Step 2: Move the files**

```bash
git mv apps/user-client/src/state/session.store.ts packages/ui-shared/src/state/session.store.ts
git mv apps/user-client/src/state/connectivity.store.ts packages/ui-shared/src/state/connectivity.store.ts
git mv apps/user-client/src/components/ConfirmTyped.tsx packages/ui-shared/src/components/ConfirmTyped.tsx
git mv apps/user-client/src/components/InlineMarker.tsx packages/ui-shared/src/components/InlineMarker.tsx
git mv apps/user-client/src/lib/motion.ts packages/ui-shared/src/components/motion.ts
mkdir -p packages/ui-shared/tests/state packages/ui-shared/tests/components
git mv apps/user-client/tests/unit/session.store.test.ts packages/ui-shared/tests/state/session.store.test.ts
git mv apps/user-client/tests/unit/connectivity.store.test.ts packages/ui-shared/tests/state/connectivity.store.test.ts
git mv apps/user-client/tests/unit/motion.test.ts packages/ui-shared/tests/components/motion.test.ts
```

- [ ] **Step 3: Add vitest config in ui-shared**

Create `packages/ui-shared/vitest.config.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
```

Create `packages/ui-shared/tests/setup.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import 'fake-indexeddb/auto';
```

- [ ] **Step 4: Update import paths within the moved files**

Run: `rg -n "from '\.\./" packages/ui-shared/src/`
Adjust any relative imports that broke (e.g. references to user-client-only modules — those should be deleted and signalled in Step 7 below as a needed refactor).

If a moved file imports anything from `apps/user-client/src/lib/`, replace with the proper relative path inside ui-shared or surface it to the index. None should remain pointing at user-client.

- [ ] **Step 5: Write barrel exports**

Edit `packages/ui-shared/src/index.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
export { useSessionStore } from './state/session.store.js';
export type { Session } from './state/session.store.js';
export { useConnectivityStore } from './state/connectivity.store.js';
export type { ConnectivityState } from './state/connectivity.store.js';
export { ConfirmTyped } from './components/ConfirmTyped.js';
export { InlineMarker } from './components/InlineMarker.js';
export * as motion from './components/motion.js';
```

If the actual exports from the moved files differ, adjust accordingly — keep the public surface identical to what user-client was importing before.

- [ ] **Step 6: Sweep user-client imports**

Run: `rg -n "from '\.\./state/session\.store\.js'|from '\.\./state/connectivity\.store\.js'|from '\.\./components/ConfirmTyped\.js'|from '\.\./components/InlineMarker\.js'|from '\.\./lib/motion\.js'" apps/user-client/src`

For each match, replace with `from '@chatsundere/ui-shared'` (use the barrel). Multi-level relative paths (`../../state/...`) follow the same pattern.

Run: `rg -n "from '@chatsundere/ui-shared'" apps/user-client/src | wc -l` — should report a positive count.

- [ ] **Step 7: Build ui-shared first, then verify**

Run: `pnpm --filter @chatsundere/ui-shared build`
Expected: dist regenerated cleanly.

Run: `pnpm typecheck && pnpm test`
Expected: All green. user-client tests should still pass; ui-shared tests should now run inside ui-shared.

If a test in ui-shared/tests/ references a module path that no longer exists, fix the import path (do **not** restore the old location).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Squash C / Task 2: move state stores and shared components to ui-shared"
```

---

## Task 3 — Extract login hooks and error-copy map into ui-shared

**Files:**
- Create: `packages/ui-shared/src/login/login-error-copy.ts`
- Create: `packages/ui-shared/src/login/use-opaque-login-flow.ts`
- Create: `packages/ui-shared/src/login/use-passkey-login-flow.ts`
- Create: `packages/ui-shared/src/login/index.ts`
- Create: `packages/ui-shared/tests/login/login-error-copy.test.ts`
- Modify: `packages/ui-shared/src/index.ts`
- Modify: `apps/user-client/src/routes/login/index.tsx` (use the new hooks)

- [ ] **Step 1: Write the failing test for login-error-copy**

Create `packages/ui-shared/tests/login/login-error-copy.test.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { CryptoError } from '@chatsundere/crypto';
import { mapLoginErrorToCopyKey } from '../../src/login/login-error-copy.js';

describe('mapLoginErrorToCopyKey', () => {
  it('maps CryptoError(passphrase_incorrect) to invalidPassphrase', () => {
    expect(mapLoginErrorToCopyKey(new CryptoError('passphrase_incorrect', 'msg'))).toBe(
      'invalidPassphrase',
    );
  });

  it('maps CryptoError(integrity_check_failed) to integrityFailure', () => {
    expect(mapLoginErrorToCopyKey(new CryptoError('integrity_check_failed', 'msg'))).toBe(
      'integrityFailure',
    );
  });

  it('maps CryptoError(passkey_prf_unsupported) to prfRequired', () => {
    expect(mapLoginErrorToCopyKey(new CryptoError('passkey_prf_unsupported', 'msg'))).toBe(
      'prfRequired',
    );
  });

  it('maps unknown errors to genericError', () => {
    expect(mapLoginErrorToCopyKey(new Error('whatever'))).toBe('genericError');
  });

  it('maps DOMException NotAllowedError to passkeyCancelled', () => {
    const e = new DOMException('cancelled', 'NotAllowedError');
    expect(mapLoginErrorToCopyKey(e)).toBe('passkeyCancelled');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @chatsundere/ui-shared test`
Expected: FAIL with "Cannot find module '../../src/login/login-error-copy.js'"

- [ ] **Step 3: Implement login-error-copy**

Create `packages/ui-shared/src/login/login-error-copy.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { CryptoError } from '@chatsundere/crypto';

export type LoginCopyKey =
  | 'invalidPassphrase'
  | 'integrityFailure'
  | 'prfRequired'
  | 'passkeyCancelled'
  | 'serverUnreachable'
  | 'authFailed'
  | 'genericError';

export function mapLoginErrorToCopyKey(err: unknown): LoginCopyKey {
  if (err instanceof CryptoError) {
    switch (err.code) {
      case 'passphrase_incorrect':
        return 'invalidPassphrase';
      case 'integrity_check_failed':
        return 'integrityFailure';
      case 'passkey_prf_unsupported':
        return 'prfRequired';
      default:
        return 'genericError';
    }
  }
  if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
    return 'passkeyCancelled';
  }
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return 'authFailed';
    if (status && status >= 500) return 'serverUnreachable';
  }
  return 'genericError';
}
```

- [ ] **Step 4: Verify the test passes**

Run: `pnpm --filter @chatsundere/ui-shared test`
Expected: 5 tests pass.

- [ ] **Step 5: Implement useOpaqueLoginFlow and usePasskeyLoginFlow**

These hooks wrap the existing flow code currently inlined in `apps/user-client/src/routes/login/index.tsx`. Their job:

1. Take a `serverClient` and `baseUrl` plus the IDB.
2. Run the appropriate login flow (OPAQUE or passkey).
3. Return `{ run, status, errorCopyKey }` where `run` is a `(input) => Promise<{ session: MasterKeySession, accessToken: string, role: Role }>` and the status is a discriminated union: `'idle' | 'busy' | 'done' | 'error'`.

Create `packages/ui-shared/src/login/use-opaque-login-flow.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { useCallback, useState } from 'react';
import type { ServerClient } from '@chatsundere/crypto';
import { loginOnlineLinked } from '@chatsundere/crypto/flows/login-online-linked';
import { mapLoginErrorToCopyKey, type LoginCopyKey } from './login-error-copy.js';

export type OpaqueLoginStatus =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done' }
  | { kind: 'error'; copyKey: LoginCopyKey };

export interface OpaqueLoginParams {
  db: IDBDatabase;
  serverClient: ServerClient;
  passphrase: string;
}

export function useOpaqueLoginFlow() {
  const [status, setStatus] = useState<OpaqueLoginStatus>({ kind: 'idle' });

  const run = useCallback(async (params: OpaqueLoginParams) => {
    setStatus({ kind: 'busy' });
    try {
      const result = await loginOnlineLinked({
        db: params.db,
        serverClient: params.serverClient,
        passphrase: params.passphrase,
      });
      setStatus({ kind: 'done' });
      return result;
    } catch (err) {
      const copyKey = mapLoginErrorToCopyKey(err);
      setStatus({ kind: 'error', copyKey });
      throw err;
    }
  }, []);

  return { run, status };
}
```

Create `packages/ui-shared/src/login/use-passkey-login-flow.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { useCallback, useState } from 'react';
import { loginLocalWithBiometric } from '@chatsundere/crypto/flows/login-local';
import { mapLoginErrorToCopyKey, type LoginCopyKey } from './login-error-copy.js';

export type PasskeyLoginStatus =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done' }
  | { kind: 'error'; copyKey: LoginCopyKey };

export interface PasskeyLoginParams {
  db: IDBDatabase;
  rpId: string;
}

export function usePasskeyLoginFlow() {
  const [status, setStatus] = useState<PasskeyLoginStatus>({ kind: 'idle' });

  const run = useCallback(async (params: PasskeyLoginParams) => {
    setStatus({ kind: 'busy' });
    try {
      const result = await loginLocalWithBiometric({ db: params.db, rpId: params.rpId });
      setStatus({ kind: 'done' });
      return result;
    } catch (err) {
      const copyKey = mapLoginErrorToCopyKey(err);
      setStatus({ kind: 'error', copyKey });
      throw err;
    }
  }, []);

  return { run, status };
}
```

Note: the exact import paths for `loginOnlineLinked` and `loginLocalWithBiometric` must match what `@chatsundere/crypto` actually exports. If the deep-import path differs, adjust to the existing surface (e.g. `from '@chatsundere/crypto'`).

Create `packages/ui-shared/src/login/index.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
export { mapLoginErrorToCopyKey } from './login-error-copy.js';
export type { LoginCopyKey } from './login-error-copy.js';
export { useOpaqueLoginFlow } from './use-opaque-login-flow.js';
export type { OpaqueLoginParams, OpaqueLoginStatus } from './use-opaque-login-flow.js';
export { usePasskeyLoginFlow } from './use-passkey-login-flow.js';
export type { PasskeyLoginParams, PasskeyLoginStatus } from './use-passkey-login-flow.js';
```

- [ ] **Step 6: Re-export from the root barrel**

Edit `packages/ui-shared/src/index.ts` — add:

```ts
export * from './login/index.js';
```

- [ ] **Step 7: Refactor user-client login to consume the hooks**

In `apps/user-client/src/routes/login/index.tsx`, replace the inline login flow with the new hook. Keep the JSX (Aurora) identical; only swap the orchestration.

Concretely: where the file currently calls `loginOnlineLinked(...)` and translates errors inline, replace with:

```tsx
import { useOpaqueLoginFlow } from '@chatsundere/ui-shared';
// ... inside the component:
const { run: runOpaque, status: opaqueStatus } = useOpaqueLoginFlow();
// in submit handler:
const result = await runOpaque({ db, serverClient, passphrase });
```

Adjust the local error-display logic to read `opaqueStatus.kind === 'error'` and use `opaqueStatus.copyKey` against the user-client's `copy.ts` table.

- [ ] **Step 8: Run full test suite**

Run: `pnpm test`
Expected: all green; the existing user-client login integration tests should still pass against the refactored implementation.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Squash C / Task 3: extract login hooks and error-copy map to ui-shared"
```

---

## Task 4 — Scaffold admin-client (deps, Vite config, theme tokens, env, README)

**Files:**
- Modify: `apps/admin-client/package.json`
- Modify: `apps/admin-client/vite.config.ts`
- Create: `apps/admin-client/tailwind.config.ts`
- Create: `apps/admin-client/tsconfig.test.json`
- Modify: `apps/admin-client/index.html`
- Modify: `apps/admin-client/src/env.ts`
- Modify: `apps/admin-client/src/index.css`
- Create: `apps/admin-client/src/copy.ts`
- Create: `apps/admin-client/.env.example`
- Create: `apps/admin-client/README.md`

- [ ] **Step 1: Update package.json**

Add to `apps/admin-client/package.json` dependencies:

```json
{
  "dependencies": {
    "@chatsundere/crypto": "workspace:^",
    "@chatsundere/shared-types": "workspace:^",
    "@chatsundere/ui-shared": "workspace:^",
    "@tanstack/react-query": "^5.59.0",
    "qrcode": "^1.5.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.0",
    "valibot": "^0.42.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/qrcode": "^1.5.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "@vitest/ui": "^2.1.0",
    "fake-indexeddb": "^6.0.0",
    "jsdom": "^25.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  }
}
```

Update scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json",
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 2: Install deps**

Run: `pnpm install`

- [ ] **Step 3: Write tsconfig.test.json**

Create `apps/admin-client/tsconfig.test.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 4: Rewrite vite.config.ts**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
```

- [ ] **Step 5: Create tailwind.config.ts**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
};

export default config;
```

- [ ] **Step 6: Rewrite index.css with Catppuccin tokens**

```css
@import "tailwindcss";

@theme {
  /* Catppuccin Mocha (dark, default) */
  --color-base: #1e1e2e;
  --color-mantle: #181825;
  --color-crust: #11111b;
  --color-text: #cdd6f4;
  --color-subtext-0: #a6adc8;
  --color-overlay-0: #6c7086;
  --color-mauve: #cba6f7;
  --color-red: #f38ba8;
  --color-green: #a6e3a1;
  --color-yellow: #f9e2af;
}

@media (prefers-color-scheme: light) {
  @theme {
    /* Catppuccin Latte */
    --color-base: #eff1f5;
    --color-mantle: #e6e9ef;
    --color-crust: #dce0e8;
    --color-text: #4c4f69;
    --color-subtext-0: #6c6f85;
    --color-overlay-0: #9ca0b0;
    --color-mauve: #8839ef;
    --color-red: #d20f39;
    --color-green: #40a02b;
    --color-yellow: #df8e1d;
  }
}

:root {
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

body {
  background: var(--color-base);
  color: var(--color-text);
}
```

- [ ] **Step 7: Update env.ts**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import * as v from 'valibot';

const EnvSchema = v.object({
  VITE_AUTH_URL: v.pipe(v.string(), v.url()),
  VITE_SYNC_URL: v.pipe(v.string(), v.url()),
  VITE_PROXY_URL: v.pipe(v.string(), v.url()),
  VITE_ADMIN_API_MODE: v.optional(
    v.union([v.literal('mock'), v.literal('live'), v.literal('hybrid')]),
    'hybrid',
  ),
});

export const env = v.parse(EnvSchema, import.meta.env);
```

- [ ] **Step 8: Write .env.example**

```
VITE_AUTH_URL=http://localhost:3100
VITE_SYNC_URL=http://localhost:3200
VITE_PROXY_URL=http://localhost:3300
VITE_ADMIN_API_MODE=hybrid
```

- [ ] **Step 9: Rewrite index.html**

```html
<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#1e1e2e" />
    <title>Chatsundere · Admin</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 10: Create copy.ts skeleton**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Centralised British-English UI strings for admin-client. Pages add their
 * own keys as they are built; do not inline literal strings anywhere except
 * here.
 */
export const copy = {
  appName: 'Chatsundere Admin',
  signOut: 'Sign out',
  loading: 'Loading…',
  genericError: 'Something went wrong. Please try again.',
} as const;
```

- [ ] **Step 11: Write README.md**

```markdown
# Chatsundere — Admin Client

Catppuccin-themed operator console for a Chatsundere server.

## Prerequisites

- Node 22+
- pnpm 9+
- A running `apps/auth-service` reachable via `VITE_AUTH_URL`.
- A user-client account already created and linked to the same server (the admin's account is provisioned via user-client onboarding; admin-client reads the same IndexedDB).

## Development

```sh
pnpm install
pnpm --filter @chatsundere/admin-client dev
```

The dev server runs at `http://localhost:5174/admin/` (note the path; this matches the production deployment where admin-client is mounted at `/admin` on the same origin as user-client).

## Environment

See `.env.example`. The mode switch `VITE_ADMIN_API_MODE` accepts:

- `mock` — everything stubbed in memory; useful for UI work.
- `live` — every call goes to the auth-service. Most admin endpoints will throw `not_implemented` until the auth-service squash lands.
- `hybrid` (default) — login + `/me` are live, admin endpoints fall back to the mock.

## Manual verification

The current Manual-QA checklist lives in `superpowers/specs/2026-05-20-admin-client-design.md` §9. Follow it after a final-squash.
```

- [ ] **Step 12: Smoke test the dev server boots**

Run: `pnpm --filter @chatsundere/admin-client dev` in one terminal; in another `curl -sf http://localhost:5174/admin/ | grep "Chatsundere"` should succeed. Kill the dev server.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "Squash C / Task 4: scaffold admin-client deps, Vite, Catppuccin theme"
```

---

## Task 5 — Implement admin helpers: fetch wrapper, AdminRouteGuard, self-target predicates, formatters

**Files:**
- Create: `apps/admin-client/src/lib/joinUrl.ts`
- Create: `apps/admin-client/src/lib/fetch.ts`
- Create: `apps/admin-client/src/lib/admin-route-guard.tsx`
- Create: `apps/admin-client/src/lib/self-target.ts`
- Create: `apps/admin-client/src/lib/format.ts`
- Create: `apps/admin-client/src/lib/query-client.ts`
- Create: `apps/admin-client/tests/setup.ts`
- Create: `apps/admin-client/tests/unit/self-target.test.ts`
- Create: `apps/admin-client/tests/unit/admin-route-guard.test.tsx`

- [ ] **Step 1: Write the failing test for self-target predicates**

Create `apps/admin-client/tests/unit/self-target.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { isSelfTarget, isPrimaryAdmin } from '../../src/lib/self-target.js';

describe('isSelfTarget', () => {
  it('returns true when target id matches session user id', () => {
    expect(isSelfTarget({ userId: 'u-1' }, 'u-1')).toBe(true);
  });

  it('returns false when ids differ', () => {
    expect(isSelfTarget({ userId: 'u-1' }, 'u-2')).toBe(false);
  });

  it('returns false when session has no userId', () => {
    expect(isSelfTarget({ userId: null }, 'u-1')).toBe(false);
  });
});

describe('isPrimaryAdmin', () => {
  it('returns true for primary_admin role', () => {
    expect(isPrimaryAdmin('primary_admin')).toBe(true);
  });

  it('returns false for admin role', () => {
    expect(isPrimaryAdmin('admin')).toBe(false);
  });

  it('returns false for user role', () => {
    expect(isPrimaryAdmin('user')).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm --filter @chatsundere/admin-client test`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement self-target.ts**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

export type Role = 'primary_admin' | 'admin' | 'user';

export interface SessionLike {
  userId: string | null;
}

export function isSelfTarget(session: SessionLike, targetUserId: string): boolean {
  return session.userId !== null && session.userId === targetUserId;
}

export function isPrimaryAdmin(role: Role): boolean {
  return role === 'primary_admin';
}
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm --filter @chatsundere/admin-client test`
Expected: 6 tests pass.

- [ ] **Step 5: Implement joinUrl re-export**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
// Re-exported from user-client's fetch.ts so both apps share the helper.
// When ui-shared grows a fetch module, this re-export will move there.
export { joinUrl } from '../../../user-client/src/lib/fetch.js';
```

Note: if cross-app relative imports are forbidden by the workspace config (likely), instead copy the joinUrl implementation here and add a TODO comment to consolidate into ui-shared in a later hygiene squash. Verify by running `pnpm --filter @chatsundere/admin-client typecheck` after this step.

- [ ] **Step 6: Implement fetch.ts**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { useSessionStore } from '@chatsundere/ui-shared';
import { joinUrl } from './joinUrl.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  baseUrl: string;
  path: string;
  json?: unknown;
  authMode?: 'none' | 'bearer';
}

export async function apiFetch<T>(opts: ApiFetchOptions): Promise<T> {
  const url = joinUrl(opts.baseUrl, opts.path);
  const init = buildInit(opts);
  const res = await fetch(url, init);
  if (!res.ok) {
    const code = await safeReadCode(res);
    throw new HttpError(res.status, code, `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function buildInit(opts: ApiFetchOptions): RequestInit {
  const headers = new Headers(opts.headers);
  if (opts.json !== undefined) headers.set('Content-Type', 'application/json');
  if (opts.authMode === 'bearer') {
    const token = useSessionStore.getState().session?.accessToken;
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  return {
    method: opts.method ?? (opts.json !== undefined ? 'POST' : 'GET'),
    headers,
    credentials: 'include',
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  };
}

async function safeReadCode(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.clone().json()) as { error?: { code?: string } };
    return body.error?.code;
  } catch {
    return undefined;
  }
}
```

(No refresh logic here — admin-client requires an active session per spec §6.2; on 401 we redirect to login via the route guard, not silently refresh. Backend-driven refresh is a Phase-1 hardening.)

- [ ] **Step 7: Write failing test for AdminRouteGuard**

Create `apps/admin-client/tests/unit/admin-route-guard.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSessionStore } from '@chatsundere/ui-shared';
import { AdminRouteGuard } from '../../src/lib/admin-route-guard.js';

function Probe() {
  return <div>protected-content</div>;
}

function Login() {
  return <div>login-screen</div>;
}

function renderAt(initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <AdminRouteGuard>
              <Probe />
            </AdminRouteGuard>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminRouteGuard', () => {
  beforeEach(() => {
    useSessionStore.setState({ session: null });
  });

  it('redirects to /login when no session', () => {
    renderAt(['/dashboard']);
    expect(screen.getByText('login-screen')).toBeInTheDocument();
  });

  it('redirects to /login when role is user', () => {
    useSessionStore.setState({
      session: { userId: 'u-1', accessToken: 'tok', role: 'user', mk: null },
    } as never);
    renderAt(['/dashboard']);
    expect(screen.getByText('login-screen')).toBeInTheDocument();
  });

  it('renders children when role is admin', () => {
    useSessionStore.setState({
      session: { userId: 'u-1', accessToken: 'tok', role: 'admin', mk: null },
    } as never);
    renderAt(['/dashboard']);
    expect(screen.getByText('protected-content')).toBeInTheDocument();
  });

  it('renders children when role is primary_admin', () => {
    useSessionStore.setState({
      session: { userId: 'u-1', accessToken: 'tok', role: 'primary_admin', mk: null },
    } as never);
    renderAt(['/dashboard']);
    expect(screen.getByText('protected-content')).toBeInTheDocument();
  });
});
```

Create `apps/admin-client/tests/setup.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
```

- [ ] **Step 8: Run, verify guard test fails**

Run: `pnpm --filter @chatsundere/admin-client test`
Expected: FAIL on the missing guard.

- [ ] **Step 9: Implement AdminRouteGuard**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSessionStore } from '@chatsundere/ui-shared';

interface Props {
  children: ReactNode;
}

export function AdminRouteGuard({ children }: Props) {
  const session = useSessionStore((s) => s.session);
  if (!session || !session.accessToken) {
    return <Navigate to="/login" replace />;
  }
  if (session.role !== 'admin' && session.role !== 'primary_admin') {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
```

- [ ] **Step 10: Verify test suite passes**

Run: `pnpm --filter @chatsundere/admin-client test`
Expected: 10 tests pass (6 self-target + 4 guard).

- [ ] **Step 11: Implement format.ts**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/** Format an ISO timestamp as a short relative phrase ('3 minutes ago', '2 days ago'). */
export function formatRelative(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'Never';
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} hour${diffHour === 1 ? '' : 's'} ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
  return then.toLocaleDateString('en-GB');
}
```

- [ ] **Step 12: Implement query-client.ts**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});
```

- [ ] **Step 13: Typecheck and commit**

Run: `pnpm --filter @chatsundere/admin-client typecheck && pnpm --filter @chatsundere/admin-client test`
Expected: all green.

```bash
git add -A
git commit -m "Squash C / Task 5: admin helpers (fetch, route guard, self-target, formatters)"
```

---

## Task 6 — Implement data layer: AdminApi interface, mock, live, hybrid, fixtures

**Files:**
- Create: `apps/admin-client/src/data/admin-api.ts`
- Create: `apps/admin-client/src/data/mock-fixtures.ts`
- Create: `apps/admin-client/src/data/admin-api.mock.ts`
- Create: `apps/admin-client/src/data/admin-api.live.ts`
- Create: `apps/admin-client/src/data/admin-api.hybrid.ts`
- Create: `apps/admin-client/src/data/index.ts`
- Create: `apps/admin-client/tests/unit/admin-api.mock.test.ts`

- [ ] **Step 1: Write the AdminApi interface and types**

Create `apps/admin-client/src/data/admin-api.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

// TODO: move these wire-shape types to packages/shared-types once Lyra's
// invitation-and-pairing brief settles the canonical schemas.

import type { Role } from '../lib/self-target.js';

export type UserStatus = 'active' | 'suspended';

export interface AuthMethodSummary {
  id: string;
  label: string;
  type: 'passphrase' | 'passkey';
  last_used_at: string | null;
}

export interface UserSummary {
  id: string;
  username: string;
  role: Role;
  status: UserStatus;
  created_at: string;
  last_login_at: string | null;
}

export interface UserDetail extends UserSummary {
  auth_methods: AuthMethodSummary[];
}

export type InvitationStatus = 'pending' | 'redeemed' | 'expired' | 'revoked';

export interface InvitationSummary {
  id: string;
  role: Exclude<Role, 'primary_admin'> | 'primary_admin';
  status: InvitationStatus;
  redeemed_by: string | null;
  created_at: string;
  expires_at: string;
  issuer_label: string | null;
}

export interface InvitationCreated extends InvitationSummary {
  qr_payload: string;
  url: string;
}

export interface CreateInvitationInput {
  role: 'user' | 'admin' | 'primary_admin';
  expires_in_days: 1 | 7 | 30;
  issuer_label?: string;
}

export type AuditEventCategory =
  | 'auth'
  | 'user-lifecycle'
  | 'invitation-lifecycle'
  | 'recovery'
  | 'admin-action';

export interface AuditEvent {
  id: string;
  timestamp: string;
  event_type: string;
  category: AuditEventCategory;
  actor_id: string | null;
  actor_username: string | null;
  subject_id: string | null;
  subject_username: string | null;
  metadata: Record<string, unknown>;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
}

export interface UserListQuery {
  search?: string;
  role?: Role | 'all';
  status?: UserStatus | 'all';
  page?: number;
  per_page?: number;
}

export interface InvitationListQuery {
  status?: InvitationStatus | 'all';
  page?: number;
  per_page?: number;
}

export interface AuditListQuery {
  category?: AuditEventCategory | 'all';
  user_id?: string;
  from?: string;
  to?: string;
  page?: number;
  per_page?: number;
}

export interface DashboardSummary {
  total_users: number;
  pending_invitations: number;
  suspended_users: number;
  recent_activity: AuditEvent[];
}

export interface AdminApi {
  // Users
  listUsers(query: UserListQuery): Promise<Paged<UserSummary>>;
  getUser(id: string): Promise<UserDetail>;
  suspendUser(id: string): Promise<void>;
  unsuspendUser(id: string): Promise<void>;
  deleteUser(id: string): Promise<void>;
  changeRole(id: string, role: 'user' | 'admin'): Promise<void>;
  transferPrimary(toUserId: string): Promise<void>;

  // Invitations
  listInvitations(query: InvitationListQuery): Promise<Paged<InvitationSummary>>;
  createInvitation(input: CreateInvitationInput): Promise<InvitationCreated>;
  revokeInvitation(id: string): Promise<void>;

  // Audit
  listAudit(query: AuditListQuery): Promise<Paged<AuditEvent>>;

  // Dashboard
  getDashboardSummary(): Promise<DashboardSummary>;
}
```

- [ ] **Step 2: Write the failing test for the mock impl**

Create `apps/admin-client/tests/unit/admin-api.mock.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import { MockAdminApi } from '../../src/data/admin-api.mock.js';

describe('MockAdminApi', () => {
  let api: MockAdminApi;

  beforeEach(() => {
    api = new MockAdminApi();
  });

  it('lists users with default pagination', async () => {
    const page = await api.listUsers({});
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.length).toBeLessThanOrEqual(20);
    expect(page.total).toBeGreaterThanOrEqual(page.items.length);
  });

  it('filters users by status', async () => {
    const page = await api.listUsers({ status: 'suspended' });
    expect(page.items.every((u) => u.status === 'suspended')).toBe(true);
  });

  it('filters users by username substring', async () => {
    const all = await api.listUsers({ per_page: 100 });
    const target = all.items[0]?.username.slice(0, 3);
    if (!target) throw new Error('fixtures must have at least one user');
    const page = await api.listUsers({ search: target });
    expect(page.items.every((u) => u.username.includes(target))).toBe(true);
  });

  it('suspend toggles status and appends an audit event', async () => {
    const all = await api.listUsers({ per_page: 100 });
    const active = all.items.find((u) => u.status === 'active' && u.role === 'user');
    if (!active) throw new Error('fixtures must have at least one active user');
    await api.suspendUser(active.id);
    const after = await api.getUser(active.id);
    expect(after.status).toBe('suspended');
    const audit = await api.listAudit({ user_id: active.id, per_page: 5 });
    expect(audit.items.some((e) => e.event_type === 'user.suspended')).toBe(true);
  });

  it('createInvitation returns a populated qr_payload and url', async () => {
    const result = await api.createInvitation({ role: 'user', expires_in_days: 7 });
    expect(result.qr_payload.length).toBeGreaterThan(20);
    expect(result.url.startsWith('http')).toBe(true);
    expect(result.status).toBe('pending');
  });

  it('getDashboardSummary returns three counters and a non-empty activity list', async () => {
    const s = await api.getDashboardSummary();
    expect(typeof s.total_users).toBe('number');
    expect(typeof s.pending_invitations).toBe('number');
    expect(typeof s.suspended_users).toBe('number');
    expect(s.recent_activity.length).toBeGreaterThan(0);
    expect(s.recent_activity.length).toBeLessThanOrEqual(10);
  });
});
```

- [ ] **Step 3: Run, verify fail**

Run: `pnpm --filter @chatsundere/admin-client test`
Expected: FAIL with module-not-found.

- [ ] **Step 4: Write mock-fixtures.ts**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type {
  AuditEvent,
  InvitationSummary,
  UserDetail,
} from './admin-api.js';

const now = () => new Date().toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

export function initialUsers(): UserDetail[] {
  return [
    {
      id: '01900000-0000-7000-8000-000000000001',
      username: 'alice',
      role: 'primary_admin',
      status: 'active',
      created_at: daysAgo(45),
      last_login_at: daysAgo(0),
      auth_methods: [
        { id: 'am-1a', label: 'Passphrase', type: 'passphrase', last_used_at: daysAgo(0) },
        { id: 'am-1b', label: "Alice's Pixel", type: 'passkey', last_used_at: daysAgo(1) },
      ],
    },
    {
      id: '01900000-0000-7000-8000-000000000002',
      username: 'bob',
      role: 'admin',
      status: 'active',
      created_at: daysAgo(30),
      last_login_at: daysAgo(2),
      auth_methods: [
        { id: 'am-2a', label: 'Passphrase', type: 'passphrase', last_used_at: daysAgo(2) },
      ],
    },
    {
      id: '01900000-0000-7000-8000-000000000003',
      username: 'carol',
      role: 'user',
      status: 'active',
      created_at: daysAgo(20),
      last_login_at: daysAgo(0),
      auth_methods: [
        { id: 'am-3a', label: 'Passphrase', type: 'passphrase', last_used_at: daysAgo(0) },
        { id: 'am-3b', label: "Carol's iPhone", type: 'passkey', last_used_at: daysAgo(0) },
      ],
    },
    {
      id: '01900000-0000-7000-8000-000000000004',
      username: 'dave',
      role: 'user',
      status: 'suspended',
      created_at: daysAgo(15),
      last_login_at: daysAgo(5),
      auth_methods: [
        { id: 'am-4a', label: 'Passphrase', type: 'passphrase', last_used_at: daysAgo(5) },
      ],
    },
    // Add eight further users (eve, frank, grace, henry, ivy, jack, kate, leo, mia, nina)
    // with mixed roles (all 'user' or one 'admin'), mixed status, mixed last_login_at
    // including one user with null last_login_at to exercise empty-state copy.
    {
      id: '01900000-0000-7000-8000-000000000005',
      username: 'eve',
      role: 'user',
      status: 'active',
      created_at: daysAgo(12),
      last_login_at: null,
      auth_methods: [
        { id: 'am-5a', label: 'Passphrase', type: 'passphrase', last_used_at: null },
      ],
    },
    // Repeat the shape for at least 11 further users to reach 16+ rows. Vary
    // statuses (~30% suspended), roles (1 primary_admin, 1-2 admins, rest user),
    // last_login_at (a few null for empty-state coverage), and auth_methods (~50%
    // passkey-equipped).
  ];
}

export function initialInvitations(): InvitationSummary[] {
  return [
    {
      id: 'inv-01900000-0000-7000-8000-000000000001',
      role: 'user',
      status: 'pending',
      redeemed_by: null,
      created_at: daysAgo(1),
      expires_at: daysAgo(-6),
      issuer_label: 'Local dev instance',
    },
    {
      id: 'inv-01900000-0000-7000-8000-000000000002',
      role: 'admin',
      status: 'redeemed',
      redeemed_by: 'bob',
      created_at: daysAgo(31),
      expires_at: daysAgo(24),
      issuer_label: 'Local dev instance',
    },
    {
      id: 'inv-01900000-0000-7000-8000-000000000003',
      role: 'user',
      status: 'expired',
      redeemed_by: null,
      created_at: daysAgo(40),
      expires_at: daysAgo(33),
      issuer_label: 'Local dev instance',
    },
    {
      id: 'inv-01900000-0000-7000-8000-000000000004',
      role: 'user',
      status: 'revoked',
      redeemed_by: null,
      created_at: daysAgo(10),
      expires_at: daysAgo(3),
      issuer_label: 'Local dev instance',
    },
    // Add four more invitations (mix of pending/redeemed) to reach 8+.
  ];
}

export function initialAudit(): AuditEvent[] {
  return [
    {
      id: 'aud-01900000-0000-7000-8000-000000000001',
      timestamp: daysAgo(0),
      event_type: 'user.linked',
      category: 'user-lifecycle',
      actor_id: '01900000-0000-7000-8000-000000000001',
      actor_username: 'alice',
      subject_id: '01900000-0000-7000-8000-000000000003',
      subject_username: 'carol',
      metadata: { invitation_id: 'inv-01900000-0000-7000-8000-000000000002' },
    },
    {
      id: 'aud-01900000-0000-7000-8000-000000000002',
      timestamp: daysAgo(2),
      event_type: 'invitation.created',
      category: 'invitation-lifecycle',
      actor_id: '01900000-0000-7000-8000-000000000001',
      actor_username: 'alice',
      subject_id: null,
      subject_username: null,
      metadata: { role: 'user', expires_in_days: 7 },
    },
    // Repeat for ~50 entries spanning 30 days across these event types:
    // user.linked, user.suspended, user.unsuspended, user.role_changed,
    // user.deleted, invitation.created, invitation.redeemed, invitation.revoked,
    // auth.refresh_reuse_detected, recovery.requested.
  ];
}
```

Note: the partial fixtures above are illustrative. The implementer must extend each list to the counts named in spec §4.3 (16-20 users, 8-10 invitations, ~50 audit events). Use UUIDv7 for all IDs; the prefix `01900000-...` is acceptable as long as IDs are unique.

- [ ] **Step 5: Implement admin-api.mock.ts**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type {
  AdminApi,
  AuditEvent,
  AuditListQuery,
  CreateInvitationInput,
  DashboardSummary,
  InvitationCreated,
  InvitationListQuery,
  InvitationSummary,
  Paged,
  UserDetail,
  UserListQuery,
  UserSummary,
} from './admin-api.js';
import { initialAudit, initialInvitations, initialUsers } from './mock-fixtures.js';

function uuidv7Stub(): string {
  // Stub: not a real UUIDv7, but stable shape. Replace with proper helper once
  // packages/shared-types ships a uuidv7 utility (see follow-ups-index.md).
  const t = Date.now().toString(16).padStart(12, '0');
  const r = Math.random().toString(16).slice(2, 10);
  return `${t.slice(0, 8)}-${t.slice(8, 12)}-7${r.slice(0, 3)}-8${r.slice(3, 6)}-${r.padEnd(12, '0').slice(0, 12)}`;
}

export class MockAdminApi implements AdminApi {
  private users: UserDetail[] = initialUsers();
  private invitations: InvitationSummary[] = initialInvitations();
  private audit: AuditEvent[] = initialAudit();

  private toSummary(u: UserDetail): UserSummary {
    return {
      id: u.id,
      username: u.username,
      role: u.role,
      status: u.status,
      created_at: u.created_at,
      last_login_at: u.last_login_at,
    };
  }

  async listUsers(query: UserListQuery): Promise<Paged<UserSummary>> {
    let filtered = this.users.slice();
    if (query.search) {
      const s = query.search.toLowerCase();
      filtered = filtered.filter((u) => u.username.toLowerCase().includes(s));
    }
    if (query.role && query.role !== 'all') {
      filtered = filtered.filter((u) => u.role === query.role);
    }
    if (query.status && query.status !== 'all') {
      filtered = filtered.filter((u) => u.status === query.status);
    }
    const page = query.page ?? 1;
    const per_page = query.per_page ?? 20;
    const start = (page - 1) * per_page;
    const items = filtered.slice(start, start + per_page).map((u) => this.toSummary(u));
    return { items, total: filtered.length, page, per_page };
  }

  async getUser(id: string): Promise<UserDetail> {
    const u = this.users.find((x) => x.id === id);
    if (!u) throw new Error('user not found');
    return structuredClone(u);
  }

  private append(event_type: string, subject_id: string | null, metadata: Record<string, unknown>) {
    this.audit.unshift({
      id: uuidv7Stub(),
      timestamp: new Date().toISOString(),
      event_type,
      category: event_type.startsWith('user.') ? 'user-lifecycle'
        : event_type.startsWith('invitation.') ? 'invitation-lifecycle'
        : event_type.startsWith('auth.') ? 'auth'
        : 'admin-action',
      actor_id: 'mock-actor',
      actor_username: 'mock-actor',
      subject_id,
      subject_username: subject_id ? this.users.find((u) => u.id === subject_id)?.username ?? null : null,
      metadata,
    });
  }

  async suspendUser(id: string): Promise<void> {
    const u = this.users.find((x) => x.id === id);
    if (!u) throw new Error('user not found');
    u.status = 'suspended';
    this.append('user.suspended', id, {});
  }

  async unsuspendUser(id: string): Promise<void> {
    const u = this.users.find((x) => x.id === id);
    if (!u) throw new Error('user not found');
    u.status = 'active';
    this.append('user.unsuspended', id, {});
  }

  async deleteUser(id: string): Promise<void> {
    const before = this.users.length;
    this.users = this.users.filter((u) => u.id !== id);
    if (this.users.length === before) throw new Error('user not found');
    this.append('user.deleted', id, {});
  }

  async changeRole(id: string, role: 'user' | 'admin'): Promise<void> {
    const u = this.users.find((x) => x.id === id);
    if (!u) throw new Error('user not found');
    const prev = u.role;
    u.role = role;
    this.append('user.role_changed', id, { from: prev, to: role });
  }

  async transferPrimary(toUserId: string): Promise<void> {
    const current = this.users.find((u) => u.role === 'primary_admin');
    const next = this.users.find((u) => u.id === toUserId);
    if (!current || !next) throw new Error('cannot transfer');
    current.role = 'admin';
    next.role = 'primary_admin';
    this.append('user.role_changed', toUserId, { transferred_from: current.id });
  }

  async listInvitations(query: InvitationListQuery): Promise<Paged<InvitationSummary>> {
    let filtered = this.invitations.slice();
    if (query.status && query.status !== 'all') {
      filtered = filtered.filter((i) => i.status === query.status);
    }
    const page = query.page ?? 1;
    const per_page = query.per_page ?? 20;
    const start = (page - 1) * per_page;
    return { items: filtered.slice(start, start + per_page), total: filtered.length, page, per_page };
  }

  async createInvitation(input: CreateInvitationInput): Promise<InvitationCreated> {
    const id = `inv-${uuidv7Stub()}`;
    const token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const expires_at = new Date(Date.now() + input.expires_in_days * 86_400_000).toISOString();
    const created_at = new Date().toISOString();
    const issuer_label = input.issuer_label ?? 'Local dev instance';
    const qr_payload = JSON.stringify({
      v: 1,
      kind: 'invitation',
      token,
      base_url: 'http://localhost:3100',
      role: input.role,
      issuer_label,
    });
    const url = `http://localhost:5173/link?payload=${btoa(qr_payload).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}`;
    const inv: InvitationCreated = {
      id,
      role: input.role,
      status: 'pending',
      redeemed_by: null,
      created_at,
      expires_at,
      issuer_label,
      qr_payload,
      url,
    };
    const { qr_payload: _qr, url: _url, ...summary } = inv;
    this.invitations.unshift(summary);
    this.append('invitation.created', null, { role: input.role, expires_in_days: input.expires_in_days });
    return inv;
  }

  async revokeInvitation(id: string): Promise<void> {
    const inv = this.invitations.find((i) => i.id === id);
    if (!inv) throw new Error('invitation not found');
    inv.status = 'revoked';
    this.append('invitation.revoked', null, { invitation_id: id });
  }

  async listAudit(query: AuditListQuery): Promise<Paged<AuditEvent>> {
    let filtered = this.audit.slice();
    if (query.category && query.category !== 'all') {
      filtered = filtered.filter((e) => e.category === query.category);
    }
    if (query.user_id) {
      filtered = filtered.filter((e) => e.actor_id === query.user_id || e.subject_id === query.user_id);
    }
    if (query.from) {
      filtered = filtered.filter((e) => e.timestamp >= query.from!);
    }
    if (query.to) {
      filtered = filtered.filter((e) => e.timestamp <= query.to!);
    }
    const page = query.page ?? 1;
    const per_page = query.per_page ?? 50;
    const start = (page - 1) * per_page;
    return { items: filtered.slice(start, start + per_page), total: filtered.length, page, per_page };
  }

  async getDashboardSummary(): Promise<DashboardSummary> {
    return {
      total_users: this.users.length,
      pending_invitations: this.invitations.filter((i) => i.status === 'pending').length,
      suspended_users: this.users.filter((u) => u.status === 'suspended').length,
      recent_activity: this.audit.slice(0, 10),
    };
  }
}
```

- [ ] **Step 6: Verify mock tests pass**

Run: `pnpm --filter @chatsundere/admin-client test`
Expected: 16 tests pass (10 from previous tasks + 6 mock).

- [ ] **Step 7: Implement admin-api.live.ts**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { HttpError, apiFetch } from '../lib/fetch.js';
import type {
  AdminApi,
  AuditEvent,
  AuditListQuery,
  CreateInvitationInput,
  DashboardSummary,
  InvitationCreated,
  InvitationListQuery,
  InvitationSummary,
  Paged,
  UserDetail,
  UserListQuery,
  UserSummary,
} from './admin-api.js';

function notImplemented(): never {
  throw new HttpError(501, 'not_implemented', 'admin endpoint not yet implemented');
}

export class LiveAdminApi implements AdminApi {
  constructor(private baseUrl: string) {}

  // Implemented today via auth-service:
  async getDashboardSummary(): Promise<DashboardSummary> {
    return notImplemented();
  }

  async listUsers(_q: UserListQuery): Promise<Paged<UserSummary>> { return notImplemented(); }
  async getUser(_id: string): Promise<UserDetail> { return notImplemented(); }
  async suspendUser(_id: string): Promise<void> { return notImplemented(); }
  async unsuspendUser(_id: string): Promise<void> { return notImplemented(); }
  async deleteUser(_id: string): Promise<void> { return notImplemented(); }
  async changeRole(_id: string, _role: 'user' | 'admin'): Promise<void> { return notImplemented(); }
  async transferPrimary(_id: string): Promise<void> { return notImplemented(); }
  async listInvitations(_q: InvitationListQuery): Promise<Paged<InvitationSummary>> { return notImplemented(); }
  async createInvitation(_i: CreateInvitationInput): Promise<InvitationCreated> { return notImplemented(); }
  async revokeInvitation(_id: string): Promise<void> { return notImplemented(); }
  async listAudit(_q: AuditListQuery): Promise<Paged<AuditEvent>> { return notImplemented(); }
}
```

The `_baseUrl` parameter and `apiFetch` are kept on hand for the next squash that wires real endpoints (suspendUser will eventually be `apiFetch({ baseUrl: this.baseUrl, path: '/auth/v1/admin/users/' + id + '/suspend', method: 'POST', authMode: 'bearer' })`).

- [ ] **Step 8: Implement admin-api.hybrid.ts**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { AdminApi } from './admin-api.js';
import { LiveAdminApi } from './admin-api.live.js';
import { MockAdminApi } from './admin-api.mock.js';
import { HttpError } from '../lib/fetch.js';

/**
 * Hybrid composer: tries the live impl first; on HttpError 501 (not_implemented),
 * falls through to the mock impl. Until live endpoints land, every admin call
 * lands in the mock; once they land, individual methods on LiveAdminApi return
 * real data and the mock is bypassed.
 */
export class HybridAdminApi implements AdminApi {
  constructor(private live: LiveAdminApi, private mock: MockAdminApi) {}

  private async tryLive<T>(liveFn: () => Promise<T>, mockFn: () => Promise<T>): Promise<T> {
    try {
      return await liveFn();
    } catch (e) {
      if (e instanceof HttpError && e.status === 501 && e.code === 'not_implemented') {
        return mockFn();
      }
      throw e;
    }
  }

  listUsers = (q: Parameters<AdminApi['listUsers']>[0]) => this.tryLive(() => this.live.listUsers(q), () => this.mock.listUsers(q));
  getUser = (id: string) => this.tryLive(() => this.live.getUser(id), () => this.mock.getUser(id));
  suspendUser = (id: string) => this.tryLive(() => this.live.suspendUser(id), () => this.mock.suspendUser(id));
  unsuspendUser = (id: string) => this.tryLive(() => this.live.unsuspendUser(id), () => this.mock.unsuspendUser(id));
  deleteUser = (id: string) => this.tryLive(() => this.live.deleteUser(id), () => this.mock.deleteUser(id));
  changeRole = (id: string, role: 'user' | 'admin') => this.tryLive(() => this.live.changeRole(id, role), () => this.mock.changeRole(id, role));
  transferPrimary = (id: string) => this.tryLive(() => this.live.transferPrimary(id), () => this.mock.transferPrimary(id));

  listInvitations = (q: Parameters<AdminApi['listInvitations']>[0]) => this.tryLive(() => this.live.listInvitations(q), () => this.mock.listInvitations(q));
  createInvitation = (input: Parameters<AdminApi['createInvitation']>[0]) => this.tryLive(() => this.live.createInvitation(input), () => this.mock.createInvitation(input));
  revokeInvitation = (id: string) => this.tryLive(() => this.live.revokeInvitation(id), () => this.mock.revokeInvitation(id));

  listAudit = (q: Parameters<AdminApi['listAudit']>[0]) => this.tryLive(() => this.live.listAudit(q), () => this.mock.listAudit(q));

  getDashboardSummary = () => this.tryLive(() => this.live.getDashboardSummary(), () => this.mock.getDashboardSummary());
}
```

- [ ] **Step 9: Implement index.ts with env-switch**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { AdminApi } from './admin-api.js';
import { LiveAdminApi } from './admin-api.live.js';
import { MockAdminApi } from './admin-api.mock.js';
import { HybridAdminApi } from './admin-api.hybrid.js';
import { env } from '../env.js';

let singleton: AdminApi | null = null;

export function getAdminApi(): AdminApi {
  if (singleton) return singleton;
  const mode = env.VITE_ADMIN_API_MODE;
  if (mode === 'mock') {
    singleton = new MockAdminApi();
  } else if (mode === 'live') {
    singleton = new LiveAdminApi(env.VITE_AUTH_URL);
  } else {
    singleton = new HybridAdminApi(new LiveAdminApi(env.VITE_AUTH_URL), new MockAdminApi());
  }
  return singleton;
}

export type { AdminApi };
export * from './admin-api.js';
```

- [ ] **Step 10: Typecheck + test**

Run: `pnpm --filter @chatsundere/admin-client typecheck && pnpm --filter @chatsundere/admin-client test`
Expected: all green.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "Squash C / Task 6: AdminApi interface + mock/live/hybrid implementations"
```

---

## Task 7 — Login screen with five-branch decision tree + integration test

**Files:**
- Create: `apps/admin-client/src/routes/login/decision-tree.ts`
- Create: `apps/admin-client/src/routes/login/failure-states.tsx`
- Create: `apps/admin-client/src/routes/login/index.tsx`
- Create: `apps/admin-client/tests/integration/login-decision-tree.test.tsx`
- Modify: `apps/admin-client/src/copy.ts` (add login keys)

- [ ] **Step 1: Add copy keys**

In `apps/admin-client/src/copy.ts`, replace the `copy` object with:

```ts
export const copy = {
  appName: 'Chatsundere Admin',
  signOut: 'Sign out',
  loading: 'Loading…',
  genericError: 'Something went wrong. Please try again.',
  login: {
    title: 'Sign in to Chatsundere Admin',
    passphraseLabel: 'Passphrase',
    submit: 'Sign in',
    failures: {
      noAccount: {
        title: 'No account on this device',
        body: 'Set up a Chatsundere account in user-client first, then come back here.',
        cta: 'Open user-client',
      },
      noLink: {
        title: 'Account is not linked to a server',
        body: 'Admin features require a server connection. Link your account in user-client first.',
        cta: 'Open user-client',
      },
      offline: {
        title: 'Server connection required',
        body: 'Admin-client requires an active server connection. Check your network and try again.',
        cta: 'Retry',
      },
      notAdmin: {
        title: 'Admin permissions required',
        body: 'Your account does not have admin permissions on this server. If you believe this is wrong, contact your operator.',
        cta: 'Open user-client',
      },
    },
    errors: {
      invalidPassphrase: 'Incorrect passphrase.',
      integrityFailure: "Couldn't verify your local data. Try clearing site data and re-linking.",
      authFailed: 'Authentication failed.',
      serverUnreachable: 'Could not reach the server.',
      genericError: 'Something went wrong. Please try again.',
      prfRequired: 'Your passkey does not support PRF — needed for biometric login.',
      passkeyCancelled: '',
    },
  },
} as const;
```

- [ ] **Step 2: Write the failing integration test**

Create `apps/admin-client/tests/integration/login-decision-tree.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginScreen } from '../../src/routes/login/index.js';

// Each branch is driven by a small stub of the decision-tree runner.
vi.mock('../../src/routes/login/decision-tree.js', () => ({
  runDecisionTreePreLogin: vi.fn(),
  classifyPostLogin: vi.fn(),
}));

import { runDecisionTreePreLogin } from '../../src/routes/login/decision-tree.js';

describe('LoginScreen decision tree', () => {
  beforeEach(() => {
    vi.mocked(runDecisionTreePreLogin).mockReset();
  });

  it('shows the noAccount failure state when local_account is missing', async () => {
    vi.mocked(runDecisionTreePreLogin).mockResolvedValue({ branch: 'no_account' });
    render(<MemoryRouter><LoginScreen /></MemoryRouter>);
    expect(await screen.findByText(/No account on this device/i)).toBeInTheDocument();
  });

  it('shows the noLink failure state when linked_account is missing', async () => {
    vi.mocked(runDecisionTreePreLogin).mockResolvedValue({ branch: 'no_link' });
    render(<MemoryRouter><LoginScreen /></MemoryRouter>);
    expect(await screen.findByText(/Account is not linked to a server/i)).toBeInTheDocument();
  });

  it('shows the offline failure state when offline', async () => {
    vi.mocked(runDecisionTreePreLogin).mockResolvedValue({ branch: 'offline' });
    render(<MemoryRouter><LoginScreen /></MemoryRouter>);
    expect(await screen.findByText(/Server connection required/i)).toBeInTheDocument();
  });

  it('shows the login form when pre-login passes', async () => {
    vi.mocked(runDecisionTreePreLogin).mockResolvedValue({ branch: 'ready' });
    render(<MemoryRouter><LoginScreen /></MemoryRouter>);
    expect(await screen.findByLabelText(/Passphrase/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run, verify fail**

Run: `pnpm --filter @chatsundere/admin-client test`
Expected: FAIL with module-not-found on `LoginScreen`.

- [ ] **Step 4: Implement decision-tree.ts**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { openLocalDb, getLocalAccount, getLinkedAccount } from '@chatsundere/crypto';
import { useConnectivityStore } from '@chatsundere/ui-shared';

export type PreLoginBranch =
  | 'no_account'
  | 'no_link'
  | 'offline'
  | 'ready';

export interface PreLoginResult {
  branch: PreLoginBranch;
}

/**
 * Pre-login decision tree per spec §6.2 steps 1-3. The login itself (step 4)
 * and the role check (step 5) happen after the user submits.
 */
export async function runDecisionTreePreLogin(): Promise<PreLoginResult> {
  const db = await openLocalDb('chatsundere');
  const local = await getLocalAccount(db);
  if (!local) {
    db.close();
    return { branch: 'no_account' };
  }
  const linked = await getLinkedAccount(db);
  if (!linked) {
    db.close();
    return { branch: 'no_link' };
  }
  const connectivity = useConnectivityStore.getState().state;
  if (connectivity.kind !== 'linked_online') {
    db.close();
    return { branch: 'offline' };
  }
  db.close();
  return { branch: 'ready' };
}

export type PostLoginBranch = 'role_not_admin' | 'admin_ok';

export interface PostLoginResult {
  branch: PostLoginBranch;
}

export function classifyPostLogin(role: string): PostLoginResult {
  if (role === 'admin' || role === 'primary_admin') return { branch: 'admin_ok' };
  return { branch: 'role_not_admin' };
}
```

The exact symbol names from `@chatsundere/crypto` (`openLocalDb`, `getLocalAccount`, `getLinkedAccount`) must match the existing public surface — if any have different names, adjust.

- [ ] **Step 5: Implement failure-states.tsx**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { copy } from '../../copy.js';

interface FailureProps {
  title: string;
  body: string;
  cta: string;
  onCta: () => void;
}

function Failure({ title, body, cta, onCta }: FailureProps) {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-medium">{title}</h1>
        <p className="text-[var(--color-subtext-0)]">{body}</p>
        <button
          type="button"
          onClick={onCta}
          className="rounded-md bg-[var(--color-mauve)] px-4 py-2 text-[var(--color-base)]"
        >
          {cta}
        </button>
      </div>
    </main>
  );
}

export function NoAccountFailure() {
  return (
    <Failure
      title={copy.login.failures.noAccount.title}
      body={copy.login.failures.noAccount.body}
      cta={copy.login.failures.noAccount.cta}
      onCta={() => {
        window.location.href = '/';
      }}
    />
  );
}

export function NoLinkFailure() {
  return (
    <Failure
      title={copy.login.failures.noLink.title}
      body={copy.login.failures.noLink.body}
      cta={copy.login.failures.noLink.cta}
      onCta={() => {
        window.location.href = '/';
      }}
    />
  );
}

export function OfflineFailure({ onRetry }: { onRetry: () => void }) {
  return (
    <Failure
      title={copy.login.failures.offline.title}
      body={copy.login.failures.offline.body}
      cta={copy.login.failures.offline.cta}
      onCta={onRetry}
    />
  );
}

export function NotAdminFailure() {
  return (
    <Failure
      title={copy.login.failures.notAdmin.title}
      body={copy.login.failures.notAdmin.body}
      cta={copy.login.failures.notAdmin.cta}
      onCta={() => {
        window.location.href = '/';
      }}
    />
  );
}
```

- [ ] **Step 6: Implement LoginScreen**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOpaqueLoginFlow, useSessionStore } from '@chatsundere/ui-shared';
import { copy } from '../../copy.js';
import { classifyPostLogin, runDecisionTreePreLogin, type PreLoginBranch } from './decision-tree.js';
import {
  NoAccountFailure,
  NoLinkFailure,
  NotAdminFailure,
  OfflineFailure,
} from './failure-states.js';
import { openLocalDb } from '@chatsundere/crypto';
import { httpServerClient } from '../../lib/server-client.js';

type State =
  | { kind: 'checking' }
  | { kind: 'failure'; branch: PreLoginBranch }
  | { kind: 'ready' }
  | { kind: 'role_not_admin' };

export function LoginScreen() {
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: 'checking' });
  const { run, status } = useOpaqueLoginFlow();
  const [passphrase, setPassphrase] = useState('');

  const runCheck = async () => {
    setState({ kind: 'checking' });
    const result = await runDecisionTreePreLogin();
    if (result.branch === 'ready') setState({ kind: 'ready' });
    else setState({ kind: 'failure', branch: result.branch });
  };

  useEffect(() => {
    void runCheck();
  }, []);

  if (state.kind === 'checking') {
    return (
      <main className="grid min-h-dvh place-items-center">
        <p className="text-[var(--color-subtext-0)]">{copy.loading}</p>
      </main>
    );
  }
  if (state.kind === 'failure') {
    if (state.branch === 'no_account') return <NoAccountFailure />;
    if (state.branch === 'no_link') return <NoLinkFailure />;
    if (state.branch === 'offline') return <OfflineFailure onRetry={() => void runCheck()} />;
  }
  if (state.kind === 'role_not_admin') return <NotAdminFailure />;

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <form
        className="w-full max-w-sm space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const db = await openLocalDb('chatsundere');
          try {
            const result = await run({ db, serverClient: httpServerClient, passphrase });
            useSessionStore.setState({
              session: {
                userId: result.session.userId,
                accessToken: result.accessToken,
                role: result.role,
                mk: result.session.mk,
              } as never,
            });
            const post = classifyPostLogin(result.role);
            if (post.branch === 'admin_ok') navigate('/dashboard', { replace: true });
            else setState({ kind: 'role_not_admin' });
          } finally {
            db.close();
          }
        }}
      >
        <h1 className="text-2xl font-medium">{copy.login.title}</h1>
        <label className="block">
          <span className="text-sm text-[var(--color-subtext-0)]">{copy.login.passphraseLabel}</span>
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete="current-password"
            className="mt-1 w-full rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-mantle)] px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={status.kind === 'busy'}
          className="w-full rounded-md bg-[var(--color-mauve)] px-4 py-2 text-[var(--color-base)] disabled:opacity-50"
        >
          {copy.login.submit}
        </button>
        {status.kind === 'error' && (
          <p className="text-sm text-[var(--color-red)]">{copy.login.errors[status.copyKey]}</p>
        )}
      </form>
    </main>
  );
}
```

Create the supporting `apps/admin-client/src/lib/server-client.ts` (copy the `httpServerClient` from user-client, dropping methods not relevant to admin login — alternatively, also share via ui-shared in a later squash):

```ts
// SPDX-License-Identifier: AGPL-3.0-only
// Slim ServerClient suitable for admin-client login. Long-term this moves to
// ui-shared once the wire-shape types are consolidated.
import type { ServerClient } from '@chatsundere/crypto';
import type {
  OpaqueLoginFinishRequest, OpaqueLoginFinishResponse,
  OpaqueLoginStartRequest, OpaqueLoginStartResponse,
} from '@chatsundere/shared-types';
import { apiFetch } from './fetch.js';
import { env } from '../env.js';

export const httpServerClient: ServerClient = {
  loginOpaqueStart: (req: OpaqueLoginStartRequest) =>
    apiFetch<OpaqueLoginStartResponse>({
      baseUrl: env.VITE_AUTH_URL,
      path: '/auth/v1/opaque/login/start',
      json: req,
      authMode: 'none',
    }),
  loginOpaqueFinish: (req: OpaqueLoginFinishRequest) =>
    apiFetch<OpaqueLoginFinishResponse>({
      baseUrl: env.VITE_AUTH_URL,
      path: '/auth/v1/opaque/login/finish',
      json: req,
      authMode: 'none',
    }),
  // Stub the rest — admin-client never calls them. If something does, the throw
  // makes that obvious during integration testing.
  linkOpaqueStart: () => { throw new Error('not used in admin-client'); },
  linkOpaqueFinish: () => { throw new Error('not used in admin-client'); },
  linkPasskeyStart: () => { throw new Error('not used in admin-client'); },
  linkPasskeyFinish: () => { throw new Error('not used in admin-client'); },
  recoveryStart: () => { throw new Error('not used in admin-client'); },
  recoveryFinish: () => { throw new Error('not used in admin-client'); },
  deleteMe: () => { throw new Error('not used in admin-client'); },
  passphraseChangeStart: () => { throw new Error('not used in admin-client'); },
  passphraseChangeFinish: () => { throw new Error('not used in admin-client'); },
};
```

- [ ] **Step 7: Run integration tests**

Run: `pnpm --filter @chatsundere/admin-client test`
Expected: 20 tests pass (4 integration + 16 from prior tasks).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Squash C / Task 7: login screen with five-branch decision tree"
```

---

## Task 8 — Dashboard

**Files:**
- Create: `apps/admin-client/src/routes/dashboard/index.tsx`
- Modify: `apps/admin-client/src/copy.ts` (add dashboard keys)

- [ ] **Step 1: Add dashboard copy**

Append to the `copy` object:

```ts
  dashboard: {
    title: 'Dashboard',
    cards: {
      totalUsers: 'Total users',
      pendingInvitations: 'Pending invitations',
      suspendedUsers: 'Suspended users',
    },
    recentActivity: 'Recent activity',
    noActivity: 'No recent activity.',
  },
```

- [ ] **Step 2: Implement the dashboard route**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { copy } from '../../copy.js';
import { getAdminApi } from '../../data/index.js';
import { formatRelative } from '../../lib/format.js';

export function DashboardScreen() {
  const api = getAdminApi();
  const { data } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => api.getDashboardSummary(),
  });

  if (!data) return <p>{copy.loading}</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-medium">{copy.dashboard.title}</h1>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card label={copy.dashboard.cards.totalUsers} value={data.total_users} />
        <Card label={copy.dashboard.cards.pendingInvitations} value={data.pending_invitations} />
        <Card label={copy.dashboard.cards.suspendedUsers} value={data.suspended_users} />
      </div>
      <section>
        <h2 className="mb-2 text-xl">{copy.dashboard.recentActivity}</h2>
        {data.recent_activity.length === 0 ? (
          <p className="text-[var(--color-subtext-0)]">{copy.dashboard.noActivity}</p>
        ) : (
          <ul className="space-y-2">
            {data.recent_activity.map((e) => (
              <li key={e.id} className="rounded-md bg-[var(--color-mantle)] px-4 py-2">
                <div className="flex justify-between gap-2 text-sm">
                  <span className="font-mono">{e.event_type}</span>
                  <span className="text-[var(--color-subtext-0)]">{formatRelative(e.timestamp)}</span>
                </div>
                <div className="text-xs text-[var(--color-subtext-0)]">
                  {e.actor_username ?? '—'}
                  {e.subject_username ? ` → ${e.subject_username}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Link to="/users" className="text-[var(--color-mauve)] underline">View users</Link>
    </div>
  );
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-[var(--color-mantle)] p-4">
      <div className="text-sm text-[var(--color-subtext-0)]">{label}</div>
      <div className="text-3xl">{value}</div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + test**

Run: `pnpm --filter @chatsundere/admin-client typecheck && pnpm --filter @chatsundere/admin-client test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Squash C / Task 8: dashboard screen"
```

---

## Task 9 — Users list (filters, pagination)

**Files:**
- Create: `apps/admin-client/src/routes/users/index.tsx`
- Create: `apps/admin-client/tests/unit/users-list-filter.test.ts`
- Modify: `apps/admin-client/src/copy.ts`

- [ ] **Step 1: Add copy keys**

```ts
  users: {
    title: 'Users',
    searchPlaceholder: 'Search by username',
    roleFilter: { all: 'All roles', primary_admin: 'Primary admin', admin: 'Admin', user: 'User' },
    statusFilter: { all: 'All statuses', active: 'Active', suspended: 'Suspended' },
    columns: {
      username: 'Username',
      role: 'Role',
      status: 'Status',
      createdAt: 'Created',
      lastLogin: 'Last login',
    },
    createInvitation: 'Create invitation',
    empty: 'Just you so far. Create an invitation to add the next user.',
    pagePrev: '← Previous',
    pageNext: 'Next →',
  },
```

- [ ] **Step 2: Write failing filter test**

Create `apps/admin-client/tests/unit/users-list-filter.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { reduceListFilter, initialListFilter } from '../../src/routes/users/index.js';

describe('users list filter reducer', () => {
  it('sets search and resets page to 1', () => {
    const next = reduceListFilter({ ...initialListFilter, page: 3 }, { type: 'search', value: 'al' });
    expect(next.search).toBe('al');
    expect(next.page).toBe(1);
  });

  it('changes role filter and resets page', () => {
    const next = reduceListFilter({ ...initialListFilter, page: 3 }, { type: 'role', value: 'admin' });
    expect(next.role).toBe('admin');
    expect(next.page).toBe(1);
  });

  it('paginates without touching filters', () => {
    const next = reduceListFilter({ ...initialListFilter, search: 'al' }, { type: 'page', value: 2 });
    expect(next.page).toBe(2);
    expect(next.search).toBe('al');
  });
});
```

- [ ] **Step 3: Run, verify fail**

Run: `pnpm --filter @chatsundere/admin-client test`
Expected: FAIL on missing exports.

- [ ] **Step 4: Implement Users list**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useReducer } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { copy } from '../../copy.js';
import { getAdminApi } from '../../data/index.js';
import { formatRelative } from '../../lib/format.js';
import type { Role } from '../../lib/self-target.js';
import type { UserStatus } from '../../data/admin-api.js';

export interface ListFilter {
  search: string;
  role: Role | 'all';
  status: UserStatus | 'all';
  page: number;
}

export const initialListFilter: ListFilter = {
  search: '',
  role: 'all',
  status: 'all',
  page: 1,
};

export type ListFilterAction =
  | { type: 'search'; value: string }
  | { type: 'role'; value: Role | 'all' }
  | { type: 'status'; value: UserStatus | 'all' }
  | { type: 'page'; value: number };

export function reduceListFilter(state: ListFilter, action: ListFilterAction): ListFilter {
  switch (action.type) {
    case 'search':
      return { ...state, search: action.value, page: 1 };
    case 'role':
      return { ...state, role: action.value, page: 1 };
    case 'status':
      return { ...state, status: action.value, page: 1 };
    case 'page':
      return { ...state, page: action.value };
  }
}

export function UsersListScreen() {
  const [filter, dispatch] = useReducer(reduceListFilter, initialListFilter);
  const api = getAdminApi();
  const { data } = useQuery({
    queryKey: ['users', filter],
    queryFn: () => api.listUsers(filter),
    keepPreviousData: true,
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-medium">{copy.users.title}</h1>
        <Link
          to="/invitations"
          className="rounded-md bg-[var(--color-mauve)] px-4 py-2 text-[var(--color-base)]"
        >
          {copy.users.createInvitation}
        </Link>
      </header>

      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={filter.search}
          onChange={(e) => dispatch({ type: 'search', value: e.target.value })}
          placeholder={copy.users.searchPlaceholder}
          className="flex-1 rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-mantle)] px-3 py-2"
        />
        <select
          value={filter.role}
          onChange={(e) => dispatch({ type: 'role', value: e.target.value as ListFilter['role'] })}
          className="rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-mantle)] px-3 py-2"
        >
          <option value="all">{copy.users.roleFilter.all}</option>
          <option value="primary_admin">{copy.users.roleFilter.primary_admin}</option>
          <option value="admin">{copy.users.roleFilter.admin}</option>
          <option value="user">{copy.users.roleFilter.user}</option>
        </select>
        <select
          value={filter.status}
          onChange={(e) => dispatch({ type: 'status', value: e.target.value as ListFilter['status'] })}
          className="rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-mantle)] px-3 py-2"
        >
          <option value="all">{copy.users.statusFilter.all}</option>
          <option value="active">{copy.users.statusFilter.active}</option>
          <option value="suspended">{copy.users.statusFilter.suspended}</option>
        </select>
      </div>

      {!data ? (
        <p>{copy.loading}</p>
      ) : data.items.length === 0 && data.total === 0 ? (
        <p className="text-[var(--color-subtext-0)]">{copy.users.empty}</p>
      ) : (
        <>
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs uppercase text-[var(--color-subtext-0)]">
                <th className="py-2">{copy.users.columns.username}</th>
                <th className="py-2">{copy.users.columns.role}</th>
                <th className="py-2">{copy.users.columns.status}</th>
                <th className="py-2">{copy.users.columns.createdAt}</th>
                <th className="py-2">{copy.users.columns.lastLogin}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((u) => (
                <tr key={u.id} className="border-t border-[var(--color-overlay-0)]">
                  <td className="py-2"><Link to={`/users/${u.id}`} className="text-[var(--color-mauve)] underline">{u.username}</Link></td>
                  <td className="py-2">{u.role}</td>
                  <td className="py-2">{u.status}</td>
                  <td className="py-2">{formatRelative(u.created_at)}</td>
                  <td className="py-2">{formatRelative(u.last_login_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => dispatch({ type: 'page', value: Math.max(1, filter.page - 1) })}
              disabled={filter.page <= 1}
              className="rounded-md px-3 py-1 disabled:opacity-50"
            >
              {copy.users.pagePrev}
            </button>
            <span className="text-sm text-[var(--color-subtext-0)]">
              {data.page} / {Math.max(1, Math.ceil(data.total / data.per_page))}
            </span>
            <button
              type="button"
              onClick={() => dispatch({ type: 'page', value: filter.page + 1 })}
              disabled={filter.page * data.per_page >= data.total}
              className="rounded-md px-3 py-1 disabled:opacity-50"
            >
              {copy.users.pageNext}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify tests + typecheck**

Run: `pnpm --filter @chatsundere/admin-client test && pnpm --filter @chatsundere/admin-client typecheck`
Expected: 23 tests pass (3 new + 20 prior); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Squash C / Task 9: users list with filters and pagination"
```

---

## Task 10 — Users detail with self-target gating and ConfirmTyped delete

**Files:**
- Create: `apps/admin-client/src/routes/users/detail.tsx`
- Create: `apps/admin-client/src/routes/users/actions.tsx`
- Modify: `apps/admin-client/src/copy.ts`

- [ ] **Step 1: Add copy keys**

```ts
  userDetail: {
    actions: {
      suspend: 'Suspend',
      unsuspend: 'Unsuspend',
      changeRole: 'Change role',
      transferPrimary: 'Transfer primary admin',
      delete: 'Delete user',
    },
    selfTargetTooltip: 'You cannot perform this action on your own account.',
    primaryOnlyTooltip: 'Only the primary admin can perform this action.',
    deleteConfirmLabel: 'Type the username to confirm:',
    authMethods: 'Authentication methods',
  },
```

- [ ] **Step 2: Implement actions.tsx**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ConfirmTyped, useSessionStore } from '@chatsundere/ui-shared';
import { copy } from '../../copy.js';
import { getAdminApi } from '../../data/index.js';
import { isPrimaryAdmin, isSelfTarget } from '../../lib/self-target.js';
import type { UserDetail } from '../../data/admin-api.js';

interface Props {
  user: UserDetail;
  onDeleted: () => void;
}

export function UserActions({ user, onDeleted }: Props) {
  const session = useSessionStore((s) => s.session);
  const api = getAdminApi();
  const qc = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const sessionLike = { userId: session?.userId ?? null };
  const isSelf = isSelfTarget(sessionLike, user.id);
  const sessionIsPrimary = isPrimaryAdmin(session?.role ?? 'user');

  const suspend = useMutation({
    mutationFn: () => api.suspendUser(user.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user', user.id] }),
  });
  const unsuspend = useMutation({
    mutationFn: () => api.unsuspendUser(user.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user', user.id] }),
  });
  const del = useMutation({
    mutationFn: () => api.deleteUser(user.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      onDeleted();
    },
  });

  const selfBlocked = isSelf;
  const selfTooltip = selfBlocked ? copy.userDetail.selfTargetTooltip : undefined;
  const primaryTooltip = !sessionIsPrimary ? copy.userDetail.primaryOnlyTooltip : undefined;

  return (
    <div className="space-y-2">
      {user.status === 'active' ? (
        <ActionButton
          label={copy.userDetail.actions.suspend}
          disabled={selfBlocked || suspend.isPending}
          tooltip={selfTooltip}
          onClick={() => suspend.mutate()}
        />
      ) : (
        <ActionButton
          label={copy.userDetail.actions.unsuspend}
          disabled={selfBlocked || unsuspend.isPending}
          tooltip={selfTooltip}
          onClick={() => unsuspend.mutate()}
        />
      )}

      <ActionButton
        label={copy.userDetail.actions.changeRole}
        disabled={selfBlocked || !sessionIsPrimary}
        tooltip={selfTooltip ?? primaryTooltip}
        onClick={() => {
          /* role-change form is opened inline; out-of-scope for the gating-only
             integration but slotted in the same task in finalisation */
        }}
      />

      <ActionButton
        label={copy.userDetail.actions.transferPrimary}
        disabled={selfBlocked || !sessionIsPrimary || user.role !== 'admin'}
        tooltip={selfTooltip ?? primaryTooltip}
        onClick={() => void api.transferPrimary(user.id)}
      />

      <ActionButton
        label={copy.userDetail.actions.delete}
        disabled={selfBlocked || del.isPending}
        tooltip={selfTooltip}
        destructive
        onClick={() => setConfirmingDelete(true)}
      />

      {confirmingDelete && (
        <ConfirmTyped
          label={copy.userDetail.deleteConfirmLabel}
          requiredText={user.username}
          confirmText={copy.userDetail.actions.delete}
          onConfirm={() => del.mutate()}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}

function ActionButton({
  label,
  disabled,
  tooltip,
  destructive,
  onClick,
}: {
  label: string;
  disabled: boolean;
  tooltip?: string;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={tooltip}
      onClick={onClick}
      className={
        'w-full rounded-md px-3 py-2 text-left ' +
        (destructive
          ? 'bg-[var(--color-red)] text-[var(--color-base)]'
          : 'bg-[var(--color-mantle)]') +
        ' disabled:opacity-50'
      }
    >
      {label}
      {tooltip && disabled && (
        <span className="ml-2 block text-xs text-[var(--color-subtext-0)]">{tooltip}</span>
      )}
    </button>
  );
}
```

If `ConfirmTyped`'s actual props differ from `{ label, requiredText, confirmText, onConfirm, onCancel }`, adjust the call site to match the existing signature in `packages/ui-shared/src/components/ConfirmTyped.tsx`.

- [ ] **Step 3: Implement detail.tsx**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { copy } from '../../copy.js';
import { getAdminApi } from '../../data/index.js';
import { formatRelative } from '../../lib/format.js';
import { UserActions } from './actions.js';
import { UsersListScreen } from './index.js';

export function UserDetailScreen() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const api = getAdminApi();
  const { data } = useQuery({
    queryKey: ['user', id],
    queryFn: () => api.getUser(id),
    enabled: !!id,
  });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_3fr]">
      <div className="hidden lg:block">
        <UsersListScreen />
      </div>
      <aside className="space-y-4 rounded-md bg-[var(--color-mantle)] p-4">
        {!data ? (
          <p>{copy.loading}</p>
        ) : (
          <>
            <div>
              <h2 className="text-2xl">{data.username}</h2>
              <p className="font-mono text-xs text-[var(--color-subtext-0)]">{data.id}</p>
            </div>
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-[var(--color-subtext-0)]">Role</dt>
              <dd>{data.role}</dd>
              <dt className="text-[var(--color-subtext-0)]">Status</dt>
              <dd>{data.status}</dd>
              <dt className="text-[var(--color-subtext-0)]">Created</dt>
              <dd>{formatRelative(data.created_at)}</dd>
              <dt className="text-[var(--color-subtext-0)]">Last login</dt>
              <dd>{formatRelative(data.last_login_at)}</dd>
            </dl>
            <div>
              <h3 className="mb-1 text-sm uppercase text-[var(--color-subtext-0)]">{copy.userDetail.authMethods}</h3>
              <ul className="space-y-1 text-sm">
                {data.auth_methods.map((m) => (
                  <li key={m.id} className="flex justify-between">
                    <span>{m.label} ({m.type})</span>
                    <span className="text-[var(--color-subtext-0)]">{formatRelative(m.last_used_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <UserActions user={data} onDeleted={() => navigate('/users', { replace: true })} />
            <Link to="/users" className="block text-sm text-[var(--color-mauve)] underline">← Back to all users</Link>
          </>
        )}
      </aside>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + test**

Run: `pnpm --filter @chatsundere/admin-client typecheck && pnpm --filter @chatsundere/admin-client test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Squash C / Task 10: user detail with self-target gating and delete-confirm"
```

---

## Task 11 — Invitations list, create modal, reveal screen, integration test

**Files:**
- Create: `apps/admin-client/src/routes/invitations/index.tsx`
- Create: `apps/admin-client/src/routes/invitations/create-modal.tsx`
- Create: `apps/admin-client/src/routes/invitations/reveal-screen.tsx`
- Create: `apps/admin-client/tests/integration/invitation-create.test.tsx`
- Modify: `apps/admin-client/src/copy.ts`

- [ ] **Step 1: Add copy keys**

```ts
  invitations: {
    title: 'Invitations',
    create: 'Create invitation',
    revoke: 'Revoke',
    columns: { createdAt: 'Created', role: 'Role', status: 'Status', redeemedBy: 'Redeemed by', expiresAt: 'Expires' },
    empty: 'No invitations yet. Create one to start onboarding people.',
    modal: {
      title: 'Create invitation',
      role: 'Role',
      expiresIn: 'Expires in',
      issuerLabel: 'Issuer label (optional)',
      submit: 'Create',
      cancel: 'Cancel',
    },
    reveal: {
      title: 'Invitation created',
      warning: 'This is shown only once. Make sure to capture it before closing.',
      copyUrl: 'Copy URL',
      copyToken: 'Copy token',
      close: 'Close',
    },
  },
```

- [ ] **Step 2: Write failing integration test**

Create `apps/admin-client/tests/integration/invitation-create.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { InvitationsScreen } from '../../src/routes/invitations/index.js';

describe('invitation create flow', () => {
  it('opens create modal, submits, reveals the token, and hides it on close', async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <InvitationsScreen />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /create invitation/i }));
    expect(await screen.findByText(/Create invitation/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByText(/Invitation created/i)).toBeInTheDocument();
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();
    // The QR canvas + URL appear; we don't assert pixel content, only presence.
    expect(screen.getByLabelText(/url/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^close$/i }));
    expect(screen.queryByText(/Invitation created/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run, verify fail**

Run: `pnpm --filter @chatsundere/admin-client test`
Expected: FAIL (`InvitationsScreen` not found).

- [ ] **Step 4: Implement reveal-screen.tsx**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { copy } from '../../copy.js';
import type { InvitationCreated } from '../../data/admin-api.js';

interface Props {
  invitation: InvitationCreated;
  onClose: () => void;
}

export function InvitationRevealScreen({ invitation, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (canvasRef.current) {
      void QRCode.toCanvas(canvasRef.current, invitation.qr_payload, { width: 240 });
    }
  }, [invitation.qr_payload]);

  return (
    <div role="dialog" aria-modal="true" className="space-y-4 rounded-md bg-[var(--color-mantle)] p-6">
      <h2 className="text-2xl">{copy.invitations.reveal.title}</h2>
      <p className="text-[var(--color-yellow)]">{copy.invitations.reveal.warning}</p>
      <canvas ref={canvasRef} className="mx-auto" />
      <label className="block text-sm">
        URL
        <input
          readOnly
          aria-label="URL"
          value={invitation.url}
          className="mt-1 w-full rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-base)] px-2 py-1 font-mono text-xs"
        />
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(invitation.url)}
          className="rounded-md bg-[var(--color-base)] px-3 py-1"
        >
          {copy.invitations.reveal.copyUrl}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-[var(--color-mauve)] px-3 py-1 text-[var(--color-base)]"
        >
          {copy.invitations.reveal.close}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement create-modal.tsx**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { copy } from '../../copy.js';
import { getAdminApi } from '../../data/index.js';
import type { InvitationCreated, CreateInvitationInput } from '../../data/admin-api.js';

interface Props {
  onCreated: (inv: InvitationCreated) => void;
  onCancel: () => void;
}

export function InvitationCreateModal({ onCreated, onCancel }: Props) {
  const [role, setRole] = useState<CreateInvitationInput['role']>('user');
  const [expiresIn, setExpiresIn] = useState<1 | 7 | 30>(7);
  const [issuerLabel, setIssuerLabel] = useState('');
  const api = getAdminApi();

  const create = useMutation({
    mutationFn: (input: CreateInvitationInput) => api.createInvitation(input),
    onSuccess: onCreated,
  });

  return (
    <div role="dialog" aria-modal="true" className="space-y-4 rounded-md bg-[var(--color-mantle)] p-6">
      <h2 className="text-2xl">{copy.invitations.modal.title}</h2>
      <label className="block text-sm">
        {copy.invitations.modal.role}
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as CreateInvitationInput['role'])}
          className="mt-1 w-full rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-base)] px-3 py-2"
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <label className="block text-sm">
        {copy.invitations.modal.expiresIn}
        <select
          value={expiresIn}
          onChange={(e) => setExpiresIn(Number(e.target.value) as 1 | 7 | 30)}
          className="mt-1 w-full rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-base)] px-3 py-2"
        >
          <option value={1}>1 day</option>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
        </select>
      </label>
      <label className="block text-sm">
        {copy.invitations.modal.issuerLabel}
        <input
          value={issuerLabel}
          onChange={(e) => setIssuerLabel(e.target.value)}
          className="mt-1 w-full rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-base)] px-3 py-2"
        />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1">
          {copy.invitations.modal.cancel}
        </button>
        <button
          type="button"
          onClick={() => create.mutate({ role, expires_in_days: expiresIn, ...(issuerLabel ? { issuer_label: issuerLabel } : {}) })}
          disabled={create.isPending}
          className="rounded-md bg-[var(--color-mauve)] px-3 py-1 text-[var(--color-base)] disabled:opacity-50"
        >
          {copy.invitations.modal.submit}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Implement Invitations list**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { copy } from '../../copy.js';
import { getAdminApi } from '../../data/index.js';
import { formatRelative } from '../../lib/format.js';
import { InvitationCreateModal } from './create-modal.js';
import { InvitationRevealScreen } from './reveal-screen.js';
import type { InvitationCreated, InvitationStatus } from '../../data/admin-api.js';

export function InvitationsScreen() {
  const api = getAdminApi();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<InvitationStatus | 'all'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [revealed, setRevealed] = useState<InvitationCreated | null>(null);

  const { data } = useQuery({
    queryKey: ['invitations', filter],
    queryFn: () => api.listInvitations({ status: filter }),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeInvitation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations'] }),
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-medium">{copy.invitations.title}</h1>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded-md bg-[var(--color-mauve)] px-4 py-2 text-[var(--color-base)]"
        >
          {copy.invitations.create}
        </button>
      </header>

      <select
        value={filter}
        onChange={(e) => setFilter(e.target.value as InvitationStatus | 'all')}
        className="rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-mantle)] px-3 py-2"
      >
        <option value="all">All</option>
        <option value="pending">Pending</option>
        <option value="redeemed">Redeemed</option>
        <option value="expired">Expired</option>
        <option value="revoked">Revoked</option>
      </select>

      {!data ? <p>{copy.loading}</p> : data.items.length === 0 ? (
        <p className="text-[var(--color-subtext-0)]">{copy.invitations.empty}</p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="text-xs uppercase text-[var(--color-subtext-0)]">
              <th className="py-2">{copy.invitations.columns.createdAt}</th>
              <th className="py-2">{copy.invitations.columns.role}</th>
              <th className="py-2">{copy.invitations.columns.status}</th>
              <th className="py-2">{copy.invitations.columns.redeemedBy}</th>
              <th className="py-2">{copy.invitations.columns.expiresAt}</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {data.items.map((inv) => (
              <tr key={inv.id} className="border-t border-[var(--color-overlay-0)]">
                <td className="py-2">{formatRelative(inv.created_at)}</td>
                <td className="py-2">{inv.role}</td>
                <td className="py-2">{inv.status}</td>
                <td className="py-2">{inv.redeemed_by ?? '—'}</td>
                <td className="py-2">{formatRelative(inv.expires_at)}</td>
                <td className="py-2 text-right">
                  {inv.status === 'pending' && (
                    <button
                      type="button"
                      onClick={() => revoke.mutate(inv.id)}
                      disabled={revoke.isPending}
                      className="rounded-md px-2 py-1 text-sm text-[var(--color-red)] disabled:opacity-50"
                    >
                      {copy.invitations.revoke}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modalOpen && !revealed && (
        <InvitationCreateModal
          onCreated={(inv) => {
            setModalOpen(false);
            setRevealed(inv);
            qc.invalidateQueries({ queryKey: ['invitations'] });
          }}
          onCancel={() => setModalOpen(false)}
        />
      )}
      {revealed && (
        <InvitationRevealScreen
          invitation={revealed}
          onClose={() => setRevealed(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @chatsundere/admin-client test`
Expected: 24 tests pass (1 new integration + 23 prior).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Squash C / Task 11: invitations list with create modal and reveal screen"
```

---

## Task 12 — Audit log with filters, pagination, JSON-expand

**Files:**
- Create: `apps/admin-client/src/routes/audit/index.tsx`
- Modify: `apps/admin-client/src/copy.ts`

- [ ] **Step 1: Add copy keys**

```ts
  audit: {
    title: 'Audit log',
    filters: { category: 'Category', user: 'User filter', from: 'From', to: 'To' },
    categories: {
      all: 'All categories',
      auth: 'Auth',
      'user-lifecycle': 'User lifecycle',
      'invitation-lifecycle': 'Invitation lifecycle',
      recovery: 'Recovery',
      'admin-action': 'Admin action',
    },
    columns: { timestamp: 'Timestamp', eventType: 'Event', actor: 'Actor', subject: 'Subject', metadata: 'Metadata' },
    expandMetadata: 'Expand',
    collapseMetadata: 'Collapse',
    empty: 'No matching events. Try a wider time range.',
  },
```

- [ ] **Step 2: Implement audit list**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useReducer, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { copy } from '../../copy.js';
import { getAdminApi } from '../../data/index.js';
import { formatRelative } from '../../lib/format.js';
import type { AuditEventCategory } from '../../data/admin-api.js';

interface AuditFilter {
  category: AuditEventCategory | 'all';
  user_id: string;
  from: string;
  to: string;
  page: number;
}

const initial: AuditFilter = { category: 'all', user_id: '', from: '', to: '', page: 1 };

type FilterAction =
  | { type: 'category'; value: AuditFilter['category'] }
  | { type: 'user_id'; value: string }
  | { type: 'from'; value: string }
  | { type: 'to'; value: string }
  | { type: 'page'; value: number };

function reduce(state: AuditFilter, action: FilterAction): AuditFilter {
  switch (action.type) {
    case 'category':
    case 'user_id':
    case 'from':
    case 'to':
      return { ...state, [action.type]: action.value, page: 1 };
    case 'page':
      return { ...state, page: action.value };
  }
}

export function AuditScreen() {
  const [filter, dispatch] = useReducer(reduce, initial);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const api = getAdminApi();
  const { data } = useQuery({
    queryKey: ['audit', filter],
    queryFn: () =>
      api.listAudit({
        ...(filter.category !== 'all' ? { category: filter.category } : {}),
        ...(filter.user_id ? { user_id: filter.user_id } : {}),
        ...(filter.from ? { from: filter.from } : {}),
        ...(filter.to ? { to: filter.to } : {}),
        page: filter.page,
      }),
    keepPreviousData: true,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-medium">{copy.audit.title}</h1>
      <div className="flex flex-wrap gap-2">
        <select
          value={filter.category}
          onChange={(e) => dispatch({ type: 'category', value: e.target.value as AuditFilter['category'] })}
          className="rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-mantle)] px-3 py-2"
        >
          <option value="all">{copy.audit.categories.all}</option>
          <option value="auth">{copy.audit.categories.auth}</option>
          <option value="user-lifecycle">{copy.audit.categories['user-lifecycle']}</option>
          <option value="invitation-lifecycle">{copy.audit.categories['invitation-lifecycle']}</option>
          <option value="recovery">{copy.audit.categories.recovery}</option>
          <option value="admin-action">{copy.audit.categories['admin-action']}</option>
        </select>
        <input
          type="text"
          value={filter.user_id}
          onChange={(e) => dispatch({ type: 'user_id', value: e.target.value })}
          placeholder={copy.audit.filters.user}
          className="rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-mantle)] px-3 py-2"
        />
        <input
          type="date"
          value={filter.from}
          onChange={(e) => dispatch({ type: 'from', value: e.target.value })}
          className="rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-mantle)] px-3 py-2"
        />
        <input
          type="date"
          value={filter.to}
          onChange={(e) => dispatch({ type: 'to', value: e.target.value })}
          className="rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-mantle)] px-3 py-2"
        />
      </div>

      {!data ? <p>{copy.loading}</p> : data.items.length === 0 ? (
        <p className="text-[var(--color-subtext-0)]">{copy.audit.empty}</p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="text-xs uppercase text-[var(--color-subtext-0)]">
              <th className="py-2">{copy.audit.columns.timestamp}</th>
              <th className="py-2">{copy.audit.columns.eventType}</th>
              <th className="py-2">{copy.audit.columns.actor}</th>
              <th className="py-2">{copy.audit.columns.subject}</th>
              <th className="py-2">{copy.audit.columns.metadata}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((e) => {
              const isExpanded = expanded.has(e.id);
              return (
                <tr key={e.id} className="border-t border-[var(--color-overlay-0)]">
                  <td className="py-2">{formatRelative(e.timestamp)}</td>
                  <td className="py-2 font-mono text-xs">{e.event_type}</td>
                  <td className="py-2">{e.actor_username ?? '—'}</td>
                  <td className="py-2">{e.subject_username ?? '—'}</td>
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={() => {
                        const next = new Set(expanded);
                        if (isExpanded) next.delete(e.id);
                        else next.add(e.id);
                        setExpanded(next);
                      }}
                      className="text-sm text-[var(--color-mauve)] underline"
                    >
                      {isExpanded ? copy.audit.collapseMetadata : copy.audit.expandMetadata}
                    </button>
                    {isExpanded && (
                      <pre className="mt-1 max-w-xs whitespace-pre-wrap break-words rounded-md bg-[var(--color-mantle)] p-2 text-xs">
                        {JSON.stringify(e.metadata, null, 2)}
                      </pre>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => dispatch({ type: 'page', value: Math.max(1, filter.page - 1) })}
          disabled={filter.page <= 1}
          className="rounded-md px-3 py-1 disabled:opacity-50"
        >
          {copy.users.pagePrev}
        </button>
        {data && (
          <span className="text-sm text-[var(--color-subtext-0)]">
            {data.page} / {Math.max(1, Math.ceil(data.total / data.per_page))}
          </span>
        )}
        <button
          type="button"
          onClick={() => dispatch({ type: 'page', value: filter.page + 1 })}
          disabled={!data || filter.page * data.per_page >= data.total}
          className="rounded-md px-3 py-1 disabled:opacity-50"
        >
          {copy.users.pageNext}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + test**

Run: `pnpm --filter @chatsundere/admin-client typecheck && pnpm --filter @chatsundere/admin-client test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Squash C / Task 12: audit log with filters, pagination, JSON expand"
```

---

## Task 13 — App shell, sign-out, gate, final polish

**Files:**
- Create: `apps/admin-client/src/routes/root.tsx`
- Create: `apps/admin-client/src/routes/gate.tsx`
- Modify: `apps/admin-client/src/App.tsx`
- Modify: `apps/admin-client/src/main.tsx`
- Modify: `apps/admin-client/src/copy.ts`

- [ ] **Step 1: Implement root.tsx (layout + top-bar + sign-out)**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useSessionStore } from '@chatsundere/ui-shared';
import { copy } from '../copy.js';

export function RootLayout() {
  const session = useSessionStore((s) => s.session);
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-[var(--color-overlay-0)] bg-[var(--color-mantle)] px-4 py-3">
        <div className="flex items-center gap-6">
          <span className="text-lg">{copy.appName}</span>
          <nav className="flex gap-4 text-sm">
            <NavLink to="/dashboard" className={({ isActive }) => isActive ? 'underline' : ''}>Dashboard</NavLink>
            <NavLink to="/users" className={({ isActive }) => isActive ? 'underline' : ''}>Users</NavLink>
            <NavLink to="/invitations" className={({ isActive }) => isActive ? 'underline' : ''}>Invitations</NavLink>
            <NavLink to="/audit" className={({ isActive }) => isActive ? 'underline' : ''}>Audit</NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {session && (
            <>
              <span className="text-[var(--color-subtext-0)]">{session.userId.slice(0, 8)}…</span>
              <button
                type="button"
                onClick={() => {
                  useSessionStore.getState().closeAndForget?.();
                  useSessionStore.setState({ session: null } as never);
                  navigate('/login', { replace: true });
                }}
                className="rounded-md bg-[var(--color-base)] px-3 py-1"
              >
                {copy.signOut}
              </button>
            </>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Implement gate.tsx**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { Navigate } from 'react-router-dom';
import { useSessionStore } from '@chatsundere/ui-shared';

export function Gate() {
  const session = useSessionStore((s) => s.session);
  if (session && (session.role === 'admin' || session.role === 'primary_admin')) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Navigate to="/login" replace />;
}
```

- [ ] **Step 3: Rewrite App.tsx with the route table**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AdminRouteGuard } from './lib/admin-route-guard.js';
import { Gate } from './routes/gate.js';
import { RootLayout } from './routes/root.js';
import { LoginScreen } from './routes/login/index.js';
import { DashboardScreen } from './routes/dashboard/index.js';
import { UsersListScreen } from './routes/users/index.js';
import { UserDetailScreen } from './routes/users/detail.js';
import { InvitationsScreen } from './routes/invitations/index.js';
import { AuditScreen } from './routes/audit/index.js';

export function App() {
  return (
    <BrowserRouter basename="/admin">
      <Routes>
        <Route path="/" element={<Gate />} />
        <Route path="/login" element={<LoginScreen />} />
        <Route
          element={
            <AdminRouteGuard>
              <RootLayout />
            </AdminRouteGuard>
          }
        >
          <Route path="/dashboard" element={<DashboardScreen />} />
          <Route path="/users" element={<UsersListScreen />} />
          <Route path="/users/:id" element={<UserDetailScreen />} />
          <Route path="/invitations" element={<InvitationsScreen />} />
          <Route path="/audit" element={<AuditScreen />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 4: Rewrite main.tsx with QueryClient provider**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.js';
import { queryClient } from './lib/query-client.js';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 5: Run the full repo-wide verification**

Run (in this exact order to catch any cross-package interface drift, per Squash D lesson 11):

```bash
pnpm typecheck
pnpm test
pnpm exec biome check apps packages
pnpm build
```

Expected: all four green.

- [ ] **Step 6: Larissa audit on the diff slice**

Summon Larissa (Opus-class subagent) with the spec, the parent spec §6, and the diff slice covering:

- `apps/admin-client/src/lib/self-target.ts`
- `apps/admin-client/src/routes/users/actions.tsx`
- `apps/admin-client/src/routes/users/detail.tsx` (gating call sites only)

The audit's scope is: self-target predicates + Users-detail action gating + delete-user ConfirmTyped flow. Anything else is out of audit scope.

Address Important/High findings; record any deferrals in `obsidian/insights/security-deferrals.md`. Re-run Larissa if necessary until clean.

- [ ] **Step 7: Manual QA dry run**

Step through spec §9 checklist (15 steps) locally. Capture any UX regressions or copy issues; fix in follow-up commits on this squash before the final-squash.

- [ ] **Step 8: Commit final polish**

```bash
git add -A
git commit -m "Squash C / Task 13: app shell, sign-out, route table, gate"
```

- [ ] **Step 9: Final-Squash C**

Once all tasks land and Manual-QA passes:

```bash
git log --oneline master..HEAD   # confirm the intermediate commits you want to fold
git reset --soft <pre-squash-c-base>
git status                       # everything staged
git commit -m "$(cat <<'EOF'
Add admin-client and ui-shared package

Implements spec §6 of the foundational-auth-layer design as Squash C:
a Catppuccin-themed operator console covering login, dashboard, users,
invitations, and audit log. Reads local_account and linked_account from
the shared IndexedDB; live login + role check against the auth-service;
admin actions ride a stub layer until backend lands.

Establishes packages/ui-shared as the home for cross-app primitives:
session-store, connectivity-store, ConfirmTyped, InlineMarker, motion
utilities, plus the OPAQUE + passkey login hooks. apps/user-client
migrates onto the new package; admin-client consumes it from day one.

The auth-service admin endpoints (suspend/unsuspend/delete/role-change/
transfer-primary/invitations/audit) remain stubbed. Live wiring follows
in a later auth-service squash once Lyra's invitation-and-pairing
briefs settle the canonical wire shapes.

Larissa audited the self-target predicates and Users-detail action
gating slice (audit H5 defence-in-depth) plus the delete-user
ConfirmTyped flow; clean. Rest of the squash is conventional frontend
per CLAUDE.md §9.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

The exact pre-squash-C base SHA is the commit immediately before Task 1's commit lands — capture it locally before starting Task 1 and reference it here.

---

## End-of-plan checklist for the implementer

- [ ] All 13 tasks committed individually.
- [ ] `pnpm typecheck && pnpm test && pnpm exec biome check apps packages && pnpm build` all green at the repo root.
- [ ] Larissa audit on the security slice clean (or deferrals filed).
- [ ] Manual-QA §9 checklist walked through on a live dev server.
- [ ] Final-squash committed with the single message above.
- [ ] No push (push happens after the next morning's review with Chris if there is one; otherwise per Chris's instruction).
