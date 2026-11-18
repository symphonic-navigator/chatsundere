# Passkey unlock hands the master key to the session store — design

**Date:** 2026-11-18
**Release:** 0.5.0
**Branch:** `fix/050-passkey-master-key`
**Security boundary:** touches `packages/crypto` (a Larissa path, CLAUDE.md §9.1). Larissa audits this design before any code and the diff before the squash.
**UX:** no user-reachable flow, state or affordance is added or moved; a broken one starts working. Laura is skipped (CLAUDE.md §9.2 judgement call); the one UX consequence for the papercut unit's `need=passphrase` mode is raised as Q3.

## 1. The fault

After a passkey unlock from a cold start the session is active, but the session store's raw master-key slice (`useSessionStore.getState().mk`) stays `null`.

- `apps/user-client/src/routes/login/index.tsx:259` calls `activateSession(session)` without `mk`. The passphrase paths in the same file (`:153`, `:178`) and every other unlock or onboarding path (`login/recovery.tsx:199,205`, `onboarding/recovery.tsx:113`, `onboarding/pairing/confirm.tsx:118`, `onboarding/invitation/confirm.tsx:268`, `onboarding/local/index.tsx:35`) pass it.
- `packages/crypto/src/flows/login-biometric.ts` (`loginWithLocalBiometric`) unwraps the MK from the PRF-wrapped blob and returns only the `MasterKeySession`, which keeps the MK in its closure.
- `apps/user-client/src/boot/activate-session.ts` documents the omission as intended ("the passkey path, which sets no raw MK"), and `setSession` preserves the existing slice when `mk` is omitted, which after a cold start is `null`.

35 readers of the raw slice in `apps/user-client/src` then fail: sending, the opener, regenerate and compaction (`data/send-message.ts`, `state/stream-manager.store.ts`), memory actions (`memory/resolve-args.ts`), saving or testing a provider key, MCP keys and OAuth grants, voice (falls back silently to "no provider"), and the sync engine (`sync/triggers.ts:53,120-122`, `sync/gate.ts:69`, `sync/worker.ts`, `sync/apply.ts`), which for a linked account never starts and says nothing.

**Reproduced** on 2026-11-18 by `apps/user-client/tests/routes/login-passkey-mk-observation.test.tsx` (from `feat/050-papercuts`; real local account, real P-256 passkey with PRF, software authenticator, the real Login page): 3 of 3 pass against `master`, that is, they pin the fault.

**A second consequence found while reading (not reproduced):** `onboarding/invitation/confirm.tsx:136` decides "late link" by `!!localSession && !!localMk`. A local-only user who unlocked with a passkey and taps *Link to server* (`app/account/server-linking.tsx:151`) is therefore treated as a fresh PWA: the form asks for a new username, and on submit `wipeClientDataForFreshOnboarding` clears the device's client data before a new identity is created. The fix below removes this path too, because `localMk` is then set.

## 2. The decision

**Decided by Chris, 2026-11-18, on the coordinator's recommendation: the small fix.** The passkey path hands the raw MK to the session store exactly as the passphrase path already does. *Because* it removes the fault for every consumer at once, and it creates no new kind of exposure: after a passphrase unlock the raw MK already sits in the same store today.

**Not in this unit** (the thorough fix, ledger row "Raw MK in login-flow returns — tighten MK custody"): removing the raw MK from the store and moving every consumer onto the encapsulated session. Nothing here widens what holds the raw key beyond what the passphrase path already does. If the build finds that the small fix is not small, it stops and reports.

## 3. Design

### 3.1 The crypto flow's return shape

`loginWithLocalBiometric` returns `LoginLocalResult`, the type `loginLocalWithPassphrase` and `loginLocalWithRecoveryKey` already return:

```ts
export async function loginWithLocalBiometric(
  args: LoginWithLocalBiometricArgs,
): Promise<LoginLocalResult>; // { session: MasterKeySession; mk: MasterKey }
```

- `mk` is **the same `Uint8Array`** that `createMasterKeySession` captures, never a copy, exactly as `unwrapAndOpenSession` in `login-local.ts` does. So `session.close()` zeroes the store's slice in the same `fill(0)`, and the two can never disagree.
- Everything before the return is unchanged: assertion verification, sign-counter check and persistence, PRF-derived AMK, the integrity HMAC, the AEAD unwrap, the session's `userId`, `username`, `mode` and `online`. No wrapped blob, PRF salt, AAD, credential row or wire format changes.
- `LoginLocalResult` is moved, not duplicated: it stays declared in `login-local.ts` and `login-biometric.ts` imports it. Its JSDoc ("for callers that need to re-wrap…") gains "and for the session store's raw-MK slice". The package's public export list gains nothing: the type is already exported.
- This is a breaking change of a public LGPL function's return type. Its one caller is `routes/login/index.tsx`; the observation test calls it too and is rewritten (§5).

### 3.2 The Login page

`handleBiometricUnlock` destructures `{ session, mk }` and calls `activateSession(session, mk)`. Nothing else in `routes/login/index.tsx` changes, so the papercut unit's `need=passphrase` additions merge beside it.

### 3.3 `activateSession` and `setSession` afterwards

Every unlock and onboarding path now has an MK, so the "omit `mk`" case of `activateSession` has no legitimate caller left.

- **`activateSession(session, mk)` takes `mk: MasterKey` as a required parameter.** A future unlock path that forgets it fails `pnpm typecheck`, not a user's phone. The JSDoc sentence "omit it to preserve the existing raw-MK slice (e.g. the passkey path, which sets no raw MK)" is replaced by "Every unlock path holds the MK it just unwrapped and passes it here; the passkey path does too since 0.5.0." The sentence about the identity guard running on `deriveDek` stays true and stays.
- **`setSession(session, mk?)` keeps preserve-on-omit** for partial updates of an already unlocked session (the late-link branch of `onboarding/invitation/confirm.tsx:224`, which turns `mode` into `'linked'`, relies on it, and so does its store test). **New invariant: an active session with a null MK cannot be created.** `setSession` called without `mk` while the store's `mk` is `null` throws `Error('setSession: refusing to open a session without a master key')` and changes nothing. This is Q1.
- `closeAndForget()` is unchanged: it is the one way to clear both slices, together.

With 3.3 in place the only states the store can be in are `{ session: null, mk: null }` and `{ session, mk }` with both set. (`useSessionStore.setState` bypasses `setSession`; it is used only by tests.)

### 3.4 Lifetime of the raw key on this path

The passkey path now goes through the same store slots by the same function as the passphrase path, so its lifetime is identical by construction. Per event:

| Event | Passphrase path today | Passkey path after this unit |
|---|---|---|
| Unlock | `mk` buffer shared by the session closure and `store.mk` | the same |
| Login handler returns | local `mk` binding goes out of scope; store holds the only long-lived reference | the same |
| Sign out (`account/logout.tsx:50`) | `closeAndForget()`: `session.close()` → `mk.fill(0)`, then both slices `null` | the same |
| Interactive refresh refused (`lib/fetch.ts:231`) | `closeAndForget()` as above | the same |
| Wipe device (`lib/wipe-device.ts:150`) | `closeAndForget()` as above | the same |
| Background refresh refused, doorbell refusal | auth-degraded latch; the session and MK stay (by design, §5.2 of the sync-lifecycle spec) | the same |
| NSFW panic (`lib/nsfw-panic.ts`) | aborts adult streams and navigates; never touches the session or MK | the same |
| Tab close, reload, service-worker update | memory only, nothing persisted (`protected-route.tsx`); the next start is a cold start | the same |
| Lock | there is no separate lock; "locked" is the cold-start state above | the same |

What the passkey path holds besides the MK is unchanged: the PRF output and the derived AMK live only in `loginWithLocalBiometric`'s frame, as the passphrase AMK lives only in `loginLocalWithPassphrase`'s. Neither path zeroises its AMK today; this unit does not change that and does not widen it.

**Pre-existing in both paths, not changed here:** if `activateSession` throws after the unwrap (the identity guard), the freshly created session is neither stored nor closed, and its buffer is left to the garbage collector. A new unlock while a session is already active replaces it without closing the old one. Both are listed for Larissa to judge; the build does not touch them unless she rates them above low.

### 3.5 Every other path that can activate a session

Searched for every `activateSession(` and `setSession(` call in `apps/` and `packages/`.

| Path | Activates a session? | Same fault? |
|---|---|---|
| Login, passphrase, local-only (`login/index.tsx:178`) | yes, with `mk` | no |
| Login, passphrase, linked (`loginOnlineLinked`, `:153`) | yes, with `mk` | no |
| **Login, passkey, local-only or linked (`:259`)** | yes, **without `mk`** | **yes, the fault** (a linked account's passkey sign-in is this same local unlock: there is no server passkey login in the client) |
| Recovery-key login (`login/recovery.tsx:199,205`) | yes, with `mk` | no |
| Onboarding: local, invitation (fresh), pairing, recovery-from-scratch | yes, with `mk` | no |
| Onboarding: invitation late-link (`invitation/confirm.tsx:224`) | `setSession` partial update, preserving `mk` | no (it requires `mk` to enter; after this fix a passkey-unlocked user enters it correctly, see §1) |
| `lib/server-passkey.ts` (add a server-synced passkey) | no; reads `session` and `mk`, throws without them | consequence only, fixed by this unit |
| Step-up (`lib/step-up-assertion.ts`, `StepUpModalHost.tsx`) | no; reads `accessToken` only | no |
| Post-onboarding biometric prompt (`PostOnboardingBiometricPrompt.tsx`) | no; registers a credential on the open session | no |
| Re-authentication after auth degrade | no separate path: the user unlocks on `/login`, which is one of the rows above | covered by the passkey row |
| Refresh (`lib/fetch.ts:180`, `updateAccessToken`) | no; spreads the session, `mk` slice untouched | no |
| Admin client (`admin-client/src/routes/login/index.tsx:128`) | yes, passphrase only, with `mk` | no |

### 3.6 Adjacent observations, not fixed here

Found while reading; each is reported for the ledger rather than built, because each changes behaviour beyond "hand over the MK".

- **The passkey session of a linked account says `mode: 'local'`.** `loginWithLocalBiometric` hard-codes `mode: 'local', online: false` and carries no access token, while `loginOnlineLinked` says `'linked'`. The token arrives on the first 401 through the refresh cookie (`lib/fetch.ts:72`, `sync/blob-transport.ts:143`), and connectivity becomes `linked_online` through the discovery probe (`discovery.store.ts:84`), so sync does not depend on `mode`. Two readers do: *Add passkey* (`app/account/biometric.tsx:174`) registers a local-only passkey instead of a server-synced one, and the post-onboarding biometric prompt stays hidden. Proposed ledger row: "Passkey unlock of a linked account yields `mode: 'local'`".
- **No crypto unit test covers `loginWithLocalBiometric` at all today** (`packages/crypto/tests/flows/biometric.test.ts` covers registration only). §5 adds them.

## 4. What does not change

- Wrapped MK blobs, the PRF input salt (`PRF_INPUT_SALT`), the AMK derivation, AADs, integrity HMACs, IndexedDB schema and rows, sign-counter handling.
- Any request to the auth, sync or proxy service; any wire type in `packages/shared-types`.
- ADR 0005 holds: every passkey can both authenticate and unwrap the MK; this unit makes the client honour the second half.

## 5. Tests (written first)

1. **Crypto unit tests** (`packages/crypto/tests/flows/login-biometric.test.ts`, Bun, new): after `createLocalAccount` and `completeLocalBiometricRegistration`, a valid assertion returns `{ session, mk }` where `mk` equals the account's MK bytes; `session.close()` zeroes that same `mk` (shared buffer, not a copy); a wrong PRF output throws `integrity_check_failed` and returns nothing; an unknown credential throws `not_found`; the persisted sign counter advances. Assertions are signed by a software P-256 authenticator in the test.
2. **The regression test** (`apps/user-client/tests/routes/login-passkey-mk-regression.test.tsx`, renamed from the observation file, which this unit owns from now on): the three observations flip.
   - From a cold start, the Login page's passkey button unlocks; the store's `mk` is set and byte-equal to the account MK; a send gets past the master-key check and reaches the stream manager.
   - The PRF salt asked for is still `PRF_INPUT_SALT` (pins "nothing about the salt changes").
   - **Sync gate opens:** on a linked fixture (`useAccountLinkStore` linked, connectivity `linked_online`), after the passkey unlock `isClass2Allowed()` is `true` and the sync trigger's lock→unlock subscription fires one cycle (spy on the cycle runner).
   - **Late link:** after the passkey unlock, the invitation confirm screen takes the late-link branch (no username field).
3. **Store invariant** (`packages/ui-shared/tests/state/session.store.test.ts`): `setSession(session)` on an empty store throws and leaves `{ session: null, mk: null }`; the existing preserve-on-omit test for an unlocked store still passes.
4. **`activateSession`** (`apps/user-client/tests/boot/activate-session.test.ts`): sets both slices; the existing `activateSession({} as never)` call gains an `mk`.
5. `pnpm test`, `pnpm typecheck`, `pnpm run build`, Biome. The auth-service and sync-service suites need a Postgres; the report says whether they could run (this unit does not touch them).

## 6. Prompt-cache consistency

This unit changes nothing that is sent to a provider: it only decides whether a send can start, not what it sends.

## 7. Open questions for Chris

- **Q1. Should an active session without a master key be impossible (`setSession` throws), or only discouraged (`activateSession`'s `mk` required, `setSession` unchanged)?** **Recommendation: impossible.** Because the compile-time check covers only callers of `activateSession`, while the 2026-05-20 insight (`mk` lost after a disconnect) shows how a half-session arises from a partial `setSession` elsewhere and fails silently. A throw turns such a future slip into a visible error in a test instead of a quiet "sync never starts". Cost: one guard and one test; no production caller needs to change.
- **Q2. Fix "linked passkey session says `mode: 'local'`" (§3.6) now or later?** **Recommendation: later, as its own ledger row**, because it changes which kind of passkey *Add passkey* registers and which prompt shows, which is behaviour and copy, not key custody, and would grow this unit beyond the small fix.
- **Q3. The papercut unit's `need=passphrase` mode** greys the passkey button with "This needs your passphrase". After this fix that copy is untrue: a passkey yields the MK too, and with Q1 the "master key unavailable" detour can only be reached when there is no session at all, where the protected route already redirects. **Recommendation: once both PRs are merged, a one-line follow-up enables the passkey button in that mode** (keeping the mode, its focus and *Not now* as a defensive way out), because a disabled control with a false reason misleads, which Laura rates a hard defect. This unit does not change it; the coordinator assigns it.

## 8. Manual verification (Chris, on a real phone with a passkey)

Preparation: a phone with a passkey registered on Chatsundere (Account → *Authentication methods* lists it under "Biometric on this device"), one local-only account and, separately, one linked account with an existing chat on a second device.

1. **Cold start, local account.** Close the app completely (swipe it away), reopen it. On the sign-in screen tap *Sign in with passkey* and confirm with your fingerprint or face. *Pass:* you land in the app.
2. **Send.** Open a chat and send "Hello". *Pass:* the reply streams. There is no note saying Chatsundere needs your passphrase.
3. **Regenerate and memory.** Regenerate that reply; then on the persona's memory page tap *Consolidate now*. *Pass:* both work without asking for the passphrase.
4. **Provider key.** Settings → Providers → open the provider your chats use → *Test a model* on one of its models. *Pass:* the test runs (it may fail only for a reason the provider gives), never with a locked or missing key.
5. **Voice.** In a persona with a voice, play a reply aloud. *Pass:* you hear the persona's voice, not silence or a "no provider" fallback.
6. **Sign out and back.** Account → *Sign out*, then sign in with the passkey again and send once more. *Pass:* sending works again.
7. **Linked account syncing after a passkey-only cold start.** On the linked account: close the app completely, reopen, sign in **only** with the passkey (never type the passphrase in this session). On the second device, send a message in an existing chat. Back on the phone, wait up to a minute or switch away and back. *Pass:* the new message appears on the phone. Then send one from the phone: it appears on the second device. The sync status in Account → Server linking shows no error.
8. **Link a local account after a passkey unlock** (optional, needs a spare invitation). On a local-only account with chats, unlock with the passkey, Account → Server linking → *Link to server*, scan the invitation. *Pass:* the form asks only for your passphrase (no new username), and after linking your chats are still there.
