# Username uniqueness across the server-link boundary — design

**Date:** 2026-07-06
**Author:** Liz (with Chris)
**Branch target:** `full-backend-transition`
**Status:** Draft v2 — Laura spec-pass v1 found 2 HARD defects (both verified,
both fixed); Laura re-pass v2 clean (no HARD, 4 SOFT folded/accepted).
Awaiting Chris approval to build.

## 1. Problem

Two defects, one root cause: the client does not enforce username uniqueness
across the local ↔ server boundary. Both surfaced during Chris's multi-device
test (two browsers, same local username, one already linked).

### 1.1 Defect A — late-link username conflict is silent

When a device that already holds a **local** account (username X) links
*late* to a server where X is already taken, the server returns
`409 username_taken` (`apps/auth-service/src/routes/join.ts:407`), which
`linkToServer` correctly re-throws as `CryptoError('conflict')`
(`packages/crypto/src/flows/link-to-server.ts:88`). The confirm screen maps it
to a `username_inline` error and calls `setUsernameError(...)`
(`apps/user-client/src/routes/onboarding/invitation/confirm.tsx:232`).

**But** the username input is only rendered when `!isLateLink`
(`confirm.tsx:359`). In the late-link path there is no field, so the message is
set to state that is never displayed. The user sees the screen silently return
to `ready`; only the server log shows the 409.

### 1.2 Defect B — "My Account" rename is local-only, even when linked

`account.tsx:106` calls `changeUsername({ db, newUsername })` **without**
`serverPatch`. The `changeUsername` flow was explicitly designed to take a
`serverPatch` ("Required when linked. Should call PATCH /v1/me; throw on 409" —
`packages/crypto/src/flows/change-username.ts:11`), but the caller never
provides it. Consequences for a **linked** account:

1. **Uniqueness bypass.** Renaming to a name already taken on the server is
   accepted locally; the server (`me.ts:87–91`, PostgreSQL unique constraint →
   409) is never consulted. Local `local_account.username` and server
   `users.username` diverge.
2. **OPAQUE online login breakage.** `login-online-linked.ts:86` sends
   `local.username` as the OPAQUE client identifier. After a local rename the
   client sends the *new* name to the server, whose record is under the *old*
   name → login failure, or in the worst case a collision with a *different*
   user who owns that name.
3. **Admin/authority mismatch.** The admin console shows the server truth (old
   name); the local UI shows the new name. The local display lies.

Note (not a defect): a local rename does **not** brick MK unwrap. `login-local.ts`
decrypts with the **stored** AAD (`row.wrapped_mk_local_aad`), not one re-derived
from the current username. So no re-wrap of the MK is required by this change.

## 2. Decisions (settled with Chris, 2026-07-06)

- **B — rename behaviour:** *server-first, offline refuse.*
  - **Linked:** wire `serverPatch` → `PATCH /api/v1/me`. Server checks
    uniqueness first; on `200` write local; on `409` surface a visible inline
    conflict message and leave local unchanged; on offline / 5xx **refuse** the
    rename with a constructive message and leave local unchanged (a
    sync-critical edit — both sides commit together or neither does).
  - **Not linked:** unchanged — local-only rename, no server call.
- **A — late-link conflict remedy:** *rename-and-retry inline* (revised after
  Laura HARD #1 — see §2.1). On conflict the screen reveals an editable username
  field pre-filled with the current local username; submitting renames the local
  account and retries the link. Pairing is **not** offered — it structurally
  refuses any device that holds a local account (the exact users who reach this
  screen). This productises the manual workaround Chris used (chris → chris2 →
  link) and covers same-user and foreign-user cases uniformly: pick a free name.
- **Scope:** both together, one feature unit.

### 2.1 Laura spec-pass v1 — HARD defects folded

- **HARD #1 (invalidated the original A):** routing the conflict CTA to
  `/onboarding/pairing` is a guaranteed dead-end. `finishJoinByPairing` throws
  `CryptoError('conflict')` whenever a `local_account` row exists
  (`join-by-pairing.ts:151-157`; contract: "fresh PWA instances only … wipe the
  origin before re-pairing"), which `pairing/confirm.tsx:319` maps to a fatal
  "A local account already exists on this device." A late-link user *always*
  holds a local account. Remedy: rename-and-retry (§2 A, §3.5), no pairing CTA.
- **HARD #2:** `InlineEditRow` discards the thrown error
  (`InlineEditRow.tsx:63`: `catch { setError('Could not save. Please try
  again.') }`), so every §4 rename message would collapse to the generic string
  — and "try again" on a 409 is active misdirection. Remedy: surface the thrown
  `Error.message` (§3.3a). This also unswallows the existing `usernameInvalid`
  throw at `account.tsx:110`.

## 3. Changes

### 3.1 shared-types (MIT)
- Add wire types for the rename endpoint: `PatchMeRequest = { username: string }`
  and `PatchMeResponse = { ok: true }` (mirror the auth-service `patchMeReq`
  schema and the `{ ok: true }` return in `me.ts`).

### 3.2 packages/crypto (LGPL — Larissa path)
- Extend the `ServerClient` interface with
  `patchMe(req: PatchMeRequest, baseUrl: string, accessToken: string): Promise<void>`
  (accessToken kept in the signature for parity with the other authed methods;
  the HTTP adapter uses bearer auth-mode as `deleteMe` does).
- No change to `changeUsername` itself — it already runs `serverPatch`
  server-first before the local write. Add/confirm a unit test that a throwing
  `serverPatch` leaves IndexedDB unchanged.

### 3.3a user-client — InlineEditRow surfaces the thrown message (Laura HARD #2)
- `account/InlineEditRow.tsx`: the `commit` catch currently discards the error.
  Change it to surface the thrown `Error.message`, falling back to the generic
  "Could not save. Please try again." when the message is empty. Shared by the
  username and display-name fields; a general, honest improvement. Without this,
  every §4 rename message is invisible.

### 3.3 user-client — HTTP adapter
- `lib/server-client.ts`: implement `patchMe` as
  `apiFetch({ baseUrl, path: '/api/v1/me', method: 'PATCH', body: req, authMode: 'bearer' })`
  (mirrors `deleteMe`). `apiFetch` already surfaces `.status` / `.code` on the
  thrown `HttpError`.

### 3.4 user-client — My Account rename wiring (Defect B)
- `account.tsx:handleSaveUsername`: when the account is **linked**
  (`useAccountLinkStore` link status), pass a `serverPatch` that calls
  `httpServerClient.patchMe({ username: next }, baseUrl)` where `baseUrl` comes
  from the linked-account row / account-link store.
- Error mapping in the rename UI (`InlineEditRow` surfaces a thrown `Error`):
  - `HttpError` 409 `username_taken` → "That username is already taken on this
    server. Choose another." (input preserved, stays editable).
  - offline / status 0 / ≥500 → "Couldn't reach the server, so your name wasn't
    changed. Try again when you're back online." (local unchanged).
  - `CryptoError('invalid_input')` → existing `copy.errors.usernameInvalid`.

### 3.5 user-client — late-link conflict: rename-and-retry (Defect A, revised)
- `confirm.tsx`: introduce a late-link "choose a different name" mode (a boolean
  state, e.g. `latelinkRename`). It is entered when a **late-link** submit fails
  with `CryptoError('conflict')` / `HttpError username_taken`.
- **Critical wiring (Laura SOFT #3 — do not reinstate v1 HARD #1):** the FIRST
  late-link conflict must *enter rename mode* — i.e. reveal the field — not
  merely `setUsernameError` and return to `ready` (the field is still gated at
  `confirm.tsx:359`, so an unrevealed error lands in a hidden field). The catch
  must set `latelinkRename` before/alongside the inline error. A test asserts
  the field becomes visible on the first late-link conflict (§6).
- On entering the mode: reveal the username field in the late-link path (today
  gated `!isLateLink` at `confirm.tsx:359`), pre-filled with the current local
  username, with a heading + explanation that the name is taken here and they
  should pick a different one to join. Auto-focus and select the pre-filled text
  (Laura SOFT #4) so an unchanged resubmit isn't the default.
- Submit while in the mode:
  1. If the entered name differs from the current local username, call
     `changeUsername({ db, newUsername })` — **local-only, no `serverPatch`**:
     the device is not yet linked, so a local rename is correct and the link
     attempt itself is the uniqueness check. (`linkToServer` reads the username
     from the local account, so no other threading is needed.)
  2. Retry `linkToServer` exactly as the normal late-link branch does.
- A repeated conflict now maps to `username_inline` and renders on the (now
  present) field — input preserved, editable. `CryptoError('invalid_input')`
  from `changeUsername` likewise renders inline on the field.
- Back link → `/onboarding/invitation`. No pairing CTA (see §2.1 HARD #1).
- Fresh-PWA path unchanged (username field always present; `username_inline`
  already correct there).

## 4. Copy (British English, dere-constructive)

- **Late-link conflict (A) — rename-and-retry:** (final wording Chris's call —
  Laura SOFT #1: make the separate-account outcome explicit, avoid implying a
  merge into an existing same-name account)
  Heading — "That name's already taken here"
  Body — "«{username}» is already taken on {server}. Pick a different name to
  join under — you'll join as a new, separate account with that name."
  Field label — "Username" · Primary — "Join with this name" · Secondary — "Back"
  Repeated conflict (inline on field) — "That name's taken here too. Try
  another."
- **Rename conflict, linked (B, 409):** "That username is already taken on this
  server. Choose another."
- **Rename offline/server-down (B):** "Couldn't reach the server, so your name
  wasn't changed. Try again when you're back online."

## 5. Out of scope

- No pairing/merge into an existing same-user server account from a device that
  already holds local data (structurally needs a fresh device + origin wipe; the
  rename-and-retry path creates a separate account under a free name instead).
  Revisit only if testing shows users want a true merge here.
- No MK re-wrap on rename (AAD is stored, not re-derived — see §1.2 note).
- No change to server `me.ts` (already correct).
- **Consciously accepted (Laura SOFT #2 → `ux-deferrals`):** in rename-mode the
  local rename commits *before* the link retry, so a transient (non-conflict)
  link failure leaves the local account renamed while still unlinked. Judged
  benign: the user typed and submitted the new name themselves (not invisible),
  the field surfaces it, and a later retry links under that same chosen name.
  Not worth a `linkToServer` username-override parameter (a `packages/crypto`
  API widening) to make the rename post-link.

## 6. Tests

- crypto: `changeUsername` aborts local write when `serverPatch` throws
  (server-first guarantee). HTTP adapter `patchMe` shape.
- user-client — `InlineEditRow`: a thrown `Error` with a message renders that
  message; a thrown `Error` with empty message falls back to the generic string.
- user-client — `confirm.tsx`: the **first** late-link conflict reveals the
  username field (mode-entry — guards against reinstating v1 HARD #1);
  submitting a new name calls `changeUsername` (no `serverPatch`) then retries
  the link; a repeated conflict renders inline on the now-present field.
- user-client — `account.tsx`: passes `serverPatch` iff linked; a 409 surfaces
  the conflict copy and a network failure surfaces the offline copy, both via
  the (now message-surfacing) InlineEditRow; unlinked stays local-only.
- Gate: `pnpm typecheck --force`; user-client vitest at the 8 Node-localStorage
  baseline.

## 7. Manual verification (Chris, on the dev stack via `./dev.sh`)

1. Two browsers, same local username; link browser 1. In browser 2, late-link
   to the same server → the conflict now reveals an editable username field
   (not a silent return); entering a free name joins successfully; entering a
   still-taken name shows the inline "taken here too" error and lets you retry.
2. Linked account: My Account → rename to a name taken on the server → visible
   409 conflict copy, name unchanged locally and on the admin console.
3. Linked account: stop the backend, attempt a rename → offline refuse copy,
   name unchanged.
4. Linked account, free name: rename succeeds; admin console reflects the new
   name; passphrase re-login still works (OPAQUE identity consistent).
5. Unlinked local account: rename still works purely locally.
