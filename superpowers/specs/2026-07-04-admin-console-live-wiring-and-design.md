# Admin console: live wiring + retrofuturistic control-panel design

**Date:** 2026-07-04
**Status:** Approved by Chris (design walkthrough in session; visual reference approved)
**Target branch:** `full-backend-transition` (remote overnight run on its own `claude/` branch)
**Visual reference:** `.superpowers/brainstorm/1438625-1783201437/content/hybrid-reference.html` (untracked; the spec text below is the source of truth — §7 encodes everything the mockup shows)

## 1. Problem

The admin-client is a fully built UI wired to a stub data layer. `LiveAdminApi`
(`apps/admin-client/src/data/admin-api.live.ts`) throws `501 not_implemented` for
all 14 methods, and the default `hybrid` mode silently falls back to an in-memory
mock (18 fabricated users, 9 invitations, 56 audit events in
`src/data/mock-fixtures.ts`). Consequences:

- Every screen except login shows fabricated data.
- The audit screen shows nothing real even though the server has a complete,
  registered audit endpoint (`GET /api/v1/admin/audit-log`) writing 25 event types.
- Three type worlds disagree: the client's local types
  (`src/data/admin-api.ts`), `packages/shared-types/src/admin.ts`, and the
  actual auth-service responses. Known drift: shared-types declares
  `token`/`qr_payload` on invitation-create, the server returns `code`/`qr_url`.
- Styling is wireframe-level: Catppuccin variables exist but there is no design
  language.

Two server-side defects surfaced during verification and are folded in:

- `GET /api/v1/admin/users` returns `total: rows.length` — the **page** length,
  not the filtered count. Pagination breaks beyond one page
  (`apps/auth-service/src/routes/admin/users.ts:48`).
- `GET /api/v1/admin/audit-log` orders `created_at` **ascending** — an audit
  view wants newest first (`apps/auth-service/src/routes/admin/audit.ts:51`).

## 2. Goals

1. Every admin screen shows real data from auth-service; the mock layer is
   deleted entirely.
2. The audit screen works, with usernames, category badges, filters, and
   pagination.
3. One canonical set of admin wire types in `packages/shared-types`, matching
   the server exactly.
4. Three ready-but-unwired functions land: invitation `suggested_username` +
   `note` form fields, change-role, transfer-primary.
5. The admin-client becomes a "retrofuturistic control panel": cassette-futurism
   base, CRT accents, a synthwave dose on the login screen. Catppuccin Mocha,
   dark-only.

## 3. Non-goals

- No silent token refresh in the admin-client (existing decision: on 401 the
  route guard redirects to login).
- No new server endpoints. Only the two defect fixes plus additive fields/filters
  on existing endpoints (§5).
- No revocation of still-valid access tokens after a role change or
  primary-transfer (pre-existing server behaviour; see §10 security notes).
- No mobile-first commitment. The console must be *usable* at 380 px (panels
  stack, tables scroll horizontally) but is optimised for desktop — a conscious,
  documented divergence from the user-client rule, consistent with the existing
  admin-styling carve-out in CLAUDE.md §11.
- No Laura audit: the admin console is a small, conventional CRUD surface
  without the user-client's mobile-UI integration depth (Chris's call,
  2026-07-04).

## 4. Feature units (squash granularity)

Two squashed commits, built in this order:

1. **"Wire admin-client to live backend"** — shared-types unification,
   auth-service fixes + enrichment, live data layer, mock deletion, the three
   scope extras. This is the Larissa-relevant unit (touches
   `apps/auth-service`).
2. **"Restyle admin console as retrofuturistic control panel"** — design system
   + restyling of all screens. Purely visual; no Larissa path.

Keeping the security-relevant diff free of styling noise is deliberate.

## 5. Server changes (auth-service — Larissa gate)

### 5.1 `GET /api/v1/admin/audit-log`

- Add two **additive** fields to every entry via two `LEFT JOIN`s on `users`:
  `user_username: string | null`, `actor_username: string | null`. `null` when
  the referenced user is deleted or the id column is null.
- Change ordering to `created_at DESC` (newest first). Deliberate behaviour
  change; the endpoint has no consumers yet.
- Everything else (filters `event_type`, `user_id`, `since`, `until`,
  pagination, `{ entries, total }` envelope) stays byte-identical.

### 5.2 `GET /api/v1/admin/users`

- Fix `total` to a real filtered `COUNT(*)` (run in parallel with the page
  fetch, mirroring the audit route's pattern).
- Add optional additive filters: `role=user|admin|primary_admin` and
  `status=active|suspended` (`status=suspended` ⇔ `suspended_at IS NOT NULL`).
  Combinable with the existing `q` substring filter.

### 5.3 Tests (Bun, auth-service)

- Audit: username join present; deleted/absent user yields `null` username;
  DESC ordering; existing filters unaffected.
- Users: `total` correct across pages with >1 page of users; each new filter
  alone and combined with `q`.

No other server file changes. `requireStepUp` tier 4 on invitation-create is
already live and already handled client-side (§6.4).

## 6. Client data layer (admin-client)

### 6.1 Canonical types in shared-types

`packages/shared-types/src/admin.ts` becomes the single wire truth (MIT-licensed
package; types only):

- `AdminAuditLogEntry` gains `user_username: string | null` and
  `actor_username: string | null`.
- `AdminCreateInvitationRequest` gains `suggested_username?: string` and
  `note?: string`.
- `AdminCreateInvitationResponse` is **corrected** to the server's actual shape:
  `{ invitation_id, code, qr_url, expires_at, state: 'active' }`.
- New `AdminInvitationSummary` matching the list route verbatim:
  `{ id, role, issuer_label, suggested_username, note, created_by, created_at,
  expires_at, redeemed_at, redeemed_by_user_id, revoked_at, attempt_count,
  status }` with `status: 'pending' | 'redeemed' | 'revoked' | 'expired'`; and
  `AdminInvitationListResponse { invitations, total }`.
- New `AdminTransferPrimaryRequest { target_user_id: string }` and
  `AdminChangeRoleRequest { role: 'admin' | 'user' }`.
- Already-correct types (`AdminUserSummary`, `AdminUserDetail`,
  `AdminUserListResponse`, `AdminAuditLogResponse`) stay as they are.

The client adopts **server naming** (`created_at`, `suspended_at`,
`method_type`, `redeemed_by_user_id`). The client-local wire-type world in
`src/data/admin-api.ts` is deleted.

### 6.2 Flatten the data layer

The `AdminApi` interface existed to carry three implementations. With the mock
dead it is over-abstraction. Replace the class zoo with one module of typed
fetch functions (`src/data/api.ts`) that the react-query hooks call directly:

- `listUsers`, `getUser`, `suspendUser`, `unsuspendUser`, `deleteUser`,
  `changeRole`, `transferPrimary`, `listInvitations`, `createInvitation`,
  `revokeInvitation`, `listAudit`, plus a composed `getDashboardSummary` (§6.5).
- All go through the existing `apiFetch` (bearer auth, step-up gate, error
  envelope) against `env.VITE_AUTH_URL`.
- Pagination translation lives here: UI `page`/`per_page` → wire
  `limit`/`offset`; responses are wrapped into the existing client-side
  `Paged<T>` view-model.

**Deleted files:** `admin-api.mock.ts`, `admin-api.hybrid.ts`,
`admin-api.live.ts`, `mock-fixtures.ts`, and the mode selector in
`data/index.ts`. `VITE_ADMIN_API_MODE` is removed from `env.ts`, `.env`,
`.env.example`, and any README mention.

**View-model types** (client-local, not wire): `Paged<T>`, the list-query
types, `AuditEventCategory`, and derived helpers move to `src/data/types.ts`
with a comment marking them presentation-side. `UserStatus`/`status` is derived
client-side from `suspended_at`. `is_last_primary_admin` is **derived**, not
fetched: the DB's partial unique index guarantees at most one `primary_admin`,
so the flag is simply `role === 'primary_admin'`.

### 6.3 Audit presentation

- **Category is a badge, not a server filter.** Derived from `event_type` by
  prefix, pinned as:
  - `auth.*`, `auth_method.*` → `auth`
  - `user.*` → `user-lifecycle`
  - `invitation.*`, `pairing_code.*` → `invitation-lifecycle`
  - `recovery_used` → `recovery`
  - `wrapping_invariant_violated`, `refresh_token.reuse_detected` → `security`
    (new category; rendered with red LED semantics)
  - `primary_admin.*` and anything unknown → `admin-action`
- The filter row offers: an **event-type dropdown** (entries grouped visually by
  category; single-select — the server filters by exact `event_type`), a user-id
  filter, and a from/to time range mapped to `since`/`until`. The previous
  category *filter* is dropped because the server cannot express
  one-category-many-event-types; the dropdown grouping preserves the mental
  model.
- Usernames render from `user_username`/`actor_username`; a null username with
  a non-null id renders the truncated id plus a "deleted" marker.
- Rows expand to show pretty-printed `metadata` JSON (monospace).

### 6.4 Invitations

- Create form gains `suggested_username` (optional, plain input) and `note`
  (optional, textarea) and sends `expires_in_seconds` (UI keeps its
  1/7/30-day choices; conversion in the data layer).
- The create response is **reveal-once**: the existing post-create reveal
  screen (`src/routes/invitations/reveal-screen.tsx`) is rewired from the
  mock's `qr_payload`/`url` fields to the server's `code`/`qr_url`. It shows
  the QR (rendered locally from `qr_url` via the `qrcode` dependency), the
  copyable URL, **and the bare 10-character code** for manual entry (the
  URL+code two-field UX from the cross-device spec), with copy stating they
  cannot be retrieved again — lose them, revoke and reissue.
- Tier-4 step-up on create is already handled generically by `apiFetch`
  (403 `step_up_required` → `requestStepUp` modal → single retry). The form
  must survive that round trip without losing input (it awaits one promise, so
  this is the default behaviour — the test in §9 pins it).
- List columns gain `suggested_username` and `note`.

### 6.5 Dashboard (composed client-side, no new endpoint)

`getDashboardSummary` composes existing endpoints via `Promise.all`:

- **01 · USERS** tile: `listUsers` with `per_page=1` → `total`. Subline:
  "N suspended" from `status=suspended` total (or "all active" when 0).
- **02 · INVITATIONS** tile: pending total from `status=pending`. Subline: the
  soonest `expires_at` among the first page (≤100) of pending invitations —
  a phase-0 approximation, acceptable while invitation counts are small.
- **03 · AUDIT** tile: events in the last 24 h (`since = now − 24 h` → `total`).
- **AUDIT FEED** panel: the 10 newest entries (server now orders DESC).

### 6.6 Change-role

- The permanently-disabled placeholder button
  (`src/routes/users/actions.tsx`) becomes real: `POST
  /api/v1/admin/users/:id/role` with `{ role }`.
- Visible to all admins, **enabled only for `primary_admin`** (disabled with an
  explanatory tooltip otherwise — disabled over hidden).
- On the operator's own row it stays disabled with tooltip "Use transfer-primary
  instead" (mirrors the server's 403).
- On success: invalidate the user queries.

### 6.7 Transfer-primary

- A dedicated section on the user-detail screen, rendered only when the session
  user is `primary_admin` **and** the viewed user's role is `admin` (the server
  rejects other targets).
- Typed-phrase confirmation: the operator types the target's username exactly
  (same pattern as the user-client decouple flow).
- Calls `POST /api/v1/admin/transfer-primary` with `{ target_user_id }`.
- On success the client **signs the operator out** with a constructive notice
  ("Primary role transferred to `<username>`. Sign in again — your session now
  carries the admin role."). Rationale: the in-memory access token still claims
  `primary_admin`; signing out is the honest state, and re-login is cheap.

### 6.8 Error handling (the *dere* half)

Every failure state names the next constructive step; forms never lose input:

- Backend unreachable / query error → an ALERT-styled panel with the error and
  a **Reconnect (retry)** action — never an eternal spinner (today's blank
  audit screen is exactly that bug).
- 403 on role actions → explanatory tooltip/notice, action stays visible.
- 401 → route guard redirects to login (existing behaviour, kept).
- Step-up declined → the triggering form keeps its input and shows "Step-up
  required to create invitations — try again when ready."

## 7. Design system: "control panel" (unit 2)

Direction locked with Chris on the visual reference: **cassette-futurism base
with CRT accents; the login screen gets the synthwave dose.** Catppuccin Mocha
only — the Latte light theme is removed (a control panel has no daytime mode).

### 7.1 Tokens & typography

- Extend the `@theme` block in `src/index.css` with the full Mocha ramp needed
  (base/mantle/crust/surface0-2/overlay/text/subtext + mauve, peach, teal,
  green, yellow, red, blue, sapphire, lavender) and remove the
  `prefers-color-scheme` Latte block.
- Fonts bundled via Fontsource (no CDN — self-hosting ethos):
  **Space Grotesk** (headings/labels; 400/500/700) and **JetBrains Mono**
  (all data: numbers, tables, feeds, chips; 400/700).
- Glow is budgeted: only stat-tile numbers, status LEDs, and the audit-feed
  prompt carry `text-shadow`/`box-shadow` glows. Body text never glows.

### 7.2 Component kit (small, no library)

- `Panel` — mantle background, `surface`-tone 1 px border, 8 px radius,
  optional header strip (crust background) with `StatusLed` + `SectionLabel`.
- `StatTile` — numbered `SectionLabel` ("01 · USERS"), 3 px accent top border
  (mauve/peach/teal per tile), large mono value with subtle glow, small
  subline.
- `SectionLabel` — 9–10 px, letter-spaced uppercase, subtext colour, numbered
  (`01 ·`) where sections are ordered.
- `StatusLed` — 6–9 px dot with matching glow; semantic: green = nominal,
  yellow = attention, red = alert. Only used where it means something.
- `ConsoleChip` — small mono chip (crust background, surface border) for
  ambient status: `SYS NOMINAL`, `chris · primary_admin`.
- `DataTable` — mono data cells, grotesk header labels, row hover in surface
  tone, horizontal scroll below its min-width.
- `SkeletonPanel` — loading states become skeleton panels (no "Loading…"
  strings anywhere).

### 7.3 CRT accents (exactly three, dosage is the point)

1. Audit-feed panel header: scanline overlay (repeating-linear-gradient) +
   mono prompt `> tail --live ▮` with phosphor-green glow.
2. Stat-tile numbers: the subtle glow from §7.1.
3. Status LEDs: the glow dot.

### 7.4 Login screen (the synthwave dose)

Gradient background (crust → a slightly violet-shifted mantle), a
perspective-transformed neon grid horizon at the bottom, the auth card with a
mauve neon border + outer glow, gradient wordmark "ADMIN CONSOLE"
(mauve → sapphire), mono sub-line "chatsundere · operator access", primary
button with mauve glow. The 5-branch login decision tree logic is untouched —
this is restyling only.

### 7.5 Screens

All routes restyled with the kit: login (§7.4), dashboard (header bar with LED
+ wordmark + `SYS NOMINAL` and operator chips; numbered nav tabs in mono;
three stat tiles; audit feed panel), users list, user detail (auth methods as
panel; actions incl. the new role/transfer sections), invitations (list +
create + reveal-once modal), audit (filter row, table, expandable metadata).
Buttons: filled mauve for primary; red outline for destructive (suspend/
delete/revoke — plus typed-phrase where already specced); everything else
quiet surface-tone outlines. Navigation may render as the numbered tab strip
from the reference; at ≤380 px panels stack single-column and tables scroll
horizontally.

## 8. Process artefacts

- **CLAUDE.md §11** line updated to: "Admin styling: Catppuccin Mocha
  retrofuturistic control panel — dark-only, functional first, flavour
  budgeted." (Keeps the admin/user contrast; records the revision.)
- **ADR** (next sequential number): "Retrofuturistic control-panel identity for
  the admin console" — captures the §11 revision, dark-only, and the
  desktop-optimised deviation, with the §3 rationale.
- **Larissa** audits unit 1 (auth-service diff + data-layer wiring) pre-squash.
  Laura is skipped (§3).
- **STATUS-BACKEND.md** updated at the end of the run.

## 9. Testing

- **auth-service (Bun):** §5.3.
- **admin-client (Vitest, structural not phrase-matching):**
  - pagination mapping (`page`/`per_page` ↔ `limit`/`offset`, `Paged` wrap);
  - category derivation table (§6.3) incl. unknown-type fallback;
  - `expires_in_days` → `expires_in_seconds` conversion;
  - dashboard composition (mocked fetch layer → tile values, incl. the
    24 h `since` computation);
  - status derivation from `suspended_at` and the derived
    `is_last_primary_admin`;
  - invitation form survives a step-up round trip with input intact;
  - existing tests under `tests/` keep passing (they may need updates for the
    flattened data layer — updating them is in scope, deleting them is not).
- **Gates:** repo-root `pnpm typecheck --force` (14/14), `pnpm run build`,
  Biome clean. No provider keys, no CI-side live calls.

## 10. Security notes (for Larissa's context)

- The audit enrichment adds usernames to an already-admin-gated endpoint; no
  new data class crosses a trust boundary (admins can already list users).
- Known, pre-existing, out of scope: after role change or transfer-primary the
  affected users' still-valid access tokens keep their old `role` claim until
  expiry; only suspension writes the deny-list. Logged in
  `obsidian/insights/follow-ups-index.md` as a candidate for a
  role-change-writes-deny-list hardening.
- The invitation `code` continues to exist only in the create response and the
  operator's screen; nothing new is persisted.
- No tokens in `localStorage` (unchanged); access token stays in memory.

## 11. Manual verification (Chris, dev stack)

Start with `./dev.sh`, admin at `http://localhost:5174/admin/`:

1. Log in with your real primary-admin account — dashboard shows **real**
   counts (cross-check user count against the users screen) and a live audit
   feed; your login appears as the newest feed entry.
2. Users: search, paginate (needs >20 users only for the pagination check —
   optional), open your own detail; suspend/unsuspend a test user and watch the
   audit feed record it.
3. Invitations: create one with a suggested username + note (step-up modal
   appears; complete it) — code + QR appear once; reload the list: both fields
   visible in the row, code gone forever. Revoke it.
4. Audit: filter by event type and by your user id; expand a row's metadata;
   usernames render (not bare ids).
5. Change-role on a test user (as primary_admin) — works; on yourself —
   disabled with the transfer hint.
6. Transfer-primary: open a (test) admin's detail, type the wrong username —
   confirm stays disabled; abort. (Full transfer optionally with a throwaway
   admin: after success you are signed out with the constructive notice, and
   signing back in shows the admin role.)
7. Kill the auth-service; any screen shows the reconnect panel, not a spinner;
   restart and Retry recovers.
8. Squint test: dark-only everywhere, glow only on numbers/LEDs/prompt, login
   has its synthwave moment at 380 px and desktop widths.
