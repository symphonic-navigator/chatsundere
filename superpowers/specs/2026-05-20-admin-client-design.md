# Admin-client design — Squash C

**Date:** 2026-05-20
**Status:** brainstorm complete, awaiting review before plan
**Implements:** `2026-05-18-foundational-auth-layer-design.md` §6 (Admin Client UI)
**Lead:** Liz (with Chris in walk-through mode)
**Out of scope:** auth-service admin endpoints (separate squash after Lyra briefs), Phase 1 features (sync, chat).

---

## 1. Purpose

Build the admin-client PWA — Catppuccin-themed operator console covering login, dashboard, users management, invitations, and audit log. Catalogued in the foundational-auth-layer spec as Squash C. Shares the same origin and IndexedDB as user-client; the operator's account is created via user-client onboarding, and admin-client reads the same rows.

Squash C is **frontend-only**. The admin-side auth-service endpoints (suspend/unsuspend/delete/role-change/transfer-primary/invitations/audit) are deliberately stubbed in this squash; live wiring happens in a later auth-service squash once Lyra's invitation-and-pairing briefs land.

---

## 2. Architecture

### 2.1 Layer cake

```
apps/admin-client/
├── src/
│   ├── routes/              App-level routes + AdminRouteGuard
│   ├── features/            One folder per feature (dashboard, users, invitations, audit)
│   ├── data/                AdminApi interface, mock + live implementations, switch
│   ├── lib/                 fetch wrapper, auth-gate hook, helpers
│   ├── copy.ts              British English UI strings
│   └── index.css            Catppuccin tokens (Mocha + Latte)
└── tests/                   unit + integration

packages/ui-shared/          ← NEW workspace package
├── src/
│   ├── components/          ConfirmTyped, InlineMarker, motion utilities
│   ├── login/               useOpaqueLoginFlow, usePasskeyLoginFlow, error→copy map
│   ├── state/               session-store, connectivity-store (moved from user-client)
│   └── index.ts             Barrel exports
```

### 2.2 Decisions captured during brainstorm

1. **Shared-components packaging — `packages/ui-shared` workspace package.** Threshold reached: login flow alone justifies more than per-app duplication; admin-client + user-client are the first two clients with more likely to follow (mobile-native shells, etc.).
2. **Endpoint strategy — stub-data + mock-API layer.** Squash C ships against in-memory fixtures; live wiring follows in a later auth-service squash. UI is built against the *intended* request/response shapes from spec §6 plus the planned shapes for invitation and pairing (Lyra brief outputs).
3. **Catppuccin theming — app-local in `apps/admin-client/src/index.css`.** No `packages/design-tokens` package — the Aurora (user-client) and Catppuccin (admin-client) palettes are deliberately decoupled per CLAUDE.md §11.
4. **Login flow — logic in `ui-shared`, JSX per app.** Hooks (`useOpaqueLoginFlow`, `usePasskeyLoginFlow`), state machines, and `CryptoError`-to-copy mapping are shared. Each app renders its own form components.
5. **session-store and connectivity-store — move to `ui-shared` now.** Both are needed by admin-client's AdminRouteGuard and login flow. Avoids duplication-then-merge cost; mechanical move.
6. **User detail — sub-route `/users/:id`.** Deep-linkable, browser-back works, split-layout on wide screens, stack on narrow.
7. **Sign-out button — yes, in admin-client top-bar.** Distinguished from auth-method management (which stays user-client-only per "single uniform flows").
8. **Mock-state — in-memory only, reload resets to fixtures.** Simplest implementation, predictable Manual-QA baseline. Persistent state would couple us to a stub-DB schema and complicate the live-endpoint migration.
9. **Larissa audit scope — self-target logic + ConfirmTyped flows only.** Audit H5 (primary-admin self-lockout defence-in-depth) and the user-delete confirmation flow are the only sensitivity-relevant code paths in this squash; the rest is conventional frontend.

### 2.3 Routing

```
/                       redirect → /login or /dashboard depending on session
/login                  Login screen (decision-tree per spec §6.2)
/dashboard              Counters + recent activity
/users                  List with filters + pagination
/users/:id              Detail panel (split layout)
/invitations            List + create modal
/audit                  Filtered audit-log
```

All non-`/login` routes wrapped by `<AdminRouteGuard>` (see §3.2).

---

## 3. Login and Role-Gate

### 3.1 Login decision tree (spec §6.2)

On entering `/login`, run the following in order; the first failing condition produces the matching message and stops:

| Step | Check | Failure outcome |
|---|---|---|
| 1 | `local_account` row exists in shared IndexedDB | "Set up a Chatsundere account in user-client first." + deep-link to `/` (user-client origin) |
| 2 | `linked_account` row exists | "Admin features require a server connection. Link your account in user-client first." + deep-link |
| 3 | Connectivity is online | "Admin-client requires an active server connection." (block, no offline mode per spec) |
| 4 | OPAQUE / passkey login succeeds | inline error from `CryptoError`/`HttpError` |
| 5 | `role` from `GET /v1/me` is `admin` or `primary_admin` | "Your account does not have admin permissions on this server." + link back to user-client |

If all five pass, navigate to `/dashboard`.

### 3.2 AdminRouteGuard

Component wrapping every non-`/login` route. Reads `session` from the `ui-shared` session-store. Behaviour:

- No access token in session → redirect to `/login`.
- `session.role` is `user` → redirect to `/login` with a banner ("Admin permissions required").
- A 401 surfaces from the API in flight → `closeAndForget()`, redirect to `/login`, banner ("Your session ended. Please sign in again.").

### 3.3 Self-target predicates

Two helpers in `lib/`:

```ts
function isSelfTarget(session: AdminSession, targetUserId: string): boolean
function isPrimaryAdmin(role: Role): boolean
```

Used by Users-detail action buttons to grey-out (with tooltip) actions the server would reject (suspend/delete/role-downgrade against self; transfer-primary unless current is primary_admin). Audit H5: defence-in-depth, server is the trust boundary, client mirrors.

### 3.4 Sign-out

Top-bar button. Clears session-store, redirects to `/login`. The shared IndexedDB rows (local_account, linked_account) are *not* touched — those are user-client's responsibility per "single uniform flows".

---

## 4. Data layer

### 4.1 AdminApi interface (`data/admin-api.ts`)

Wire-shape types live in `packages/shared-types` once Lyra's invitation brief lands; until then, defined locally with explicit `// TODO: move to shared-types when invitation brief settles` markers.

Shape:

```ts
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

### 4.2 Implementations

- **`admin-api.live.ts`** — real HTTP impl. Uses the new `joinUrl` helper, bearer auth via session-store. Implements `GET /v1/me` and login-related calls today; all other methods throw `HttpError(501, 'not_implemented')` so the hybrid composer can fall through to mock cleanly until the backend lands.
- **`admin-api.mock.ts`** — in-memory stub against `mock-fixtures.ts`. All mutations operate on a single in-memory object that resets on reload. Appends audit events on user-mutations for realism.
- **`admin-api.hybrid.ts`** — composes the two: routes login/me to live, admin endpoints to mock. The default in dev.

Switch via `VITE_ADMIN_API_MODE=mock|live|hybrid`. Phase 0 default: `hybrid`.

### 4.3 Stub fixtures (`data/mock-fixtures.ts`)

- 16-20 users (1 primary_admin, 1-2 admins, rest users; mix of active/suspended; one without `last_login_at` for empty-state coverage).
- 8-10 invitations (mix of pending/redeemed/expired/revoked).
- ~50 audit events spanning the last 30 days, covering: `user.linked`, `user.suspended`, `user.unsuspended`, `user.role_changed`, `user.deleted`, `invitation.created`, `invitation.redeemed`, `invitation.revoked`, `auth.refresh_reuse_detected`.

UUIDv7 throughout (consistent with the cross-device-identity decision from 2026-05-19).

---

## 5. Screens

### 5.1 Login

Identical decision tree to spec §6.2 (§3.1 above). UI: single-column form, Catppuccin Mocha by default, system-pref-aware. Sub-screens for the five failure states; primary screen for happy-path login.

### 5.2 Dashboard

Three count cards (total users, pending invitations, suspended users). Recent-activity panel below: last 10 audit events as a compact list (timestamp, event-type pill, actor → subject).

### 5.3 Users — list

Table with columns: username, role (primary_admin distinguished via pill), status (active/suspended pill), created-at (relative), last-login-at (relative or "Never").

Top controls: search input (username substring), role filter (all / user / admin / primary_admin), status filter (all / active / suspended), "Create invitation" button (opens modal). Pagination 20/page.

### 5.4 Users — detail (`/users/:id`)

Split layout on `lg+`: list on left, panel on right. Stack on narrow.

Panel contents: id, username, role, status, created-at, last-login-at, auth-methods list (label, type, last-used-at), recent audit events (last 10 for this user).

Actions:
- Suspend / Unsuspend (toggle button).
- Change role (form, primary_admin-only; greyed for others with tooltip).
- Transfer primary admin (primary_admin-only; target must already be admin).
- Delete user (ConfirmTyped: must type username exactly).

Self-target rows: all destructive actions greyed with tooltip "You cannot perform this action on your own account."

### 5.5 Invitations

Table: created-at, role, status pill (pending/redeemed/expired/revoked), redeemed-by (username if any), expires-at.

Top: status filter, "Create invitation" button.

**Create modal:**
- Role select (user / admin; primary_admin only available if no primary_admin exists — bootstrap case).
- Expires-in (default 7d; 1d, 7d, 30d).
- `issuer_label` (optional; defaults to server-provided instance name).
- On submit → **reveal screen**: QR code rendered from `qr_payload`, URL field, copy buttons, big warning "This is shown only once."
- Close → unrecoverable; only revoke + create-fresh.

**Revoke action** on pending rows.

### 5.6 Audit log

Table: timestamp, event_type pill, actor (username), subject (username if applicable), metadata-summary.

Filters: event-type select (auth, user-lifecycle, invitation-lifecycle, recovery, admin-action), user filter, date-range. Pagination 50/page.

Metadata cell: click → expands inline JSON viewer (collapsed by default).

### 5.7 Empty states (per spec §6.3)

- No users (bootstrap-admin only): "Just you so far. Create an invitation to add the next user." + button.
- No invitations: "No invitations yet. Create one to start onboarding people."
- Audit filter returns nothing: "No matching events. Try a wider time range."

---

## 6. Theming

Catppuccin Mocha (dark, default) and Latte (light) tokens defined in `apps/admin-client/src/index.css` as CSS custom properties under `@theme`. System-preference-respecting via `prefers-color-scheme`.

Token surface (minimum viable):

```
--cat-base       background
--cat-mantle     elevated background
--cat-crust      deeper background
--cat-text       primary text
--cat-subtext-0  secondary text
--cat-overlay-0  borders
--cat-mauve      primary accent
--cat-red        destructive
--cat-green      success/online
--cat-yellow     warning
```

Functional, not opulent: no breathing-orbs, no Instrument Serif, no organic-variation motion. Standard system sans-serif. Sober interaction states.

---

## 7. Tests

### 7.1 Unit (vitest)

- `data/admin-api.mock.test.ts` — fixture integrity; suspend/unsuspend toggle; create-invitation produces valid `qr_payload` and corresponding URL; audit events appended on user-mutations; pagination correctness.
- `lib/admin-route-guard.test.ts` — five decision-tree branches isolated.
- `lib/self-target.test.ts` — `isSelfTarget` and `isPrimaryAdmin` predicates.
- `features/users/list-filter.test.ts` — filter-reducer correctness.

### 7.2 Integration

- `tests/integration/login-decision-tree.test.tsx` — five spec §6.2 branches end-to-end.
- `tests/integration/invitation-create.test.tsx` — full create → reveal → close flow; verifying the token is unrecoverable after close.

### 7.3 Not auto-tested

- Catppuccin visual rendering (Manual QA).
- Router navigation across detail sub-route (integration tests touch it).
- QR-code rendering (library responsibility).

---

## 8. Larissa audit scope

Per CLAUDE.md §9, frontend changes skip the audit. Exception for this squash: two paths receive a focused audit before final-squash:

1. **Self-target predicates and Users-detail action gating** — audit H5 defence-in-depth.
2. **Delete-user ConfirmTyped flow** — irrecoverable action UX.

Both audits run on the diff slice only, not the whole squash. Findings recorded per the standard squash protocol; deferrals go into `obsidian/insights/security-deferrals.md`.

---

## 9. Manual QA checklist

To run after final-squash, on the actual deploy target (`localhost:5174/admin` paired with `localhost:5173/`):

1. `bun run --filter @chatsundere/auth-service bootstrap-admin` → emit file-path.
2. Open user-client at `localhost:5173/`, open the file, complete onboarding + linking.
3. Open `localhost:5174/admin` → land on `/login`.
4. Sign in with the bootstrap admin's passphrase → land on `/dashboard`.
5. Dashboard shows three counters, recent-activity shows the linking audit event.
6. `/users` lists the bootstrap admin; row shows `primary_admin`.
7. `/users/<id>` opens the detail; all destructive actions are greyed (self-target).
8. `/invitations` is empty. Open create-modal; create a `user` invitation expiring in 7d; reveal-screen shows QR + URL.
9. Close the reveal-screen; the entry shows status `pending`, no token visible anywhere.
10. `/audit` shows the `invitation.created` event.
11. Filter audit by event-type `invitation-lifecycle` → only that event remains.
12. Reload page → all mock state resets, only the live login + role-check survive.
13. Sign out → land on `/login`.
14. Re-login → land on `/dashboard`.
15. Toggle system colour scheme (light/dark) → Catppuccin Latte/Mocha respected.

---

## 10. Out of scope

- Live admin endpoints in auth-service.
- Audit-event-write side from admin-client (events come from the backend audit table once live).
- Invitation QR-pairing improvements (subject of Lyra brief, separate squash).
- Mobile-first responsive design for narrow viewports below 600 px (admin tool, operator UX).
- WebSocket-driven dashboard live updates (Phase 1+).
- Self-service auth-method management in admin-client (stays in user-client per "single uniform flows").

---

## 11. Manual verification — what Chris will check by hand

The §9 checklist *is* the manual verification. Pasted there to keep this single document complete.

---

## 12. References

- `superpowers/specs/2026-05-18-foundational-auth-layer-design.md` §6
- `SQUASH-C.md` (handoff brief from 2026-05-19 evening)
- `obsidian/insights/2026-05-19-brief-material-cross-device-identity.md` (informs invitation `qr_payload` shape)
- `obsidian/insights/2026-05-19-brief-material-passkey-uv.md` (informs future admin-side passkey decisions; not relevant in Squash C scope)
- `obsidian/insights/follow-ups-index.md` (master deferral index)
- CLAUDE.md §3 (hard rules) §6 (directory conventions) §7 (language) §9 (Larissa) §10 (quality) §11 (UX)
