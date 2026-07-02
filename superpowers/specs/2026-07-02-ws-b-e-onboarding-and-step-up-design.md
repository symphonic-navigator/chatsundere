# WS-B + WS-E — Onboarding Un-gate and the Step-up Client

**Date:** 2026-07-02
**Status:** approved design, pre-plan
**Sprint:** Full Backend Transition (branch `full-backend-transition`, see `STATUS-TRANSITION.md`)
**Audit gates:** Laura spec-pass PASSED 2026-07-02 (1 hard, 4 soft — all folded
into v2 of this document: §11.1 failure fall-through, §7.1 tier-keyed coalescing
note, §10.1 standing list copy, §11.2 touch-reachable marker, §7.2 modal copy);
Larissa on the WS-E squash (auth-service + `packages/crypto` + interceptor
courtesy-pass); Laura pre-squash on WS-B
**Depends on:** WS-0 Foundation (`2026-07-02-ws0-foundation-design.md` §14 consumption
contract) for the WS-B parts; WS-E has no WS-0 dependency

## 1. Context and goal

The client at `v0.1.3` keeps three onboarding matrix cells hard-disabled
(`onboarding/matrix.tsx:15-43`, "Coming with Block 2 server connection") even though
the join/pairing/recovery flows behind them are fully built and call the real crypto
flows. The server-linking page hard-codes `serverUrl = null`
(`server-linking.tsx:21`). Meanwhile the step-up backend
(`POST /api/v1/auth/step-up/{start,finish}`, ADR 0027) is live server-side, but no
client understands `step_up_required` — and the server already enforces Tier 4 on
admin invitation creation, so **creating an invitation from the admin-client is
broken today** (only the bootstrap CLI works).

Exploration surfaced two structural facts that shaped the cut:

1. **Pairing-code generation has no UI.** `POST /api/v1/me/pairing-codes` exists and
   is Tier-1 gated, but no client surface calls it. Un-gating "Add this device"
   without it leaves a dead-end, and building it requires the step-up client.
2. **`linkPasskeyStart/Finish` have no caller** (STATUS-TRANSITION open decision 3),
   so no user has a server-side passkey — step-up Mechanism A (WebAuthn) could never
   fire and every step-up would fall through to the passphrase.

The two workstreams therefore interlock and are designed as one unit, built and
squashed as two (E first, then B).

## 2. Decisions settled with Chris (2026-07-02)

| # | Axis | Decision |
|---|---|---|
| 1 | Pairing-code generation UI | **In WS-B** — an "Add a device" section on the server-linking page; it is also the natural first Tier-1 step-up consumer |
| 2 | Server-side enforcement gaps | **Closed in WS-E** — Tier 1 on `link/passkey/start`, passphrase-change start, `DELETE /auth-methods/:id`; Tier 3 on `DELETE /me`. auth-service is touched → Larissa gate added to WS-E |
| 3 | Server passkey linking | **Fully wired in WS-B** — post-onboarding prompt registers server-side for linked accounts; biometric page shows per-passkey sync status; resolves open decision 3 |
| 4 | Packaging | **One spec, one plan, two squashes** — WS-E first (interceptor + modal + enforcement, Larissa), then WS-B (un-gate + pairing UI + passkey link, Laura) |
| 5 | Step-up architecture | Shared ceremony in `packages/crypto`, shared modal in `packages/ui-shared`, one interceptor branch in each client's `apiFetch` |
| 6 | t1 seeding | Endpoints that cryptographically verify fresh OPAQUE or recovery-key evidence seed the t1 grace key; t3/t4 are never seeded |

## 3. Architecture

```
apps/auth-service       requireStepUp on 4 more endpoints; t1 seeding on 4 evidence
                        endpoints (WS-E, Larissa)
packages/shared-types   StepUpTier, step-up start/finish wire shapes
packages/crypto         flows/step-up.ts (ceremony, UI-free); ServerClient gains
                        stepUpStart/stepUpFinish (WS-E, Larissa)
packages/ui-shared      state/step-up.store.ts (promise gate) + components/StepUpModal
apps/user-client        apiFetch interceptor branch; onboarding un-gate + probe;
                        server-linking page; Add a device; passkey-link callers
apps/admin-client       apiFetch interceptor branch; StepUpModal mount
                        (passphrase-only)
```

---

# Part I — WS-E: the step-up vertical

## 4. auth-service enforcement (Larissa territory)

New `requireStepUp({ sessionId, tier })` calls, one line plus tests each:

| Endpoint | Tier | Note |
|---|---|---|
| `POST /api/v1/link/passkey/start` (`link.ts:36`) | 1 | `/finish` stays ungated — it is bound to the gated start via the Redis round state (`webauthn:register:<sessionId>`, 120 s TTL) |
| `POST /api/v1/auth-methods/passphrase/change/start` (`me.ts:175`) | 1 | `/finish` inherits via OPAQUE round state, same reasoning |
| `DELETE /api/v1/auth-methods/:id` (`me.ts:141`) | 1 | Single-shot, gated directly |
| `DELETE /api/v1/me` (`me.ts:108`) | 3 | 10-second tolerance per ADR 0027 — the client must step up immediately before the call. No user-client Tier-3 UI ships this sprint (§13); enforcement lands now so the gap does not survive into go-live |

Already enforced and unchanged: `POST /api/v1/me/pairing-codes` (t1),
`POST /api/v1/admin/invitations` (t4).

### 4.1 t1 seeding on fresh evidence

After successful cryptographic verification, these endpoints set
`step_up:<jti>:t1` (value: ms timestamp, TTL: 120 s — identical to what
`setStepUpKey` in `routes/step-up.ts` writes):

- `POST /api/v1/opaque/login/finish`
- `POST /api/v1/join/finish` (both `kind: 'invitation'` and `kind: 'pairing'`)
- `POST /api/v1/recovery/finish`
- `POST /api/v1/auth-methods/passphrase/change/finish` (fresh OPAQUE evidence for
  the new passphrase registration round)

Rationale: ADR 0027 already states for pairing-redeem that "the OPAQUE evidence in
the request *is* the step-up"; this generalises that rule consistently. The user
typed their passphrase (or recovery key) seconds ago — re-prompting within the
2-minute window protects nothing and directly hurts the post-onboarding passkey
prompt (§11.1). Deliberate limits:

- **Only t1 is seeded.** t3 (destructive) and t4 (operator) always require an
  explicit step-up ceremony. An operator logging in does not gain invitation-
  creation grace.
- Seeding happens strictly *after* the evidence verifies; failed rounds seed
  nothing.
- The seed extends the shared helper, not a parallel code path — one place computes
  key shape and TTL.

### 4.2 Wire facts (for the client)

- Gated endpoints reject with `403` and envelope
  `{ error: { code: 'step_up_required', message, tier: <number> } }` — `tier` is
  **numeric** (1 | 3 | 4), spread from `ApiError` metadata
  (`middleware/error-envelope.ts:21`). The client maps it to `'t1' | 't3' | 't4'`
  for `tier_requested`.
- `POST /api/v1/auth/step-up/start` (bearer): `{ mechanism: 'webauthn' | 'opaque',
  tier_requested, login_request? }` → webauthn: `{ session_id, mechanism, options }`;
  opaque: `{ session_id, mechanism, login_response }`. `400 no_passkey` when the
  user has no server-side passkey.
- `POST /api/v1/auth/step-up/finish` (no bearer): webauthn `{ session_id,
  assertion }` — `401 webauthn_uv_required` when the assertion verified but UV did
  not happen (fall through to opaque, counter already persisted); opaque
  `{ session_id, login_evidence }` — `401 opaque_authentication_failed` on wrong
  passphrase. Success: `{ tier_confirmed, expires_at }`.
- Rate limit: 10/session + 20/IP per 5 min → `429` with `Retry-After`.

## 5. Shared types

`packages/shared-types` gains (exported from the package index):

```ts
export type StepUpTier = 't1' | 't3' | 't4';
export interface StepUpStartRequest { mechanism: 'webauthn' | 'opaque'; tier_requested: StepUpTier; login_request?: string; }
export interface StepUpStartWebAuthnResponse { session_id: string; mechanism: 'webauthn'; options: PublicKeyCredentialRequestOptionsJSON; }
export interface StepUpStartOpaqueResponse { session_id: string; mechanism: 'opaque'; login_response: string; }
export interface StepUpFinishRequest { mechanism: 'webauthn' | 'opaque'; session_id: string; assertion?: AuthenticationResponseJSON; login_evidence?: string; }
export interface StepUpFinishResponse { tier_confirmed: StepUpTier; expires_at: string; }
```

## 6. Ceremony — `packages/crypto/src/flows/step-up.ts` (Larissa territory)

`ServerClient` (`packages/crypto/src/server-client.ts`) gains `stepUpStart` and
`stepUpFinish`; both app server-clients implement them via their `apiFetch`
**with the step-up interceptor disabled for these two paths** (a step-up call must
never recursively trigger the step-up gate; see §8).

Two UI-free functions:

```ts
type PasskeyStepUpOutcome = 'confirmed' | 'no_passkey' | 'uv_required' | 'failed';
stepUpWithPasskey({ serverClient, baseUrl, tier, getAssertion }): Promise<PasskeyStepUpOutcome>

type PassphraseStepUpOutcome = 'confirmed' | 'wrong_passphrase' | 'failed';
stepUpWithPassphrase({ serverClient, baseUrl, tier, passphrase }): Promise<PassphraseStepUpOutcome>
```

- `getAssertion: (options) => Promise<AuthenticationResponseJSON>` is injected by
  the caller — the user-client passes `@simplewebauthn/browser`'s
  `startAuthentication`. The flow stays DOM-free and unit-testable against a mocked
  `ServerClient`.
- `stepUpWithPasskey` maps `400 no_passkey` at start → `'no_passkey'`, user/
  authenticator abort of `getAssertion` → `'failed'`, `401 webauthn_uv_required` at
  finish → `'uv_required'`.
- `stepUpWithPassphrase` runs the OPAQUE round via the existing
  `packages/crypto/src/opaque/client.ts`. No username crosses the wire — the server
  binds the round to the bearer and reads the registration-time identifier itself.
- Neither function retries, prompts, or stores anything; the passphrase lives only
  in the argument and the OPAQUE round.

## 7. Modal and controller — `packages/ui-shared`

### 7.1 `state/step-up.store.ts`

A promise-based gate, usable outside React (both `apiFetch`s are plain modules):

```ts
requestStepUp(tier: StepUpTier): Promise<boolean>   // true = confirmed
```

- **Coalescing:** concurrent `requestStepUp` calls while a request is pending await
  the same promise and resolve together — one modal, never a stack. The pending
  request's tier is the first caller's; §7.2 keeps the copy tier-agnostic so this
  is safe. (Coalesced callers whose tier differs from the confirmed one simply
  retry and, if still unsatisfied, surface their normal error — no wrong-success.)
  **Guard for later sprints (Laura):** mixed-tier coalescing cannot arise this
  sprint (t3 has no user-client UI, t4 is admin-only), but the moment a Tier-3 or
  mixed-tier user-client surface lands, coalescing must key on tier (separate
  pending gates per tier, or re-open for the unmet tier) rather than collapsing
  all callers onto the first tier — a successful authentication must never leave
  a coalesced caller failing silently.
- Store shape: `{ pending: { tier, resolve } | null }` plus `open`/`close` actions
  consumed by the modal host.
- Cancel resolves `false`; confirm resolves `true`.

### 7.2 `components/StepUpModal.tsx`

Shared component (precedent: `ConfirmTyped` lives shared in
`packages/ui-shared/src/components/`); mechanism handlers are injected per app so
the component carries no crypto imports:

```ts
interface StepUpModalProps {
  passkeyAvailable: boolean;                      // admin-client passes false
  onPasskey?: () => Promise<PasskeyStepUpOutcome>;
  onPassphrase: (passphrase: string) => Promise<PassphraseStepUpOutcome>;
}
```

Copy per the step-up brief (`obsidian/briefs/phase 0/step-up-auth.md` §UX
Patterns), method-agnostic, tier-agnostic. One revision to the brief's draft
wording (Laura soft finding, Chris arbitrates): the brief's "requires a fresh
sign-in" can read as "did I get logged out?" to a signed-in user — the headline
becomes a re-check, not a sign-in:

- Both mechanisms: "Confirm it's you / A quick re-check keeps your account safe."
  → `[ Use passkey ]` `[ Use passphrase instead ]` `[ Cancel ]`
- Passphrase-only: "Confirm it's you / Re-enter your passphrase to continue." →
  passphrase field + `[ Cancel ]` `[ Confirm ]`
- `no_passkey` / `uv_required` outcomes switch **silently** to the passphrase view
  — the user never sees a WebAuthn error.
- Failure copy: "Couldn't verify with passkey. Try your passphrase." (A failed, B
  available) / "Wrong passphrase. Try again." (no counter hints, non-leaky).
- Success is invisible: modal closes, the retried operation's own success surface
  speaks.
- `passkeyAvailable` in the user-client = a local `PasskeyCredentialRow` with
  `is_synced_with_server === true` exists (local knowledge, no server round-trip);
  admin-client passes `false` (it has no passkey infrastructure; OPAQUE is always
  available per ADR 0021).
- Styling follows the host app (user-client opulent, admin-client Catppuccin), same
  pattern as existing shared components. Mobile-first at 380 px; buttons are
  touch-reachable; the modal is keyboard- and screen-reader-navigable
  (focus trap, `aria-modal`).

Each app mounts one modal host at its root and wires the ceremony:
user-client passes both handlers (building `getAssertion` from
`@simplewebauthn/browser`), admin-client passes `onPassphrase` only.

## 8. `apiFetch` interceptor — both clients

Exactly one new branch in `apps/user-client/src/lib/fetch.ts` and
`apps/admin-client/src/lib/fetch.ts`, after the existing 401-refresh branch:

1. Response is `403` and envelope code is `step_up_required` → read numeric
   `error.tier`, map to `StepUpTier`.
2. `const confirmed = await requestStepUp(tier)`.
3. `confirmed` → rebuild init (fresh bearer) and retry **once**. A second
   `step_up_required` (grace expired between confirm and retry — the t3 10-second
   case) throws the `HttpError` to the call site; no loop.
4. Cancelled → throw the original `HttpError`; the call site's existing error
   surface renders, with user input preserved (constructive-error doctrine).

Opt-out: the two step-up endpoints themselves (and only they) bypass the branch —
`stepUpStart`/`stepUpFinish` pass an internal `skipStepUpGate` option so the
ceremony can never recurse into the gate.

Out of scope for this interceptor: MCP/LLM traffic (`transport.ts`,
`mcp-client.ts`) deliberately does not use `apiFetch`; step-up only guards
auth-service endpoints, which all flow through `apiFetch`. The proxy path is WS-A.

### 8.1 Admin-client Tier 4

Mounting the modal host plus the interceptor branch is the entire wire-up:
invitation create/revoke (and the future suspend actions) recover automatically.
The 5-minute t4 grace covers burst work; the first action prompts, the burst rides
the grace.

---

# Part II — WS-B: onboarding un-gate, Add a device, passkey link

## 9. Matrix un-gate and constructive URL probing

- `onboarding/matrix.tsx`: the three cells (invitation / pairing / recovery) lose
  `disabled: true` and become unconditionally active links. The matrix is a
  pre-account surface — no server is known yet, so no gate can apply. The
  `DisabledCell` component and `disabledTooltip` field are removed (no remaining
  consumer).
- The URL-entry steps of all three flows (`invitation/form.tsx`, `pairing/form.tsx`,
  `recovery.tsx`) call WS-0's `probeServer(candidateUrl)` on submit, before
  entering the join:
  - `unreachable` → "That server isn't answering. Check the address, or try again
    in a moment." — input preserved.
  - `invalid` → "That address doesn't look like a Chatsundere server. Check it
    with whoever invited you." — input preserved.
  - `ok` → proceed into the existing flow.
  The probe of a candidate URL returns a result without mutating global discovery
  state (WS-0 §5). Probe copy lands in `lib/copy.ts` beside the existing onboarding
  strings; exact phrasing is Laura's spec-pass material.

## 10. The server-linking page becomes real

`routes/app/account/server-linking.tsx` drops the hard-coded `serverUrl = null`
(`:21`) and reads `useAccountLinkStore` (WS-0 §6):

- **Local-only:** current view stays — neutral badge, explainer, "Link to server"
  into the invitation wizard with the existing return-URL.
- **Linked:** success badge "Linked to {base_url}", plus issuer label, role, and
  linked-since; below it the new **Add a device** section (§10.1). Copy updated —
  the "Block 1 / Block 2" developer framing goes away.
- **Store migration (WS-0 §14):** the link/unlink flows call `setLinked(row)` /
  `setLocalOnly()` after `putLinkedAccount`/`deleteLinkedAccount` succeed — i.e.
  the invitation-link path (`invitation/confirm.tsx:121` via `linkToServer`), both
  join paths, and recovery. The ad-hoc `getLinkedAccount` read in
  `login/index.tsx:36` migrates to the store in passing (organic migration per
  WS-0 §6).

### 10.1 Add a device — pairing-code generation

Linked state only. No new navigable surface — creation is a strict begin→end
operation, so the reveal is a transient overlay on the page (transient-ops
doctrine):

- **"Add a device"** button → `POST /api/v1/me/pairing-codes` (t1 — the WS-E modal
  appears unless within grace) → reveal overlay: QR rendered from `qr_url` with
  `qrcode` (mirroring `admin-client/src/routes/invitations/reveal-screen.tsx:17`;
  new user-client dependency) + the 10-character code as manual fallback + expiry
  + the notice **"You won't see this code again — the server keeps only a
  fingerprint."** (`GET` returns `code: null`/`qr_url: null` by design; the
  documented spec-§4.5 deviation.)
- Beneath it the **active codes list** (`GET /api/v1/me/pairing-codes`):
  created/expires times and a revoke button (`DELETE …/:id`, Tier 0 — deliberately
  ungated; revocation is the user's safety lever). Leaving the reveal is safe: the
  code stays listed as metadata and revoke-and-reissue is the recovery path — the
  notice says so.
- **Standing list copy (Laura):** the shown-once explanation must not live only in
  the transient reveal — a user returning later sees rows they cannot expand and
  may tap expecting the code. The list itself carries a persistent one-liner:
  "Codes are shown once, when created. Lost one? Add a device to create a fresh
  one." — the metadata-only rows are self-explaining without memory of the
  overlay.
- Empty state names the next step ("No active codes. Add a device to create one.").

## 11. Server passkey linking gets its callers

Resolves STATUS-TRANSITION open decision 3: wired, not deferred. The complete flow
(`packages/crypto/src/flows/add-passkey-post-link.ts`) already exists with tests;
WS-B adds the two call sites.

### 11.1 Post-onboarding biometric prompt

For linked accounts, `PostOnboardingBiometricPrompt` registration takes the server
path: `linkPasskeyStart` (server issues the challenge) →
`navigator.credentials.create` with the PRF extension →
`addPasskeyPostLink` (verifies at the server *and* writes the local PRF-wrapped
row, `is_synced_with_server: true`). PRF-less authenticators are refused as today
(ADR 0005, `PrfRequiredError` path unchanged). Thanks to t1 seeding at join
(§4.1) this runs without re-prompting for the passphrase the user typed seconds
earlier. Local-only accounts keep the existing local path unchanged.

**Server-path failure fall-through (Laura hard finding).** The server path adds
failure modes the local path never had, and it lands at fresh onboarding — the
most delicate moment. Specified before build:

- **`linkPasskeyStart` fails** (network/server — the join succeeded but the
  connection can drop a second later): no credential has been minted. Calm,
  constructive, dismissable: "Couldn't reach your server just now — you can add
  this any time under Account → Biometric unlock." The prompt's existing
  "Maybe later" exit stays; nothing is lost.
- **`navigator.credentials.create` succeeds but `addPasskeyPostLink` fails**
  (server verify or network on finish): the client **falls back to writing the
  local-only row** (`is_synced_with_server: false`) from the material already in
  hand — credential id, public key, PRF output — so the credential is never an
  orphan the app knows nothing about, the user keeps local biometric protection,
  and a retry never mints a second authenticator credential. Copy: "Your passkey
  is set up on this device, but couldn't be synced with your server. It still
  unlocks Chatsundere here — Account → Biometric unlock shows its status." The
  row then carries the §11.2 on-this-device-only marker, whose touch-reachable
  explanation names fresh registration as the later sync path.

### 11.2 Biometric page

`routes/app/account/biometric.tsx`:

- Per-passkey sync marker: "Synced with your server" / "On this device only"
  (`is_synced_with_server` already exists on `PasskeyCredentialRow`).
  **Touch-reachable explanation (Laura):** the two-word marker cannot carry its
  consequence at 380 px. It gets a press-to-reveal caption (info dot or inline
  expansion — never a title-only tooltip, per the WS-0 affordance mandate's
  spirit): "Passkeys can't be copied between devices, so this one only works
  here. To get one that follows your account, register a new passkey." — phrased
  as a property of WebAuthn, never as a user omission. The synced marker's
  caption is equally plain: "This passkey is registered with your server and can
  confirm actions on your account."
- For linked accounts, **every new** passkey registration takes the server path
  (omakase — no toggle). Within t1 grace it is silent; otherwise the step-up modal
  appears.
- Existing local-only passkeys stay listed with the on-this-device marker. WebAuthn
  does not permit re-attesting an existing credential, so retro-sync is impossible;
  the marker copy points at fresh registration as the path.

From the first synced passkey onwards, the step-up modal offers "Use passkey" —
Mechanism A becomes real (§7.2 `passkeyAvailable`).

**No Dexie touch anywhere in B or E:** everything runs through the crypto IDB
(schema unchanged, all fields exist). No collision with v33/WS-C.

---

# Part III — shared concerns

## 12. Error handling

- **Step-up cancel:** modal closes, no state change, the operation does not happen;
  the call site's normal error surface renders with input preserved.
- **Wrong passphrase in the modal:** "Wrong passphrase. Try again." — no attempt
  counters, nothing leaky. `429` from the step-up endpoints surfaces a
  Retry-After-informed wait message.
- **`no_passkey` / `uv_required`:** silent switch to the passphrase view; never
  user-visible as an error.
- **Onboarding probe failures:** input preserved, message names the next step
  (§9). No dead-ends.
- **Pairing reveal abandoned:** safe by design — metadata stays listed,
  revoke-and-reissue recovers (§10.1).
- **Post-onboarding server-passkey failures:** per §11.1 fall-through — start
  failure loses nothing and names the Settings path; finish failure degrades to a
  working local-only passkey, never an orphan credential or a dead prompt.
- **Double 403 after retry** (t3 tolerance window missed): `HttpError` to the call
  site; the user re-initiates. No loop.

## 13. Scope boundary — explicitly OUT

- Disconnect-from-server / delete-account UI (Tier-3 call sites in the
  user-client) — enforcement lands now (§4); the UI belongs to the auto-handover
  complex (ADR 0026), its own post-sprint workstream.
- Server login via passkey (WebAuthn login instead of OPAQUE) — the passkey link
  creates the precondition; the login flow itself is untouched.
- Retro-syncing existing local passkeys — impossible per WebAuthn semantics
  (§11.2).
- Proxy/sync/blob consumption — WS-A/C/D.
- New admin surfaces (e.g. suspend-user UI) — the interceptor covers the endpoint
  whenever such a surface arrives; none ships here.
- Tier 2 — still reserved, no endpoint, no client behaviour.

## 14. Testing

1. **auth-service (Bun):** per newly gated endpoint — 403 `step_up_required` (with
   numeric tier in the envelope) without the key, success with a seeded key; t1
   seed written after `opaque/login/finish`, `join/finish` (both kinds),
   `recovery/finish`, `passphrase/change/finish`; failed evidence seeds nothing;
   **t4 is never seeded by any login/join path**.
2. **packages/crypto (Vitest):** ceremony flows against a mocked `ServerClient` —
   full outcome matrix (`confirmed` / `no_passkey` / `uv_required` / `failed` /
   `wrong_passphrase`), assertion-callback wiring, no retries. Structural
   assertions, no copy string-matching.
3. **ui-shared:** controller store — two concurrent `requestStepUp` calls produce
   one pending request and both promises resolve with the single outcome;
   cancel → `false`; a follow-up request after resolution opens fresh.
4. **user-client:** interceptor — 403 → gate → single retry; cancel → original
   `HttpError`; double-403 → no loop; `skipStepUpGate` honoured on the step-up
   endpoints. Probe wiring of the three onboarding forms against a mocked
   `probeServer` (result → proceed/blocked + copy key). Matrix renders four
   active cells. Post-onboarding server-path fall-through: start failure →
   dismissable prompt, no local row; finish failure → local-only row written
   (`is_synced_with_server: false`), no orphan.
5. Baseline discipline: the environmental Node-localStorage failures stay exactly
   8 (`project_vitest_baseline_is_node_localstorage`).

## 15. Manual verification (Chris, dev backend + devices)

1. **Invitation E2E:** admin-client → create invitation (Tier-4 modal, passphrase)
   → scan QR on the phone → join → post-onboarding prompt registers the passkey
   **without** a passphrase re-prompt (t1 seed) → server-linking page shows
   "Linked to …".
2. **Pairing E2E:** old device → Add a device (t1 modal unless < 2 min after
   login) → QR/code on the new device → join → both devices linked; the code
   leaves the active list.
3. **Recovery E2E:** recovery-key path against the live server.
4. **Grace windows:** two pairing codes within 90 s → second prompts nothing; with
   a 3-minute gap → both prompt. Logout → login → first t1 op prompts again.
5. **UV fall-through:** Linux + Bitwarden Desktop (unlocked vault, no UV) → modal
   switches silently to the passphrase view.
6. **Probe errors:** wrong URL and a non-Chatsundere URL in onboarding →
   constructive messages, input preserved.
7. **Mechanism A:** after a synced passkey exists, trigger a t1 op → "Use passkey"
   appears and confirms with UV.

## 16. Build order and audit gates

1. **WS-E squash** — shared types, auth-service enforcement + seeding, ceremony
   flows, store + modal, both interceptors, admin mount. Gate: **Larissa**
   (auth-service + `packages/crypto` mandatory; interceptor path as courtesy-pass
   per the frontend-changes-affecting-crypto-semantics pattern), Laura pre-squash
   on the modal UX.
2. **WS-B squash** — matrix un-gate + probes, server-linking page + store
   migration, Add a device, passkey-link callers. Gate: **Laura** pre-squash
   (user-reachable flows throughout); no mandatory Larissa path (crypto package
   untouched; consumes existing flows), but the passkey-link call sites get a
   Larissa courtesy-pass alongside the WS-E re-audit if one is needed.

WS-E has no WS-0 dependency and can build while the WS-0 remote run lands; WS-B
consumes WS-0's `probeServer` + `account-link.store` and rebases on it.
