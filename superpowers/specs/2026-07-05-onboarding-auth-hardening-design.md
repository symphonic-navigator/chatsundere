# Onboarding & Auth Hardening — Design

**Date:** 2026-07-05
**Author:** Liz (with Chris)
**Status:** Approved — ready for implementation plan
**Roadmap context:** Hardening ahead of the v0.2.0 whole-backend go-live (~48 h). Two
diagnosed follow-ups from the 2026-07-05 auth/pairing deep-audits, both on the
onboarding/auth path — the day-one surfaces every alpha user meets.

Closes follow-ups **F3** and **Pairing F4/F5**
(`obsidian/insights/follow-ups-index.md` lines 34, 66).

---

## 1. Motivation

Two independent defects on the auth/onboarding path, both surfaced by the
2026-07-05 deep-audits, both landing users in a worse-than-necessary state on
genuine, recoverable conditions:

- **F3 — Multi-tab concurrent refresh (Medium, UX/availability).** Two open tabs
  refresh the access token concurrently against the same refresh-token family, the
  server reads the parallel presentation as token reuse, revokes the whole family,
  and both tabs hard-logout. A likely day-one UX hit once the backend is live.
- **Pairing F4/F5 — unmapped join error codes.** Five real server lifecycle codes
  fall through to the generic "Something went wrong. Please try again.", each of
  which has an obvious constructive next step. Violates the constructive-error
  tenet (the *dere* half of the product).

The two are bundled because they share the same surface (onboarding/auth), the same
go-live window, and the same discipline (spec → plan → TDD → audit). They are
otherwise independent units and can be squashed separately.

---

## 2. Scope

| Unit | Files touched | Larissa path? |
|---|---|---|
| **A — F3 refresh serialisation** | `apps/user-client/src/lib/fetch.ts` | No (client-only; no `packages/crypto`, no auth-service) |
| **B — F4/F5 join error codes** | `packages/shared-types/src/join.ts`, `apps/auth-service/src/codes/rate-limit.ts`, `apps/user-client/src/routes/onboarding/pairing/confirm.tsx`, `apps/user-client/src/routes/onboarding/invitation/confirm.tsx` | **Yes** — the auth-service status change pulls Unit B onto the Larissa gate |

Out of scope (deliberate):

- The dead crypto rewrap `isEvidenceInvalidError` in
  `packages/crypto/src/flows/join-by-pairing.ts:323` (follow-ups line 147).
  Behaviour is already correct via `mapError`; touching it would drag
  `packages/crypto` onto the Larissa path for no behavioural gain. Remains a
  separate opportunistic cleanup.
- Any proactive/timer-driven token refresh. Refresh stays purely reactive
  (401/4401-driven) — F3 changes *how* the reactive refresh is serialised, not
  *when* it fires.
- Auto-retry affordances for `rate_limited` / `session_expired`. YAGNI — a clear
  "wait a minute / start again" message is the honest fix; a retry timer is polish
  for later if users ask.

---

## 3. Unit A — F3: cross-tab refresh serialisation

### 3.1 Current behaviour

`refreshAccessToken(baseUrl, origin)` (`fetch.ts:194`) dedupes only through a
module-global promise `refreshInFlight` (`fetch.ts:148`), which is **per tab /
per JS realm**. Two tabs therefore each fire `POST /api/v1/token/refresh`
(`credentials: 'include'`, shared HttpOnly cookie) concurrently. The server reads
the concurrent presentation of the same refresh token as reuse, revokes the whole
family, and every interactive tab resolves to `outcome === 'refused'` →
`useSessionStore.getState().closeAndForget()` → hard logout.

There is no cross-tab coordination anywhere on the auth path (no `BroadcastChannel`,
no `storage` events, no Web Locks). The only existing cross-tab single-flight in the
codebase is `withSingleFlight` in the sync worker (`apps/user-client/src/sync/worker.ts:872`),
using `navigator.locks`.

### 3.2 Design

Introduce an exclusive, **blocking** Web Lock around the refresh round-trip,
serialising it across all same-origin tabs. Model on `withSingleFlight`, but
**without** `{ ifAvailable: true }` — the sync worker's semantics are "lock held →
skip this cycle"; the refresh must be "lock held → *wait*, then proceed", so a
second tab serialises behind the first instead of skipping.

```
async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (locks && typeof locks.request === 'function') {
    // exclusive (default mode), blocking — the second tab waits, does not skip
    return await locks.request('chatsundere-token-refresh', fn);
  }
  return await fn(); // jsdom / no-Web-Locks fallback
}
```

Wiring in `refreshAccessToken` keeps the module-local `refreshInFlight` guard
*inside* the lock, so the two layers compose:

- **`refreshInFlight`** — collapses a within-tab 401 storm into one round-trip
  (unchanged from today).
- **`withRefreshLock`** — serialises those round-trips across tabs.

```
refreshInFlight ??= withRefreshLock(() => classifyRefresh(baseUrl)).finally(() => {
  refreshInFlight = null;
});
```

### 3.3 Why no post-lock token recheck

Once refreshes are serialised, each one presents the current (already-rotated)
shared cookie, so there is never a concurrent presentation of the same refresh
token — the reuse trigger is gone. A second tab acquiring the lock after the first
simply performs its own refresh against the now-current cookie; this is harmless
(sequential rotation) and necessary, because each tab needs its own in-memory
access token in its own per-tab session store, which cannot be shared cross-tab
without new machinery we are deliberately not adding.

### 3.4 Unaffected

- All four call sites (`fetch.ts:76` 401-interceptor, `proxy-auth.ts:34`,
  `doorbell.ts:227`, `blob-transport.ts:149`) call `refreshAccessToken` unchanged —
  the serialisation is entirely internal to it.
- The `origin` branching (`background` → `setAuthDegraded` latch; `user` →
  `closeAndForget`) is untouched.
- Follow-up L-3 is untouched: the client already treats every non-`unauthorized`
  refresh failure as harmless `unreachable`, so there is no logout over-reach to
  fix here.

---

## 4. Unit B — F4/F5: join error codes + constructive messages

### 4.1 Server-emitted codes (ground truth)

The join surface emits, across `apps/auth-service`:

| Code | Status | Source |
|---|---|---|
| `invalid_code_format` | 400 | `routes/join.ts:75` |
| `kind_mismatch` | 400 | `codes/rate-limit.ts:51` |
| `code_not_found_or_expired` | 404 | `codes/rate-limit.ts:63` |
| `code_already_redeemed` | **409 → change to 410** | `codes/rate-limit.ts:65` (also 410 at `routes/join.ts:349,465`) |
| `code_expired` | 410 | `codes/rate-limit.ts:68` |
| `code_attempts_exhausted` | 429 | `codes/rate-limit.ts:72` |
| `rate_limited` | 429 | `middleware/rate-limit.ts:30` |
| `session_expired` | 410 | `routes/join.ts:288,294,422,429,488` |
| `username_taken` | 409 | `routes/join.ts:407` |
| `opaque_authentication_failed` | 401 | `routes/join.ts:442` |
| `wrapping_invariant_violated` | 500 | `routes/join.ts:168,473` |

### 4.2 shared-types (`packages/shared-types/src/join.ts:69`)

`JoinError` today declares one phantom code the server never sends
(`RateLimitExceeded: 'rate_limit_exceeded'`) and omits four real ones. Corrected shape:

- **Remove** `RateLimitExceeded: 'rate_limit_exceeded'`.
- **Add** `RateLimited: 'rate_limited'`, `CodeExpired: 'code_expired'`,
  `CodeAlreadyRedeemed: 'code_already_redeemed'`,
  `CodeAttemptsExhausted: 'code_attempts_exhausted'`.

`JoinError` becomes the single wire truth for the join lifecycle, matching the
server exactly.

### 4.3 auth-service (`codes/rate-limit.ts`)

Change the `code_already_redeemed` guard (`codes/rate-limit.ts:65`) from
`ApiError(409, …)` to `ApiError(410, …)`, unifying it with the atomic-CAS path in
`routes/join.ts:349,465` (already 410). 410 Gone is the correct semantics — a
redeemed one-time code is terminally spent, not a conflict, and it aligns with the
sibling `code_expired` (410). The client matches on the `code` string, so this is
an HTTP-semantics/wire-contract correctness fix for API consumers and self-hosters,
not a behavioural change for the client. Any server integration test asserting the
409 status is updated to 410.

### 4.4 Client confirm handlers

Both handlers reuse the existing **fatal-screen** chrome (danger banner + a "try
again" link back to the form — `pairing/confirm.tsx:164`). No new screen type. The
constructive value is the *message*: each code gets a specific, flow-tailored line.
The tailoring axis is "who to ask for a fresh code" — the user's **other device**
(pairing) vs the **inviting person** (invitation).

**Pairing** (`routes/onboarding/pairing/confirm.tsx`, `mapError` lines 245-293):
- Fix the dead `rate_limit_exceeded` branch → match `rate_limited`.
- Add branches: `code_expired`, `code_already_redeemed`, `code_attempts_exhausted`,
  `session_expired` (pairing currently has no `session_expired` branch at all).

**Invitation** (`routes/onboarding/invitation/confirm.tsx`, `mapSubmitError` lines 426-486):
- Fix the dead `rate_limit_exceeded` branch → match `rate_limited`.
- Add branches: `code_expired`, `code_already_redeemed`, `code_attempts_exhausted`.
- `session_expired` already handled — align its wording with the pairing side.

### 4.5 Copy (British English)

| Code | Pairing (other device) | Invitation (operator) |
|---|---|---|
| `code_expired` | This pairing code has expired. Generate a fresh one on your other device and enter it here. | This invitation has expired. Ask the person who invited you for a fresh code. |
| `code_already_redeemed` | This pairing code has already been used. Generate a new one on your other device. | This invitation has already been used. Ask the person who invited you for a new one. |
| `code_attempts_exhausted` | Too many tries — this code is now locked for safety. Generate a new one on your other device. | Too many tries — this invitation is now locked for safety. Ask the person who invited you for a new one. |
| `rate_limited` | Too many attempts. Please wait a minute, then try again. | Too many attempts. Please wait a minute, then try again. |
| `session_expired` | This took a little too long and the secure session timed out. Please start again. | This took a little too long and the secure session timed out. Please start again. |

---

## 5. Testing strategy

TDD throughout. Existing scaffolds are extended, not replaced:

- **Unit A:** unit test the serialisation in `fetch.ts` — assert that with a mocked
  `navigator.locks` two concurrent `refreshAccessToken` calls serialise through the
  lock, and that the jsdom fallback (no `navigator.locks`) preserves the current
  `refreshInFlight` dedupe. No live server needed.
- **Unit B (client):** `apps/user-client/tests/routes/pairing-confirm-map-error.test.ts`
  gains cases for the five newly-mapped codes; add the invitation-side equivalent for
  its four additions. Assert the specific message, not the generic fallthrough.
- **Unit B (server):** `apps/auth-service/tests/integration/join-invitation.test.ts`
  and `join-pairing.test.ts` — update the `code_already_redeemed` assertion to 410;
  confirm the full lifecycle-code set is emitted with the documented statuses.

Gates before each squash: `pnpm typecheck --force` (covers tests), `pnpm build`,
the full user-client vitest at the known 8 Node-localStorage baseline, auth-service
`bun test` at its known baseline, Biome clean on changed files.

---

## 6. Larissa gate

**Unit B is a Larissa path** (auth-service diff). Summon Larissa on the Unit B diff
before squash — focus on the status-code change and the error-envelope surface (no
information leak in the new client copy; the server change is a pure status
substitution with no logic change). **Unit A is not a Larissa path** (client-only
`fetch.ts`, no crypto/auth-service). No Laura pass for either (Unit A has no
user-reachable flow change; Unit B alters only error *copy* on existing screens, no
new flow/state/reachability — a copy/mechanics change, judgement-call skip per §9.2).

---

## 7. Manual verification (device — Chris)

**F3:**
1. Open the client in two tabs, signed in.
2. Force both to refresh near-simultaneously (e.g. let the access token expire, then
   trigger an API call in each tab within a second of each other — or use a debug
   trigger).
3. Confirm both tabs stay signed in (no hard-logout, no "session expired" bounce to
   onboarding). Before the fix, both tabs logged out.

**F4/F5** (needs the live backend + a way to reach each state):
1. **Expired code** — mint a code, let it expire (or expire it operator-side), redeem
   it → specific "expired" message, not the generic one; on both pairing and invitation.
2. **Already redeemed** — redeem a code twice → specific "already used" message.
3. **Attempts exhausted** — enter a wrong/mismatched code 4× → specific "locked for
   safety" message.
4. **Rate limited** — trip the per-IP limit → "wait a minute" message (previously a
   dead branch, never shown).
5. **Session expired (pairing)** — start a pairing, wait past the round-state TTL,
   finish → "session timed out, start again" (previously generic on the pairing side).
