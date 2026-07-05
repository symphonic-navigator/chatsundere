# My Account — Admin tile & dashboard reorganisation

**Date:** 2026-07-05
**Author:** Liz (with Chris)
**Branch:** `full-backend-transition`
**Status:** Draft — awaiting Chris review, then Laura spec-pass

---

## 1. Purpose

Two coupled changes to the My Account dashboard (`/app/account`):

1. Add a gold, full-width **Admin** launcher at the top of the tile grid, visible
   only to users who hold admin rights on their linked backend. It opens the
   admin-client in a new tab.
2. Tidy the tile grid so the colour grouping is coherent instead of arbitrary,
   by merging the two sign-in-security tiles into one and re-homing Recovery Key.

The dashboard is otherwise unchanged: the effective-name header, the two
inline-edit fields (username, display name), and the read-only badges all stay.

This lands as part of the Full Backend Transition (the admin-client overhaul and
the `GET /api/v1/config` discovery surface both exist already; this wires the
user-client to them).

---

## 2. Current state

The dashboard (`apps/user-client/src/routes/app/account.tsx`) renders a 2-column
grid of seven `NavTile`s, coloured without a consistent scheme:

| Tile | Colour | Destination |
|---|---|---|
| Biometric | pink | `/app/account/biometric` |
| Recovery Key | pink | `/app/account/recovery` |
| Recently deleted | pink | `/app/account/recently-deleted` |
| Server linking | blue | `/app/account/server-linking` |
| About | blue | `/app/account/about` |
| Change passphrase | purple | `/change-passphrase` |
| Logout | purple | `/app/account/logout` |

`NavTile` (`apps/user-client/src/components/ui/NavTile.tsx`) already supports the
two primitives we need: `gold` (priority overlay, one per screen) and `wide`
(span both columns), plus an `onActivate(el)` callback for tiles that do
something other than navigate.

Admin status is already available client-side: `useAccountLinkStore().role`
(`'primary_admin' | 'admin' | 'user' | null`,
`packages/ui-shared/src/state/account-link.store.ts`) is populated at boot from
the linked-account crypto row. Backend discovery is already available:
`useDiscoveryStore().config` (`packages/ui-shared/src/state/discovery.store.ts`)
holds the parsed `GET /api/v1/config` response.

---

## 3. Target layout

```
┌───────────────────────────────────────────────┐
│  ★  Admin            (gold, wide — admins only) │
└───────────────────────────────────────────────┘
┌──────────────────────┐ ┌──────────────────────┐
│ Passphrase &         │ │ Recently deleted     │   pink
│ Biometrics           │ │                      │
└──────────────────────┘ └──────────────────────┘
┌──────────────────────┐ ┌──────────────────────┐
│ Server linking       │ │ About                │   blue
└──────────────────────┘ └──────────────────────┘
┌──────────────────────┐ ┌──────────────────────┐
│ Recovery Key         │ │ Logout               │   purple
└──────────────────────┘ └──────────────────────┘
```

The colour grouping now reads as a scheme:

- **pink** — access to *this device* (unlock credentials, local trash).
- **blue** — the *server* relationship and app info.
- **purple** — *exit and emergency* (recovery, sign-out).

The Admin row, when present, is the single gold element on the screen (honouring
`NavTile`'s "exactly one gold per screen" rule).

| Tile | Colour | Destination | Notes |
|---|---|---|---|
| Admin | gold, wide | `config.adminUrl` (new tab) | admin-gated, see §4 |
| Passphrase & Biometrics | pink | `/app/account/biometric` | merged, see §5 |
| Recently deleted | pink | `/app/account/recently-deleted` | unchanged |
| Server linking | blue | `/app/account/server-linking` | unchanged |
| About | blue | `/app/account/about` | unchanged |
| Recovery Key | purple | `/app/account/recovery` | re-coloured pink → purple |
| Logout | purple | `/app/account/logout` | unchanged |

The standalone "Change passphrase" and "Biometric" tiles are removed; both are
reached through the merged "Passphrase & Biometrics" tile (§5).

---

## 4. The Admin tile

### 4.1 Visibility

The tile is rendered only when **both** hold:

- `useAccountLinkStore().role` is `'admin'` or `'primary_admin'`, **and**
- `useDiscoveryStore().config?.adminUrl` is a non-empty string.

A local-only user has `role === null` and no `config`, so the tile is absent —
correct, since there is no backend to administer. A regular user
(`role === 'user'`) never sees it.

### 4.2 Hidden, not disabled — the deliberate exception

CLAUDE.md §11 mandates "disabled over hidden": show every capability the user
*can* have, greyed out with a reason when unavailable. The Admin tile is the one
legitimate exception. "Disabled over hidden" protects capabilities a user could
plausibly obtain (a passkey they haven't set up yet, sync they could enable).
Admin rights are role-gated and granted out-of-band by the operator; a regular
user cannot self-serve them. Rendering a greyed-out "Admin" tile for everyone
would advertise the administrative surface to every account and mislead about
attainability. So for this tile, hidden-when-not-admin is the correct and
intended behaviour. (Recorded here so the Laura spec-pass reads it as a conscious
decision, not an oversight.)

### 4.3 Destination and activation

The tile carries no `to`. On activation it opens the admin-client in a new tab:

```ts
window.open(adminUrl, '_blank', 'noopener,noreferrer');
```

New tab, not same-tab navigation: the admin-client is a separate application
with its own login (a 5-branch decision tree); it does not share the
user-client's session. Keeping the user-client tab alive preserves any in-flight
chat/companion state. `noopener,noreferrer` denies the opened tab a handle back
to this window (standard hardening for `_blank`).

**External-hand-off cue** (Laura SOFT-2): every other tile on this screen
navigates in-app; this one leaves for a separate application. The tile's meta
line reads **"opens the admin console"** so the new tab is not a surprise
(principle of least astonishment). Text cue, not an icon — it stays within the
existing tile idiom (a label plus a calm meta line) rather than introducing a new
affordance vocabulary.

The tile uses `NavTile`'s `onActivate` path, which plays the gold trigger-blink
then invokes the callback (reduced-motion: immediate, no blink) — the same
affordance the rest of the grid uses.

### 4.4 Source of `role` — accepted staleness

`role` is read from the account-link store, which is seeded from the
linked-account crypto row written at link time. If the operator promotes a user
to admin *after* that device linked, the tile will not appear until a re-login or
re-link refreshes the row. This is accepted:

- The tile is a pure launcher. It grants no privilege; the admin-client enforces
  `minRole` server-side on every endpoint (`bearerAuth({ minRole })`). A stale
  view is a cosmetic inconvenience, never a security gap.
- The fresh alternative — decoding the `role` claim from the in-memory access
  token JWT — is more code for a rare edge case (admin promotion of an
  already-linked device).

If this proves annoying in practice, reading the JWT claim is a self-contained
follow-up; it is out of scope here.

---

## 5. Merging into "Passphrase & Biometrics"

The merged tile leads to the existing biometric screen
(`apps/user-client/src/routes/app/account/biometric.tsx`), which becomes the
sign-in-security hub:

- The tile is labelled **"Passphrase & Biometrics"** (plural "Biometrics" is a
  deliberate stylistic choice — Chris's call, in keeping with the cyberpunk
  theming pivot). **Both capabilities must stay legible on the tile face**, not
  demoted so that "Passphrase" becomes a faint meta line the eye skips — that
  legibility is what keeps the merge a consolidation rather than a burial of the
  change-passphrase function (Laura SOFT-1; it is an acceptance criterion, §8, not
  a styling detail).
- The biometric screen gains a **"Change passphrase"** section — a labelled
  entry that navigates to the existing `/change-passphrase` route. The route and
  its screen are unchanged; we only add a signposted way in from the hub.
- The screen's breadcrumb/heading changes from "Biometric" to
  "Passphrase & Biometrics".

`/change-passphrase` remains a first-class route (it may still be linked from
elsewhere, e.g. onboarding or a future flow); we are consolidating the
*dashboard entry points*, not deleting a route.

---

## 6. Backend: `adminUrl` discovery

`GET /api/v1/config` (`apps/auth-service/src/routes/config.ts`) gains an optional
`adminUrl`, following the exact pattern of `proxyUrl`/`syncUrl`: emitted only
when configured, with a matching feature flag.

- New env var `ADMIN_PUBLIC_URL` (`apps/auth-service/src/env.ts`), optional. When
  set, `config.adminUrl = env.ADMIN_PUBLIC_URL` and `'admin'` is pushed onto
  `features`.
- Documented in the auth-service `.env.example`, alongside `PROXY_PUBLIC_URL` /
  `SYNC_PUBLIC_URL`, with a realistic placeholder.

Wire types (`packages/shared-types/src/config.ts`):

```ts
export interface ServerConfig {
  proxyUrl?: string;
  syncUrl?: string;
  adminUrl?: string;   // new
  features: string[];
}
export type KnownServerFeature = 'proxy' | 'sync' | 'blobs' | 'admin';  // 'admin' new
```

Client parser (`packages/ui-shared/src/state/server-config.ts`):
`adminUrl` is validated by the existing `AcceptableUrl` check (https, or http
only for loopback) and passed through — the same guard proxy/sync URLs get, so a
misconfigured operator is caught loudly at probe time. An operator therefore
configures an **absolute** admin-client URL (a relative `/admin/` would fail
`new URL()` and be dropped — acceptable, since discovery is explicitly the chosen
mechanism over a relative link).

---

## 7. Touched files

**auth-service (Larissa path):**
- `apps/auth-service/src/env.ts` — add optional `ADMIN_PUBLIC_URL`.
- `apps/auth-service/src/routes/config.ts` — emit `adminUrl` + `'admin'` feature.
- `apps/auth-service/.env.example` (and any prod example) — document it.

**shared-types:**
- `packages/shared-types/src/config.ts` — `adminUrl?`, `'admin'` feature.

**ui-shared:**
- `packages/ui-shared/src/state/server-config.ts` — parse/pass `adminUrl`.

**user-client:**
- `apps/user-client/src/routes/app/account.tsx` — reorg grid, gold Admin tile
  with visibility gate + new-tab activation.
- `apps/user-client/src/routes/app/account/biometric.tsx` — add Change-passphrase
  section, retitle to "Passphrase & Biometrics".
- `apps/user-client/src/lib/copy.ts` — new strings (British English).

---

## 8. Testing

- **Backend (bun test):** `config.ts` emits `adminUrl` + `'admin'` when
  `ADMIN_PUBLIC_URL` is set, and omits both when it is not.
- **shared-types / ui-shared:** `parseServerConfig` accepts a valid `adminUrl`,
  drops an unacceptable one (non-loopback http), and tolerates its absence.
- **user-client (vitest):** the Admin tile renders only when
  `role ∈ {admin, primary_admin}` **and** `adminUrl` is present; is absent for
  `role === 'user'`, for `role === null` (local-only), and when `adminUrl` is
  missing even for an admin. Activation calls `window.open` with the discovered
  URL and `noopener,noreferrer`.
- **user-client (vitest) — merge legibility (Laura SOFT-1):** the merged tile
  renders both "Passphrase" and "Biometrics" as visible text on the tile face
  (guards against a future relabel silently burying change-passphrase).

---

## 9. Audit gates

- **Larissa** — `apps/auth-service/**` is a mandatory path (CLAUDE.md §9.1). The
  diff is small (a non-secret URL field on an already-public, unauthenticated
  endpoint; no auth or crypto logic), but the rule names the path, so she runs
  before squash.
- **Laura** — this adds a new user-reachable function (Admin launch) and alters
  the reachability/grouping of existing tiles, so her spec-pass applies (CLAUDE.md
  §9.2). §4.2 pre-states the hidden-not-disabled decision for her.
  **Spec-pass outcome (2026-07-05): PASS — no hard defects, five soft notes.**
  Both flagged decisions (§4.2 hidden-not-disabled, the merge) confirmed sound.
  SOFT-1 (merge legibility) folded into §5 + §8 as an acceptance criterion; SOFT-2
  (external-hand-off cue) resolved with the "opens the admin console" meta line
  (§4.3, Chris's call). SOFT-3 (gold salience) and SOFT-4 (colour-bucket semantic
  stretches) are taste/design-language, noted not actioned; SOFT-5 (post-promotion
  staleness) already covered by §4.4/§10. SOFT-1 carries forward as a concrete
  check at Laura's pre-squash pass.

---

## 10. Out of scope

- Reading `role` from the access-token JWT for freshness (§4.4) — follow-up if
  needed.
- Any change to the admin-client itself, or to how it authenticates.
- Any change to `/change-passphrase`'s own screen or the recovery/logout screens.
- The effective-name header, inline-edit fields, and read-only badges.

---

## 11. Manual verification (Chris, on device)

1. As a **regular user** (linked, `role === 'user'`): no Admin tile; grid is the
   2×3 layout with the new colour grouping.
2. As a **local-only user** (no backend): no Admin tile; same grid.
3. As an **admin/primary_admin** on a backend with `ADMIN_PUBLIC_URL` set: the
   gold full-width Admin tile appears at the top; tapping it opens the
   admin-client in a new tab; the user-client tab is untouched.
4. As an admin on a backend **without** `ADMIN_PUBLIC_URL`: no Admin tile (no URL
   to launch).
5. "Passphrase & Biometrics" opens the biometric hub; the Change-passphrase
   section reaches `/change-passphrase`; the breadcrumb reads
   "Passphrase & Biometrics".
6. Recovery Key sits bottom-left in purple; Logout bottom-right in purple.
```
