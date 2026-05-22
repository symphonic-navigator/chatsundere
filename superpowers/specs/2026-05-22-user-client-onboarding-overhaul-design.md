# User-client onboarding overhaul — design spec

**Date:** 2026-05-22
**Status:** brainstorm complete, awaiting Chris review before plan
**Implements:** the user-client side of [`obsidian/briefs/phase 0/cross-device-identity.md`](../../obsidian/briefs/phase%200/cross-device-identity.md), targeting the endpoints defined in [`superpowers/specs/2026-05-22-cross-device-identity-api-shapes-design.md`](2026-05-22-cross-device-identity-api-shapes-design.md). Replaces the now-broken `linkOpaqueStart` / `linkOpaqueFinish` wiring in `apps/user-client/src/lib/server-client.ts`.
**Related ADRs:** ADR 0005 (PRF), ADR 0007 (recovery key required at registration), ADR 0021 (OPAQUE-first linking), ADR 0024 (single-server-per-account), ADR 0025 (UUIDv7), ADR 0028 (unified two-round join flow)
**Lead:** Liz, with Chris in walk-through mode
**Out of scope:** Phase-1 sync-service merge on pairing-with-local-data (see § 9 for the Phase-0 accepted-data-loss decision), styling treatment (Chris brings a separate cyberpunk-flavoured concept later), client-side step-up modal (separate spec for `<StepUpModal />` and the 401 interceptor — covers admin-client Tier 4 wire-up too).

---

## 1. Purpose

The user-client currently has a single-action onboarding entry (`/onboarding` with a primary "Create account" CTA and a disabled "Load existing account" stub) and a separate linking flow (`/linking/{scan,paste,confirm}`) reachable from Settings. The linking flow's OPAQUE wiring points at the deleted `/v1/link/opaque/*` endpoints and is intentionally broken after the cross-device-identity Squash β.

This spec replaces the onboarding entry with a **four-path intent-based matrix** that absorbs both first-device and additional-device journeys, plus a Recovery-from-scratch path that was previously inaccessible without an existing local account. The linking surface in Settings becomes a thin pointer into the same overhauled screens — one flow, two entry points.

The spec also folds in a small auth-service change: the pending-code alphabet migrates from RFC-4648-§6-minus-confusables to a Crockford-derived alphabet with a deliberate `V`↔`U` swap (§ 2 Decision 8). This pairs with a client-side input normaliser so users who type a `0`, an `O`, an `L`, or a `V` get the result they expect rather than a silent rejection.

---

## 2. Decisions captured during brainstorm

1. **Four top-level paths, not three.** The brief proposed three (Scan QR / Manual / Local-only). Recovery-from-scratch (lost-all-devices) is added as a fourth top-level path; without it, a user who lost every device but kept their recovery key has no entry point — that contradicts [ADR 0007](../../obsidian/decisions/0007-recovery-key-required-at-registration.md), which makes the recovery key the *only* path to reactivation.

2. **Root onboarding is a 2×2 fullscreen matrix sorted by intent, not by input modality.** Each cell carries a symbol and a short label. Cells are equal-weight (no primary). Cells: *I have an invitation*, *Add this device*, *Use a recovery key*, *Just this device*. Sub-screens of each path use scan **and** typing as input modes; the path itself fixes the user's intent (and therefore the OPAQUE round and downstream flow).

3. **Sub-screen for invitation and pairing is Variant C — form-first with scan as a visually separated alternative.** URL field + code field + "Continue" CTA (primary, disabled until both inputs validate); a clear structural break (horizontal rule, "OR" label) below the primary CTA; a secondary "Scan QR code" button with a camera icon. The button routes to a dedicated camera sub-route — camera never auto-starts on the form screen.

4. **Late-linking from Settings reuses `/onboarding/invitation`.** Settings → "Add server" routes directly to that screen. The confirm sub-screen detects existing local session and switches to "wrap existing MK" mode (no username field, no recovery-reveal); fresh-PWA visitors get the "fresh MK + recovery reveal" mode. Same component, one `mode` prop.

5. **Username collision (HTTP 409) reuses the confirm screen.** The username input that already exists on the confirm screen becomes the rename surface — the input value is preserved (so the user sees what they tried) and a red inline message appears beneath it. The user edits and re-submits. No separate rename route.

6. **Biometric setup is post-onboarding, not in-flow.** After successful onboarding (any path that ends in /app), the first /app launch shows an inline dismissable modal asking whether to add a server-passkey. Local-only users do not get this prompt — local biometric is reachable via Settings → Auth Methods (today's flow); a server-passkey only makes sense post-link.

7. **Local-data + pairing in Phase 0: accept data loss with a code comment, no UI warning.** Phase 0 has no sync-service; the UUIDv7-based merge ADR 0025 calls for cannot execute. Audience for this edge case in Phase 0 is two people (Chris + Liz) testing. The Phase-1 sync brief will make this case work transparently — same matrix card, same flow, no UX change. Until then a `// TODO(phase-1)` comment in `joinByPairing()` documents the accepted data loss.

8. **Crockford-derived Base32 alphabet with `V`↔`U` swap.** Replaces the current RFC-4648-§6-minus-confusables alphabet. Crockford excludes `I`, `L`, `O`, `U`; we keep `U` and exclude `V` instead. `V` is rarely word-essential in English and carries a real (if minor) visual confusability with `Y` on small monospace displays — adequate technical grounds for the swap. Practically, the swap re-admits `U` to the alphabet, undoing Crockford's anti-vulgarity exclusion. This is deliberate and aligned with Chatsundere's anti-censorship positioning ([[project_anti_censorship_stance]]). Final alphabet: `0123456789ABCDEFGHJKMNPQRSTUWXYZ` (32 chars; excluded: `I`, `L`, `O`, `V`). Client-side input normaliser maps `I` → `1`, `L` → `1`, `O` → `0`, `V` → `Y`. Code field accepts lowercase and uppercases on the fly. The server alphabet update is two constants in `apps/auth-service/src/codes/token.ts` (alphabet + regex). Larissa pass at the end of the squash audits both the alphabet swap and the user-client changes.

9. **kind_mismatch is constructive, not punitive.** If the user enters the wrong type of code on the wrong path (e.g., scans a pairing QR on the invitation screen), the server returns 400 `kind_mismatch` per the API-shapes spec § 4.7. The client renders inline copy ("This is a code from another device, not from an operator") plus a button "Add device instead →" that routes to `/onboarding/pairing` with the code pre-filled. Constructive error handling, no dead-ends.

10. **Reactive validation on the form screen.** "Continue" is disabled until both URL and code validate. URL must be a parseable URL with https://, http:// allowed for `localhost` / `127.0.0.1` (per ADR 0023). Code must match the 10-char two-group alphabet form (Decision 8). Invalid keystrokes are silently dropped from the code field; the URL field has no per-keystroke filtering (URLs are too varied).

11. **Paste-auto-split**. When the URL field receives a value matching `<base>/join#<CODE>`, the client extracts the fragment into the code field and trims the URL to its base. Implemented on `onChange` of the URL field, no separate handler for paste vs. type.

12. **Recovery key field is one input, not four.** Today's RFC-formatted recovery key (`XXXX-XXXX-XXXX-XXXX`) is entered into a single field with on-the-fly hyphen formatting. Paste from a password manager or a clipboard is friction-free; users don't have to "guess if they can paste across boxes". Single source of authoritative input.

---

## 3. Architecture

### 3.1 Route tree

```
/onboarding                         — 2×2 intent matrix (fullscreen)
├── /onboarding/invitation          — form (URL + code + scan button)
│   ├── /onboarding/invitation/scan       — camera
│   ├── /onboarding/invitation/confirm    — server, role, username, passphrase
│   └── /onboarding/invitation/recovery   — mandatory key reveal (fresh-PWA only)
├── /onboarding/pairing             — form
│   ├── /onboarding/pairing/scan
│   └── /onboarding/pairing/confirm       — server, username (RO), passphrase
├── /onboarding/recovery            — single screen, all fields
└── /onboarding/local               — local-only wizard
    ├── /onboarding/local/username
    ├── /onboarding/local/passphrase
    └── /onboarding/local/recovery        — mandatory key reveal
```

The matrix at `/onboarding` is reachable **only** when no local session exists. With a local session, Gate (`routes/gate.tsx`) routes to `/app`. Settings → "Add server" routes directly to `/onboarding/invitation` and does not pass through the matrix.

`/create`, `/linking/scan`, `/linking/paste`, `/linking/confirm` are removed from the router. `/login`, `/login/recovery` are retained for the (logged-out-but-existing-local-account) passphrase login flow.

### 3.2 Packages and files touched

| Package | Files | Change |
|---|---|---|
| `apps/auth-service` | `src/codes/token.ts` | Alphabet swap (Crockford-derived with `V`↔`U`); regex update. |
| `apps/auth-service` | tests under `src/codes/` | Update fixtures and regex tests. |
| `apps/user-client` | `src/App.tsx` | Route tree above. |
| `apps/user-client` | `src/routes/onboarding/matrix.tsx` (new) | 2×2 matrix screen. |
| `apps/user-client` | `src/routes/onboarding/invitation/*.tsx` (new) | Form, scan, confirm, recovery-reveal sub-screens. |
| `apps/user-client` | `src/routes/onboarding/pairing/*.tsx` (new) | Form, scan, confirm sub-screens. |
| `apps/user-client` | `src/routes/onboarding/recovery.tsx` (new) | Single-screen recovery-from-scratch. |
| `apps/user-client` | `src/routes/onboarding/local/*.tsx` (new) | Wraps existing `create-account/step-*.tsx` components under new routes. |
| `apps/user-client` | `src/state/onboarding.store.ts` (new) | Discriminated-union store for the join sub-flows (matrix + local-only do not use this store — matrix is stateless, local-only uses existing wizard state). |
| `apps/user-client` | `src/lib/server-client.ts` | Replace `linkOpaqueStart/Finish` with `joinStart/joinFinish` (kind-aware); add `joinPasskey*` only if needed (see § 8.4 — currently no change). |
| `apps/user-client` | `src/lib/qr.ts` | New parser for the API-shapes `https://host/join#CODE` QR URL; existing `parseInvitationPayload` is removed. |
| `apps/user-client` | `src/lib/code-input.ts` (new) | Alphabet normaliser (I/L → 1, O → 0, V → Y, lowercase → uppercase); per-keystroke + paste handling; auto-hyphen formatter. |
| `apps/user-client` | `src/routes/settings/server-linking.tsx` | Becomes a thin redirect / one-click into `/onboarding/invitation`. |
| `apps/user-client` | `src/routes/create-account/*.tsx` | Moved/renamed under `/routes/onboarding/local/`; logic unchanged. |
| `packages/crypto` | `src/flows/join-by-invitation.ts` (new) | Fresh-MK invitation join. |
| `packages/crypto` | `src/flows/join-by-pairing.ts` (new) | Server-MK download via OPAQUE login round. |
| `packages/crypto` | `src/flows/recover-from-scratch.ts` (new) | Recovery-key-driven re-attach + new passphrase. |
| `packages/crypto` | `src/flows/link-to-server.ts` | Migrate from `/v1/link/opaque/*` to `/api/v1/join/{start,finish}` with `kind: 'invitation'`. Renamed if helpful; behaviour preserved for late-link semantics. |
| `packages/crypto` | `src/index.ts` | Add exports for the three new flows. |
| `packages/shared-types` | `src/cross-device.ts` (new or extend existing) | `JoinStartRequest` / `JoinStartResponse` / `JoinFinishRequest` / `JoinFinishResponse` as discriminated unions on `kind`; `JoinError` enum (`invalid_code_format`, `kind_mismatch`, `code_not_found_or_expired`, `username_taken`, `opaque_evidence_invalid`, `rate_limit_exceeded`, `wrapping_invariant_violated`, `session_expired`). |
| `apps/admin-client` | `src/routes/invitations/create.tsx` (or equivalent) | Add `suggested_username`, `issuer_label`, `note` fields. |

`packages/shared-types` types follow the API-shapes spec § 4 exactly.

### 3.3 State management

A single `useOnboardingStore` (Zustand) holds the join sub-flow state as a discriminated union:

```ts
type OnboardingState =
  | { kind: 'idle' }
  | { kind: 'invitation_input',    baseUrl: string, code: string }
  | { kind: 'invitation_confirm',  sessionId: string, baseUrl: string,
                                   code: string, suggestedUsername: string | null,
                                   registrationResponse: string }
  | { kind: 'invitation_recovery', userId: string, username: string,
                                   recoveryKeyString: string }
  | { kind: 'pairing_input',       baseUrl: string, code: string }
  | { kind: 'pairing_confirm',     sessionId: string, baseUrl: string,
                                   code: string, username: string,
                                   loginResponse: string }
  | { kind: 'success',             userId: string };
```

Recovery-from-scratch is single-screen; transitions happen inside the component and write the session on completion. Local-only path uses the existing in-component step state (`useState<1|2|3>(1)` in `create-account/index.tsx`), now mounted at `/onboarding/local`.

The store clears on `setSession()` success and on the matrix screen `useEffect` mount (defence against stale state from an interrupted previous attempt).

### 3.4 Data flow per path

The four paths share the shape "enter info → server call → screen transition" but differ in their crypto and persistence side-effects. Detailed walkthrough in § 4.

---

## 4. Path-by-path mechanics

### 4.1 Invitation (fresh-PWA)

1. Matrix tap *I have an invitation* → `/onboarding/invitation`.
2. User enters URL + code, or taps "Scan QR code" → `/onboarding/invitation/scan` → on hit, code is parsed via `parseJoinUrl()`, URL + code populate the store, navigate back to `/onboarding/invitation/confirm`.
3. On "Continue" from the form, `joinByInvitation.startRound()`:
   - Generates fresh OPAQUE registration request (no username yet — username is sent at /finish per API-shapes spec § 4.7).
   - `POST /api/v1/join/start` with `kind: 'invitation'`, `code`, `registration_request`.
   - On 200: store `session_id`, `registration_response`, `suggested_username`; navigate to `/onboarding/invitation/confirm`.
   - On error: see § 5 error table.
4. Confirm screen renders server URL (read-only), username (editable, pre-filled with `suggested_username` or empty), passphrase field, and reassurance copy ("Your data is encrypted with a key derived from your passphrase. The server cannot read it."). Role is not exposed at /start (per API-shapes spec § 4.7); the server returns it at /finish and the client uses it for in-app routing but does not display it on confirm.
5. On "Continue" from confirm, `joinByInvitation.finishRound()`:
   - Generates a fresh master key (32 random bytes).
   - Generates a fresh recovery key (per ADR 0007).
   - Derives the OPAQUE export-key from the registration record; wraps the master key with it (`wrapped_mk_opaque`, nonce, AAD).
   - Derives a recovery-wrap key from the recovery key; wraps the same master key with it (`wrapped_mk_recovery`, nonce, AAD).
   - Derives a recovery verifier-key from the recovery key (per existing local-only flow).
   - `POST /api/v1/join/finish` with `kind: 'invitation'`, `session_id`, `username`, `registration_record`, wrapping material, recovery verifier.
   - On 200: receives access token, refresh-token cookie set by server; persist session via `useSessionStore.setSession(...)`; store the recovery key string for the next screen; navigate to `/onboarding/invitation/recovery`.
   - On 409 `username_taken`: stay on the confirm screen; surface inline error under the username field; preserve the value.
   - On other errors: see § 5.
6. Recovery-reveal screen shows the recovery key once (no copy without an explicit "I've saved it" tap; refresh discards it). On tap, navigate to `/app`.

### 4.2 Invitation (late-link from Settings)

Same as § 4.1 with deviations at step 4 and step 5/6:

- Confirm screen detects existing local session via `useSessionStore.getState().session`. Username field becomes read-only display (showing the existing local username). No suggested_username pre-fill (the user already has a username — but if it differs from `suggested_username` from /start, the local username wins; the operator's suggestion is informational only).
- At step 5, the master key is **not** freshly generated — the existing local MK is wrapped with the new OPAQUE export-key. Recovery key is **not** regenerated; the existing locally-wrapped recovery slot is uploaded as-is (preserving the verifier-key the user originally received).
- At step 6, navigate directly to `/app` — no recovery-reveal (user already has one). The user-client confirms in /app via an inline non-modal banner: "You are now connected to *{server}*. Your local data stays here, encrypted with the same key." (First-launch only.)

### 4.3 Pairing

1. Matrix tap *Add this device* → `/onboarding/pairing`.
2. User enters URL + code (or scans) — same Variant C as invitation.
3. On "Continue", `joinByPairing.startRound()`:
   - Generates fresh OPAQUE **login** request (not register).
   - `POST /api/v1/join/start` with `kind: 'pairing'`, `code`, `login_request`.
   - On 200: store `session_id`, `login_response`, `username` (from response).
   - Navigate to `/onboarding/pairing/confirm`.
4. Confirm screen renders server URL (read-only), username (read-only, from /start response), passphrase field, copy ("Your data on this device will be encrypted with the master key for this account.").
5. On "Continue", `joinByPairing.finishRound()`:
   - Generates OPAQUE login evidence from the passphrase + login_response.
   - `POST /api/v1/join/finish` with `kind: 'pairing'`, `session_id`, `login_evidence`.
   - On 200: receives `access_token`, refresh-cookie, **plus** `wrapped_mk_opaque`, `wrap_nonce_opaque`, `wrap_aad_opaque`.
   - Derives the OPAQUE export-key from the login record; unwraps the master key.
   - **Phase-0 accepted-data-loss** (per § 2 Decision 7): if a local session with a different MK existed, the local MK is replaced. The `// TODO(phase-1)` comment in `joinByPairing()` documents this. Audience is two; Phase-1 sync handles the merge.
   - Persists session via `setSession(...)`; navigate to `/app`.
   - On 401 `opaque_evidence_invalid`: stay on confirm, inline "Wrong passphrase" under the passphrase field.
   - On 500 `wrapping_invariant_violated`: generic error screen — "Cannot complete pairing. Please contact your operator." Don't expose the underlying violation (Larissa-relevant copy choice).

### 4.4 Recovery from scratch

1. Matrix tap *Use a recovery key* → `/onboarding/recovery`.
2. Single screen with: server URL, username, recovery key (one combined field with auto-hyphen), new passphrase, confirm new passphrase.
3. "Continue" enabled when all five fields validate and the two passphrases match.
4. On "Continue", `recoverFromScratch()`:
   - `POST /api/v1/recovery/start` with `username` and recovery proof.
   - On 200: server returns the recovery challenge + wrapped MK material.
   - Client derives the recovery wrap-key, unwraps the master key.
   - Generates a fresh OPAQUE registration record under the new passphrase.
   - Re-wraps the master key with the new OPAQUE export-key.
   - `POST /api/v1/recovery/finish` with the new registration record + new wrapping material.
   - On 200: receives access token, persists session, navigate to `/app`.
   - On error: see § 5.

### 4.5 Local-only

1. Matrix tap *Just this device* → `/onboarding/local/username`.
2. Existing `step-username` component, unchanged logic.
3. `/onboarding/local/passphrase` → existing `step-passphrase`.
4. On submit, `createLocalAccount()` runs (existing flow), session is persisted, recovery key is generated.
5. `/onboarding/local/recovery` → existing `step-recovery-reveal`, on confirm navigate to `/app`.

No biometric prompt on /app for local-only users (per § 2 Decision 6).

---

## 5. Error handling

| Error | Surface | Behaviour |
|---|---|---|
| `invalid_code_format` (client-side guard) | `/onboarding/<path>` form | "Continue" stays disabled; no server call. |
| `kind_mismatch` (400) | `/onboarding/<path>` form | Inline "This is a code from {other}, not from {expected}." plus button "→ {Switch path}" that navigates to the right path with the code pre-filled and the URL preserved. |
| `code_not_found_or_expired` (404) | `/onboarding/<path>` form | Inline "Code not recognised. It may have expired, been used, or contain a typo." |
| `username_taken` (409, invitation only) | `/onboarding/invitation/confirm` | Inline beneath username field. Value preserved. |
| `opaque_evidence_invalid` (401, pairing only) | `/onboarding/pairing/confirm` | Inline beneath passphrase field. |
| `rate_limit_exceeded` (429) | Current screen | Inline "Too many attempts. Please wait a minute." |
| `session_expired` (410) | Current screen | Inline "Your session timed out. Please start again." Resets the store, navigates back to the path's form screen. |
| `wrapping_invariant_violated` (500, pairing only) | `/onboarding/pairing/confirm` | Generic "Cannot complete pairing. Please contact your operator." No user-actionable detail. |
| Network failure (status 0 or 5xx) | Current screen | Inline "Server unreachable. Check your connection." No automatic retry. |
| QR scan permission denied | `/onboarding/<path>/scan` | Show "Camera unavailable" copy and a "Use the form instead" link that navigates back to the parent form screen. Existing logic in `linking/scan.tsx` is the pattern. |
| QR scan no-match (camera works but no QR detected after N seconds) | `/onboarding/<path>/scan` | No auto-timeout; user manually backs out. |
| Scanned QR is for the wrong path | `/onboarding/<path>/scan` | Same constructive handling as `kind_mismatch` — surface the offer-to-switch on return to the form screen with the code pre-filled. Server is the authority for kind detection. |

---

## 6. Code alphabet migration

### 6.1 Server-side change (`apps/auth-service`)

In `apps/auth-service/src/codes/token.ts`:

```ts
// Crockford Base32 with V↔U swap (see § 2 Decision 8). Excluded: I, L, O, V.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTUWXYZ';
const CODE_RE  = /^[0-9ABCDEFGHJKMNPQRSTUWXYZ]{5}-[0-9ABCDEFGHJKMNPQRSTUWXYZ]{5}$/;
```

Two constants to update (the `ALPHABET` literal used by `generateCode()`, and the `CODE_RE` regex used by `isValidCodeFormat()`). The comment cites § 2 Decision 8 so a future reader sees the intentional deviation from canonical Crockford. The server does **not** normalise; it accepts only the canonical form. Normalisation is exclusively client-side, so a request that reaches `/api/v1/join/start` with `O` in the code is rejected as `invalid_code_format` — the validator is straight and unambiguous.

No DB migration needed (pending_codes is currently empty; no live users in Phase 0). Entropy is preserved: 32 characters, 5 bits each, 10 characters per code = 50 bits — same as the brief's design budget.

### 6.2 Client-side normaliser (`apps/user-client`)

New utility `apps/user-client/src/lib/code-input.ts`:

```ts
// Pseudo-API
function normaliseCodeInput(raw: string): string {
  // 1. Uppercase
  // 2. Map I → 1, L → 1, O → 0, V → Y
  // 3. Strip anything not in the alphabet (incl. hyphens, whitespace)
  // 4. Re-insert hyphen after position 5 if length ≥ 5
}

function isValidCode(canonical: string): boolean {
  return /^[0-9ABCDEFGHJKMNPQRSTUWXYZ]{5}-[0-9ABCDEFGHJKMNPQRSTUWXYZ]{5}$/.test(canonical);
}
```

The code `<input>` uses `onChange` to apply `normaliseCodeInput()` on every keystroke and paste. The displayed value is always the canonical form. "Continue" is enabled when `isValidCode(value)` returns true.

URL field has no normalisation (URLs aren't normalisable in the same way), only validation: must parse as URL, http(s) scheme, https required for non-loopback hosts.

### 6.3 Test impact

- `apps/auth-service`: update `codes/token.test.ts` (if it exists) for the new alphabet and regex; generated codes now contain digits 0–9.
- `apps/user-client`: new tests for `normaliseCodeInput()` covering: lowercase input, I/L/O/V substitution (note the `V` → `Y` mapping for the in-alphabet-by-swap rule), foreign characters stripped, hyphen auto-insertion, paste of unhyphenated 10-char input.

### 6.4 Larissa

The alphabet swap is auth-service-touching; the Larissa pass at the end of the squash audits the alphabet constant, the regex, and the client-side normaliser. Audit scope is small (entropy preserved at 50 bits — same character count; brute-force resistance unchanged). The deviation from canonical Crockford (`V`↔`U` swap, § 2 Decision 8) is documented in code and spec so Larissa can read the intent rather than flag it.

---

## 7. Settings rewire

`apps/user-client/src/routes/settings/server-linking.tsx` is today a screen that hosts a primary "Scan invitation" button and an "Or paste" button. After this overhaul, the screen has the same intent but routes into the new flow:

- "Add server" CTA → `<Navigate to="/onboarding/invitation" replace />` (no intermediate screen).
- A short blurb explains that the user is about to attach this device to a server: "Adding a server connects this device's local data to a server. Your data stays encrypted with the same key. You can disconnect later." (Copy adjusted from today's.)

Removing the screen entirely is tempting (one fewer surface) but conservation here is intentional: the Settings entry gives the user a visible, predictable starting point that doesn't feel like "I'm being thrown into onboarding again". The blurb sets context that the matrix wouldn't (since the matrix is for fresh PWAs).

Recovery-from-scratch is *not* exposed from Settings — a user already logged in shouldn't be using recovery; they should change their passphrase via the existing `/change-passphrase` screen.

---

## 8. Implementation notes

### 8.1 `packages/crypto` flows

Each new flow lives in its own file under `packages/crypto/src/flows/`:

- `join-by-invitation.ts` — exports `startJoinByInvitation()` and `finishJoinByInvitation()`. Two-call API (matches the spec's two-round endpoints). Caller drives navigation between rounds.
- `join-by-pairing.ts` — same shape with `kind: 'pairing'`. `finishJoinByPairing()` returns the unwrapped master key for the caller to install via `setSession`.
- `recover-from-scratch.ts` — single function that does both rounds internally; takes username + recovery-key + new-passphrase, returns session.
- `link-to-server.ts` — existing function, migrated. Internal calls now route to `serverClient.joinStart` / `serverClient.joinFinish` with `kind: 'invitation'`.

All flows preserve the existing `CryptoError` discriminant (`'conflict'`, `'invalid_input'`, etc.) and add new variants for `kind_mismatch` and `opaque_evidence_invalid` where applicable.

### 8.2 `lib/server-client.ts` reshape

```ts
export const httpServerClient: ServerClient = {
  joinStart: (req: JoinStartRequest, baseUrl: string) =>
    apiFetch<JoinStartResponse>({ baseUrl, path: '/api/v1/join/start', json: req, authMode: 'none' }),
  joinFinish: (req: JoinFinishRequest, baseUrl: string) =>
    apiFetch<JoinFinishResponse>({ baseUrl, path: '/api/v1/join/finish', json: req, authMode: 'none' }),
  // … existing methods preserved (login, recovery, passphrase change, deleteMe, linkPasskey, etc.)
};
```

`linkOpaqueStart` and `linkOpaqueFinish` are removed from the `ServerClient` interface (in `packages/crypto/src/server-client.types.ts` or equivalent). All callers update to `joinStart` / `joinFinish` with the discriminator.

### 8.3 QR URL parser

`apps/user-client/src/lib/qr.ts` is rewritten:

```ts
type ParsedJoin = { baseUrl: string; code: string }
function parseJoinUrl(raw: string): { ok: true; value: ParsedJoin } | { ok: false; error: 'malformed' | 'bad_scheme' | 'bad_fragment' }

// Accepts: https://chatsundere.me/join#ABC12-XY9KL
//          http://localhost:5173/join#ABC12-XY9KL
// Rejects: anything without /join# fragment, anything with out-of-alphabet fragment chars
```

The old `parseInvitationPayload()` (custom-string format, `CHATSUNDERE|1|INVITE|…`) is deleted — the API-shapes spec replaced this with the real-URL form.

### 8.4 Passkey endpoints

`linkPasskeyStart` and `linkPasskeyFinish` in the current `server-client.ts` use `/v1/link/passkey/*` paths. The cross-device-identity Squash β migrated these to `/api/v1/link/passkey/*`. The user-client `server-client.ts` follows that migration. This is a path-only change, no logic change. (Already a follow-up tracked separately; included here so the spec covers the whole `server-client.ts` reshape.)

### 8.5 Component reuse

These existing components are reused as-is or with minor prop adjustments:

- `PassphraseField` (passphrase entry, used on confirm screens and local passphrase step).
- `RecoveryKeyReveal` (recovery-key display, used on invitation-recovery and local-recovery).
- `StepUsername` (username entry, used on local-username step; the confirm screens use their own inline input because the layout differs).

Components that need to be re-skinned for styling pass (deferred): the matrix cells, the form screens, the back-button treatment. Styling pass per [[feedback_mechanics_first_styling_later]].

---

## 9. Phase-0 / Phase-1 scope boundary

Phase 0 is private, audience is Chris + Liz testing. The Phase-0 onboarding overhaul ships:

- All four paths working end-to-end against the cross-device-identity Squash β backend.
- Alphabet swap (Crockford-derived with `V`↔`U`).
- Late-link from Settings.
- Variant-C form-first sub-screens with paste-auto-split.
- Constructive error handling including `kind_mismatch` offer-to-switch.

Phase 0 deliberately does **not** ship:

- UUIDv7-based local-data merge on pairing. The current behaviour replaces the local MK with the server MK; local data becomes inaccessible. `// TODO(phase-1)` comment in `joinByPairing.finishRound()` documents this. The Phase-1 sync brief picks this up.
- Auto-handover on pairing-with-existing-server. Same Phase-1 dependency.
- Biometric add inside the onboarding flow. Post-onboarding inline modal in /app is the Phase-0 placement; the modal itself is a small follow-up that may land in this squash or right after.

---

## 10. Manual verification

Chris runs the following on the dev server before squash (per CLAUDE.md § 10):

1. **First-device invitation, fresh PWA**:
   - Open user-client at fresh PWA install (no local DB), land on matrix.
   - Tap "I have an invitation", form screen appears.
   - Paste `http://localhost:3100/join#ABC12-XY9KL` into URL field — confirm code field auto-populates and URL trims to base.
   - Confirm "Continue" enabled. Tap.
   - Confirm screen shows server URL, suggested_username pre-filled (admin set this on create).
   - Edit username if desired, enter passphrase, tap Continue.
   - Recovery-reveal shows the key.
   - Tap "I've saved it" → land in /app. Biometric inline modal appears, dismissable.

2. **Pairing onto a fresh PWA**:
   - On Device A (already linked), generate a pairing code from Settings → Add device.
   - On Device B (fresh PWA), tap "Add this device", paste URL + code.
   - Confirm screen shows account username read-only.
   - Enter passphrase, tap Continue.
   - Land in /app. Biometric modal offered.

3. **Late-link from Settings**:
   - Create a local-only account first.
   - In /app, navigate to Settings → Server linking. Tap "Add server" → routes to `/onboarding/invitation`.
   - Enter URL + code from a fresh operator invitation.
   - Confirm screen shows username **read-only** (local username), no suggested_username override.
   - Enter passphrase, tap Continue. No recovery-reveal screen.
   - Land in /app with banner "Connected to {server}".

4. **kind_mismatch constructive handling**:
   - On the invitation form, paste a pairing code (or scan a pairing QR).
   - On Continue, surface inline offer "This is a code from another device. → Add device instead".
   - Tap the offer → navigate to `/onboarding/pairing` with URL + code preserved.

5. **Alphabet normalisation**:
   - In the code field, type lowercase `abc12-xy9kn` → uppercases on the fly.
   - Type `O` → normalised to `0`; type `I` or `L` → normalised to `1`; type `V` → normalised to `Y` (the `V`↔`U` swap means `V` is *not* in alphabet but `U` is).
   - Paste an unhyphenated `ABC12XY9KN` → auto-formats with hyphen between groups.

6. **Recovery from scratch**:
   - Wipe local DB and start fresh.
   - Tap "Use a recovery key", enter URL, username, recovery key, and a new passphrase (twice).
   - Submit; land in /app with previous data accessible after sync (Phase 1) — in Phase 0 just confirm the user lands in /app with the expected access token and recovery key consumed (server-side).

7. **Local-only end-to-end**:
   - Tap "Just this device", complete username + passphrase + recovery reveal.
   - Land in /app. No biometric inline modal (per § 2 Decision 6).

8. **All four matrix cells visible at 380px width**:
   - At 380px viewport, all four cells fit within one fullscreen viewport (no scroll).
   - Each cell has its symbol slot, label, and description visible.

9. **Browser-back navigation**:
   - From confirm screen, browser-back → form screen, form values preserved.
   - From form screen, browser-back → matrix.
   - From matrix, browser-back → nothing (fresh entry).

10. **Server unreachable**:
    - With backend down, attempt invitation start. Confirm inline "Server unreachable" copy, no crash.

---

## 11. References

- Brief: [`obsidian/briefs/phase 0/cross-device-identity.md`](../../obsidian/briefs/phase%200/cross-device-identity.md)
- API shapes: [`superpowers/specs/2026-05-22-cross-device-identity-api-shapes-design.md`](2026-05-22-cross-device-identity-api-shapes-design.md)
- ADR 0005 (PRF): [`obsidian/decisions/0005-require-prf-for-passkey-mk-wrapping.md`](../../obsidian/decisions/0005-require-prf-for-passkey-mk-wrapping.md)
- ADR 0007 (recovery required): [`obsidian/decisions/0007-recovery-key-required-at-registration.md`](../../obsidian/decisions/0007-recovery-key-required-at-registration.md)
- ADR 0021 (OPAQUE-first): [`obsidian/decisions/0021-phase0-opaque-first-linking.md`](../../obsidian/decisions/0021-phase0-opaque-first-linking.md)
- ADR 0024 (single-server-per-account): [`obsidian/decisions/0024-single-server-per-account.md`](../../obsidian/decisions/0024-single-server-per-account.md)
- ADR 0025 (UUIDv7): [`obsidian/decisions/0025-uuidv7-across-the-data-model.md`](../../obsidian/decisions/0025-uuidv7-across-the-data-model.md)
- ADR 0028 (unified join): [`obsidian/decisions/0028-unified-two-round-join-flow.md`](../../obsidian/decisions/0028-unified-two-round-join-flow.md)
- `CLAUDE.md` § 9 (Larissa gate), § 10 (Quality bar + manual verification), § 11 (UX principles), § 13 (lessons)
- Memory: `[[project_neurodivergent_audience]]`, `[[project_onboarding_drives_multi_device]]`, `[[feedback_mechanics_first_styling_later]]`
- Existing code: `apps/user-client/src/App.tsx`, `apps/user-client/src/routes/onboarding.tsx`, `apps/user-client/src/routes/linking/{scan,paste,confirm}.tsx`, `apps/user-client/src/lib/server-client.ts`, `apps/user-client/src/routes/create-account/*`, `apps/auth-service/src/codes/token.ts`
