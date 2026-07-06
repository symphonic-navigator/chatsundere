# My Account — Admin tile & reorganisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a gold, admin-only "Admin" launcher to the My Account dashboard and reorganise its tile grid into a coherent 2×3 colour scheme, merging the two sign-in-security tiles into one hub.

**Architecture:** The backend advertises an optional admin-client URL through the existing `GET /api/v1/config` discovery endpoint (mirroring `proxyUrl`/`syncUrl`). The client already knows the user's backend role (`useAccountLinkStore`) and the discovered config (`useDiscoveryStore`); the Admin tile is gated on both and opens the URL in a new tab. The dashboard grid is re-laid-out; the biometric screen absorbs a Change-passphrase entry so the merged tile has one coherent destination.

**Tech Stack:** TypeScript (strict), Bun + Hono + Valibot (auth-service), React 18 + Vite (user-client), Valibot (ui-shared parser), Bun test (backend), Vitest (frontend).

## Global Constraints

- All repo text is **British English** (code, comments, copy, tests, commit messages). CLAUDE.md §3/§7.
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`; no `any` without an inline justification. CLAUDE.md §10.
- The build/CI gate is `pnpm typecheck --force` (covers tests) plus Biome; run both before each commit. Turbo caches typecheck — always `--force` at the gate.
- Commit messages: free-form imperative, capitalised subject; append `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. Do **not** push (Chris pushes). Do **not** squash per-task commits — they stay for Larissa + Chris.
- `apps/auth-service/**` is a Larissa audit path — Task 1 is audited before the eventual squash (not during this plan run).
- Admin discovery URL must be an **absolute https URL** (or loopback http in dev), same guard as proxy/sync.

---

### Task 1: auth-service — advertise `adminUrl` via `GET /api/v1/config`

**Files:**
- Modify: `apps/auth-service/src/env.ts` (add `ADMIN_PUBLIC_URL` — schema block near lines 53–66, interface near 95–97, load near 113–115)
- Modify: `apps/auth-service/src/routes/config.ts` (emit `adminUrl` + `'admin'` feature)
- Modify: `apps/auth-service/tests/setup.ts` (default `ADMIN_PUBLIC_URL` for the test env, line ~19–20)
- Modify: `apps/auth-service/tests/unit/config.test.ts` (new cases)
- Modify: `apps/auth-service/.env.example` (document `ADMIN_PUBLIC_URL`)

**Interfaces:**
- Produces: `GET /api/v1/config` response gains optional `adminUrl: string` and, when set, `'admin'` in `features`. Env var `ADMIN_PUBLIC_URL` (optional absolute https URL).

- [ ] **Step 1: Add the failing tests**

In `apps/auth-service/tests/unit/config.test.ts`, extend the top-of-file save/restore block to also cover `ADMIN_PUBLIC_URL`:

```ts
const savedAdmin = process.env.ADMIN_PUBLIC_URL;
```

and in the existing `afterEach`:

```ts
if (savedAdmin === undefined) Reflect.deleteProperty(process.env, 'ADMIN_PUBLIC_URL');
else process.env.ADMIN_PUBLIC_URL = savedAdmin;
```

Then add these cases inside `describe('GET /api/v1/config', ...)`:

```ts
test('includes adminUrl and the "admin" feature when ADMIN_PUBLIC_URL is set', async () => {
  process.env.ADMIN_PUBLIC_URL = 'https://admin.example';
  const res = await createServer().request('/api/v1/config');
  const body = (await res.json()) as { adminUrl?: string; features: string[] };
  expect(body.adminUrl).toBe('https://admin.example');
  expect(body.features).toContain('admin');
});

test('omits adminUrl and the "admin" feature when ADMIN_PUBLIC_URL is unset', async () => {
  Reflect.deleteProperty(process.env, 'ADMIN_PUBLIC_URL');
  const res = await createServer().request('/api/v1/config');
  const body = (await res.json()) as { adminUrl?: string; features: string[] };
  expect(body.adminUrl).toBeUndefined();
  expect(body.features).not.toContain('admin');
});

test('a non-https ADMIN_PUBLIC_URL fails env-load', async () => {
  process.env.ADMIN_PUBLIC_URL = 'http://insecure.example';
  expect(() => createServer()).toThrow();
});
```

Note: `tests/setup.ts` will default `ADMIN_PUBLIC_URL=https://admin.example` (Step 2), so the first "returns proxyUrl, syncUrl and both features" test in the file must be updated to expect the admin fields too — change its expectation to:

```ts
expect(await res.json()).toEqual({
  proxyUrl: 'https://proxy.example',
  syncUrl: 'https://sync.example',
  adminUrl: 'https://admin.example',
  features: ['proxy', 'sync', 'admin'],
});
```

And the "omits syncUrl…" test expectation becomes (sync deleted, admin still defaulted):

```ts
expect(await res.json()).toEqual({
  proxyUrl: 'https://proxy.example',
  adminUrl: 'https://admin.example',
  features: ['proxy', 'admin'],
});
```

- [ ] **Step 2: Add the env default to the test setup**

In `apps/auth-service/tests/setup.ts`, next to the existing lines ~19–20:

```ts
process.env.ADMIN_PUBLIC_URL ??= 'https://admin.example';
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/auth-service && bun test tests/unit/config.test.ts`
Expected: FAIL — the new/updated cases fail (config route emits no `adminUrl`; env has no `ADMIN_PUBLIC_URL`).

- [ ] **Step 4: Add the env var**

In `apps/auth-service/src/env.ts`, add to the schema alongside `SYNC_PUBLIC_URL` (follow the exact `optional(pipe(string(), url(), check(...)))` shape):

```ts
  ADMIN_PUBLIC_URL: optional(
    pipe(
      string(),
      url(),
      check((u) => u.startsWith('https://'), 'ADMIN_PUBLIC_URL must be an absolute https URL'),
    ),
  ),
```

Add to the resolved-env interface near `SYNC_PUBLIC_URL?: string;`:

```ts
  ADMIN_PUBLIC_URL?: string;
```

Add to the `process.env` mapping near `SYNC_PUBLIC_URL: process.env.SYNC_PUBLIC_URL,`:

```ts
    ADMIN_PUBLIC_URL: process.env.ADMIN_PUBLIC_URL,
```

- [ ] **Step 5: Emit it from the config route**

In `apps/auth-service/src/routes/config.ts`, widen the body type and add the admin block after the proxy/sync logic, before `return c.json(body)`:

```ts
    const body: { proxyUrl?: string; syncUrl?: string; adminUrl?: string; features: string[] } = {
      features,
    };
```

```ts
    if (env.ADMIN_PUBLIC_URL) {
      body.adminUrl = env.ADMIN_PUBLIC_URL;
      features.push('admin');
    }
```

Update the JSDoc's "proxy/sync URLs" phrasing to "proxy/sync/admin URLs" so the comment stays truthful.

- [ ] **Step 6: Document the env var**

In `apps/auth-service/.env.example`, next to `PROXY_PUBLIC_URL` / `SYNC_PUBLIC_URL`, add:

```
# Public URL of the admin-client, advertised via GET /api/v1/config so the
# user-client can offer admins an "Admin" launcher. Absolute https URL.
# Leave unset if you do not deploy the admin-client.
ADMIN_PUBLIC_URL=https://admin.chatsundere.example
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd apps/auth-service && bun test tests/unit/config.test.ts`
Expected: PASS (all config cases green).

- [ ] **Step 8: Gate + commit**

Run: `pnpm typecheck --force` (expect green) and `pnpm biome check apps/auth-service` (expect clean).

```bash
git add apps/auth-service/src/env.ts apps/auth-service/src/routes/config.ts \
  apps/auth-service/tests/setup.ts apps/auth-service/tests/unit/config.test.ts \
  apps/auth-service/.env.example
git commit -m "Advertise adminUrl via GET /api/v1/config

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 2: shared-types + ui-shared — carry `adminUrl` through the wire type and parser

**Files:**
- Modify: `packages/shared-types/src/config.ts` (`ServerConfig.adminUrl?`, `KnownServerFeature += 'admin'`)
- Modify: `packages/ui-shared/src/state/server-config.ts` (parse + pass `adminUrl`)
- Modify: `packages/ui-shared/tests/state/server-config.test.ts` (new cases)

**Interfaces:**
- Consumes: none (the wire shape emitted by Task 1, but this is a type/parser change, independent of the running server).
- Produces: `ServerConfig.adminUrl?: string`; `KnownServerFeature` includes `'admin'`; `parseServerConfig` returns `adminUrl` when present and acceptable, drops the whole response if it is a malformed/insecure URL.

- [ ] **Step 1: Add the failing parser tests**

In `packages/ui-shared/tests/state/server-config.test.ts`, add:

```ts
it('accepts and preserves a valid adminUrl', () => {
  const input = { adminUrl: 'https://admin.chatsundere.me', features: ['admin'] };
  expect(parseServerConfig(input)).toEqual(input);
});

it('accepts http adminUrl only for loopback', () => {
  expect(parseServerConfig({ adminUrl: 'http://localhost:5174', features: [] })).not.toBeNull();
  expect(parseServerConfig({ adminUrl: 'http://admin.chatsundere.me', features: [] })).toBeNull();
});

it('rejects a present-but-malformed adminUrl (whole response invalid)', () => {
  expect(parseServerConfig({ adminUrl: 'not a url', features: [] })).toBeNull();
});

it('tolerates a missing adminUrl', () => {
  const parsed = parseServerConfig({ proxyUrl: 'https://proxy.example', features: ['proxy'] });
  expect(parsed).not.toBeNull();
  expect(parsed?.adminUrl).toBeUndefined();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/ui-shared && pnpm vitest run tests/state/server-config.test.ts`
Expected: FAIL — `adminUrl` is stripped (unknown key tolerated by `looseObject` but not returned), so the "preserves a valid adminUrl" and loopback/malformed cases fail.

- [ ] **Step 3: Extend the wire type**

In `packages/shared-types/src/config.ts`:

```ts
export interface ServerConfig {
  proxyUrl?: string;
  syncUrl?: string;
  adminUrl?: string;
  /** Feature flags; servers may send strings this client does not know yet. */
  features: string[];
}

/** Feature flags the client understands today. */
export type KnownServerFeature = 'proxy' | 'sync' | 'blobs' | 'admin';
```

- [ ] **Step 4: Parse and pass `adminUrl`**

In `packages/ui-shared/src/state/server-config.ts`, add `adminUrl` to the schema and the returned object:

```ts
const ServerConfigSchema = v.looseObject({
  proxyUrl: v.optional(AcceptableUrl),
  syncUrl: v.optional(AcceptableUrl),
  adminUrl: v.optional(AcceptableUrl),
  features: v.array(v.string()),
});
```

```ts
  const { proxyUrl, syncUrl, adminUrl, features } = result.output;
  return {
    ...(proxyUrl === undefined ? {} : { proxyUrl }),
    ...(syncUrl === undefined ? {} : { syncUrl }),
    ...(adminUrl === undefined ? {} : { adminUrl }),
    features,
  };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/ui-shared && pnpm vitest run tests/state/server-config.test.ts`
Expected: PASS.

- [ ] **Step 6: Rebuild the changed packages (downstream consumers read from dist)**

Run: `pnpm --filter @chatsundere/shared-types --filter @chatsundere/ui-shared run build`
Expected: both build. (Stale `dist/` otherwise causes phantom tsc errors for the new field in later tasks.)

- [ ] **Step 7: Gate + commit**

Run: `pnpm typecheck --force` (green) and `pnpm biome check packages/shared-types packages/ui-shared` (clean).

```bash
git add packages/shared-types/src/config.ts packages/ui-shared/src/state/server-config.ts \
  packages/ui-shared/tests/state/server-config.test.ts
git commit -m "Carry adminUrl through ServerConfig and the discovery parser

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 3: user-client — admin-tile gating helpers (pure, unit-tested)

**Files:**
- Create: `apps/user-client/src/routes/app/account/admin-tile.ts`
- Create: `apps/user-client/tests/routes/account-admin-tile.test.ts`

**Interfaces:**
- Consumes: role type from `useAccountLinkStore` (`'primary_admin' | 'admin' | 'user' | null`); `ServerConfig.adminUrl` from Task 2.
- Produces:
  - `adminLaunchUrl(role, adminUrl): string | null` — the admin-client URL when the user is an admin AND a URL is configured, else `null`.
  - `SECURITY_TILE_LABEL: string` — the merged sign-in-security tile label (Task 5 consumes it).
  - `openAdminConsole(url: string): void` — opens the URL in a new tab with `noopener,noreferrer`.

- [ ] **Step 1: Write the failing tests**

Create `apps/user-client/tests/routes/account-admin-tile.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SECURITY_TILE_LABEL,
  adminLaunchUrl,
  openAdminConsole,
} from '../../src/routes/app/account/admin-tile.js';

describe('adminLaunchUrl', () => {
  const url = 'https://admin.example';

  it('returns the URL for an admin when a URL is configured', () => {
    expect(adminLaunchUrl('admin', url)).toBe(url);
    expect(adminLaunchUrl('primary_admin', url)).toBe(url);
  });

  it('returns null for a non-admin regardless of URL', () => {
    expect(adminLaunchUrl('user', url)).toBeNull();
    expect(adminLaunchUrl(null, url)).toBeNull();
  });

  it('returns null for an admin when no URL is configured', () => {
    expect(adminLaunchUrl('admin', undefined)).toBeNull();
    expect(adminLaunchUrl('primary_admin', '')).toBeNull();
  });
});

describe('SECURITY_TILE_LABEL', () => {
  // Laura SOFT-1: both capabilities must stay legible on the tile face, or the
  // merge buries change-passphrase.
  it('names both passphrase and biometrics', () => {
    expect(SECURITY_TILE_LABEL).toMatch(/passphrase/i);
    expect(SECURITY_TILE_LABEL).toMatch(/biometrics/i);
  });
});

describe('openAdminConsole', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the URL in a new tab with noopener,noreferrer', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openAdminConsole('https://admin.example');
    expect(open).toHaveBeenCalledWith('https://admin.example', '_blank', 'noopener,noreferrer');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/user-client && pnpm vitest run tests/routes/account-admin-tile.test.ts`
Expected: FAIL — module `admin-tile.ts` does not exist.

- [ ] **Step 3: Write the helper module**

Create `apps/user-client/src/routes/app/account/admin-tile.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/** Role as carried by the account-link store (the linked backend's role). */
export type BackendRole = 'primary_admin' | 'admin' | 'user' | null;

/** The merged sign-in-security tile label. Must name both capabilities so the
 *  change-passphrase function is not buried behind the biometric hub (spec §5). */
export const SECURITY_TILE_LABEL = 'Passphrase & Biometrics';

/**
 * The admin-client URL to launch, or null when the Admin tile should not appear.
 * Shown only to admins on a backend that advertises an admin-client URL; a pure
 * launcher, never a privilege gate (the admin-client enforces roles server-side).
 */
export function adminLaunchUrl(role: BackendRole, adminUrl: string | undefined): string | null {
  if (role !== 'admin' && role !== 'primary_admin') return null;
  if (!adminUrl) return null;
  return adminUrl;
}

/** Opens the admin-client in a new tab, denying it a handle back to this window. */
export function openAdminConsole(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/user-client && pnpm vitest run tests/routes/account-admin-tile.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

Run: `pnpm typecheck --force` (green) and `pnpm biome check apps/user-client/src/routes/app/account/admin-tile.ts apps/user-client/tests/routes/account-admin-tile.test.ts` (clean).

```bash
git add apps/user-client/src/routes/app/account/admin-tile.ts \
  apps/user-client/tests/routes/account-admin-tile.test.ts
git commit -m "Add admin-tile gating helpers for the account dashboard

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 4: user-client — biometric screen becomes the "Passphrase & Biometrics" hub

**Files:**
- Modify: `apps/user-client/src/routes/app/account/biometric.tsx` (retitle crumb; add a Change-passphrase section)

**Interfaces:**
- Consumes: `useNavigate` (react-router-dom, already a dependency); route `/change-passphrase` (exists).
- Produces: a signposted Change-passphrase entry on the biometric hub; crumb reads "Passphrase & Biometrics".

This is an additive, safe-on-its-own change (it lands before Task 5 so that when the dashboard tile is merged, its destination already offers passphrase change).

- [ ] **Step 1: Retitle the breadcrumb**

In `apps/user-client/src/routes/app/account/biometric.tsx`, change the crumb (currently near line 218):

```tsx
      crumbs={[{ label: 'My Account', to: '/app/account' }, { label: 'Passphrase & Biometrics' }]}
```

- [ ] **Step 2: Ensure `useNavigate` is available**

Confirm the import at the top of the file includes `useNavigate` from `react-router-dom`; if not, add it, and inside the component add:

```tsx
  const navigate = useNavigate();
```

- [ ] **Step 3: Add the Change-passphrase section**

Inside the `loadState.kind === 'ready'` fragment, after the "Add biometric action" `<div className="space-y-2">…</div>` block (near line 354) and still inside the `<>…</>`, add:

```tsx
            {/* Change passphrase — the second half of sign-in security (spec §5). */}
            <div className="space-y-2 border-t border-aurora-700/20 pt-6">
              <p className="font-display text-base text-paper">Passphrase</p>
              <p className="text-sm text-paper-soft">
                Change the passphrase you use to unlock Chatsundere on this device.
              </p>
              <Button
                tone="primary"
                onClick={() => navigate('/change-passphrase')}
                className="w-full"
              >
                Change passphrase
              </Button>
            </div>
```

(`Button` is already imported in this file. British English copy, inline to match the file's existing literal strings.)

- [ ] **Step 4: Verify the hub renders and reaches the route (manual — UX surface)**

Run the dev stack (`./dev.sh`), open `/app/account/biometric`: the breadcrumb reads "Passphrase & Biometrics"; a "Passphrase" section appears below the biometric list with a working "Change passphrase" button that navigates to `/change-passphrase`. (Per CLAUDE.md §10, this UX surface is manually verified; the logic tests live in Task 3.)

- [ ] **Step 5: Gate + commit**

Run: `pnpm typecheck --force` (green) and `pnpm biome check apps/user-client/src/routes/app/account/biometric.tsx` (clean).

```bash
git add apps/user-client/src/routes/app/account/biometric.tsx
git commit -m "Fold change-passphrase into the biometric hub

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 5: user-client — reorganise the dashboard grid and add the gold Admin tile

**Files:**
- Modify: `apps/user-client/src/routes/app/account.tsx` (imports, role + config selectors, new grid, gold Admin tile, merged tile, removed tiles, Recovery Key re-colour)

**Interfaces:**
- Consumes: `adminLaunchUrl`, `SECURITY_TILE_LABEL`, `openAdminConsole` (Task 3); `useAccountLinkStore().role` (existing store); `useDiscoveryStore().config?.adminUrl` (Task 2 field).

- [ ] **Step 1: Add imports and selectors**

At the top of `apps/user-client/src/routes/app/account.tsx`, add the discovery store to the existing `@chatsundere/ui-shared` import and import the helpers and a `Shield` icon:

```tsx
import { useAccountLinkStore, useDiscoveryStore, useSessionStore } from '@chatsundere/ui-shared';
```

Add to the `lucide-react` import line: `ShieldCheck` (used for the Admin tile):

```tsx
import { Fingerprint, Info, KeyRound, Link2, LogOut, ShieldCheck, Trash2 } from 'lucide-react';
```

(`Lock` is removed from that import — the standalone Change-passphrase tile is gone.)

Add the helper import:

```tsx
import { SECURITY_TILE_LABEL, adminLaunchUrl, openAdminConsole } from './account/admin-tile.js';
```

Inside `AccountPage`, near the existing `linkStatus` selector, add:

```tsx
  const role = useAccountLinkStore((s) => s.role);
  const adminUrl = useDiscoveryStore((s) => s.config?.adminUrl);
  const adminHref = adminLaunchUrl(role, adminUrl);
```

- [ ] **Step 2: Replace the tile grid**

Replace the entire `{/* ── 2×3 Navigation matrix ─… */}` grid `<div>` (currently lines ~175–226) with the block below. The gold Admin tile is the **first child of the grid** with `wide`, so its `data-wide` rule (`grid-column: 1 / -1`, `index.css:4605`) spans it across the full first row — it must sit inside the grid, not in a separate `<div>`, for the span and the grid gap to apply:

```tsx
      {/* ── Navigation matrix — optional gold Admin row + 2×3 (spec §3/§4) ── */}
      <div className="grid grid-cols-2 gap-3 px-4 pb-8">
        {adminHref && (
          <NavTile
            colour="blue"
            gold
            wide
            icon={ShieldCheck}
            label="Admin"
            meta="opens the admin console"
            onActivate={() => openAdminConsole(adminHref)}
          />
        )}
        <NavTile
          colour="pink"
          icon={Fingerprint}
          label={SECURITY_TILE_LABEL}
          to="/app/account/biometric"
          meta="unlock & passphrase"
        />
        <NavTile
          colour="pink"
          icon={Trash2}
          label="Recently deleted"
          to="/app/account/recently-deleted"
          meta="restore or purge · 30 days"
        />
        <NavTile
          colour="blue"
          icon={Link2}
          label="Server linking"
          to="/app/account/server-linking"
          meta="sync & unlink devices"
        />
        <NavTile
          colour="blue"
          icon={Info}
          label="About"
          to="/app/account/about"
          meta="version, licence, privacy"
        />
        <NavTile
          colour="purple"
          icon={KeyRound}
          label="Recovery Key"
          to="/app/account/recovery"
          meta="your backup code"
        />
        <NavTile
          colour="purple"
          icon={LogOut}
          label="Logout"
          to="/app/account/logout"
          meta="sign out · delete data"
        />
      </div>
```

Note: `wide` on the gold tile spans both columns (`grid-column: 1 / -1`); it is the first grid child so it forms a full-width first row above the 2×3. The `gold` prop makes it the single gold element on the screen (NavTile's rule). When `adminHref` is null the tile is absent and the grid is a clean 2×3.

- [ ] **Step 3: Verify the helper tests and typecheck still pass**

Run: `cd apps/user-client && pnpm vitest run tests/routes/account-admin-tile.test.ts`
Expected: PASS (unchanged).
Run: `pnpm typecheck --force`
Expected: green (no unused imports — `Lock` removed; all icons used).

- [ ] **Step 4: Manual verification (UX surface — spec §11)**

Run `./dev.sh`. Confirm on `/app/account`:
- Regular user (linked, role `user`) and local-only user: no Admin tile; 2×3 grid with pink (Passphrase & Biometrics, Recently deleted), blue (Server linking, About), purple (Recovery Key, Logout).
- Admin/primary_admin on a backend with `ADMIN_PUBLIC_URL` set: gold full-width "Admin" tile at the top; tapping opens the admin-client in a new tab; the user-client tab is untouched.
- Admin on a backend without `ADMIN_PUBLIC_URL`: no Admin tile.
- "Passphrase & Biometrics" opens the biometric hub; Recovery Key sits bottom-left (purple), Logout bottom-right (purple).

- [ ] **Step 5: Gate + commit**

Run: `pnpm typecheck --force` (green) and `pnpm biome check apps/user-client/src/routes/app/account.tsx` (clean).

```bash
git add apps/user-client/src/routes/app/account.tsx
git commit -m "Reorganise the account dashboard and add the admin launcher

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Post-implementation (Liz, not a task for the worker)

- **Full gate:** `pnpm typecheck --force` (expect 14/14), user-client vitest (expect the 8 Node-localStorage baseline + the new admin-tile tests green), auth-service `bun test` (expect the pre-existing OPAQUE baseline unchanged + new config cases green), Biome clean.
- **Larissa** audits the Task 1 `auth-service` diff (config discovery of a non-secret URL on the public endpoint) before squash — CLAUDE.md §9.1.
- **Laura** pre-squash pass: verify the built dashboard honours the spec, carrying SOFT-1 forward as the concrete check that both "Passphrase" and "Biometrics" are legible on the merged tile face.
- **Squash** into feature units for `full-backend-transition` (Chris pushes). Suggested units: (1) "Advertise adminUrl via config" (Tasks 1–2), (2) "Add admin launcher and reorganise the account dashboard" (Tasks 3–5). Update `obsidian/STATUS-BACKEND.md`.

## Self-review notes

- **Spec coverage:** §3 layout → Task 5; §4 admin tile (visibility, activation, cue, role source) → Tasks 3+5; §5 merge → Tasks 4+5; §6 backend discovery → Tasks 1–2; §8 tests → Tasks 1–3 (gating + legibility + config emit/omit + parser); §9 gates → Post-implementation. §4.2 hidden-not-disabled is inherent to `adminLaunchUrl` returning `null` (tile simply not rendered).
- **Deviation from spec §7:** the tile labels/meta are inline literals (matching the existing NavTile pattern in `account.tsx`), so `copy.ts` is not touched — the spec's "new strings" are realised inline. The biometric section copy is likewise inline, matching that file's convention.
- **Type consistency:** `adminLaunchUrl(role, adminUrl)` / `openAdminConsole(url)` / `SECURITY_TILE_LABEL` are used with identical signatures in Task 3 (defined), Task 5 (consumed). `ServerConfig.adminUrl` defined in Task 2, consumed in Task 5 via the store selector.
