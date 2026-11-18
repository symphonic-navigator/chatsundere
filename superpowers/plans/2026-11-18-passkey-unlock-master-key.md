# Plan — passkey unlock hands the master key to the session store

**Spec:** [`superpowers/specs/2026-11-18-passkey-unlock-master-key-design.md`](../specs/2026-11-18-passkey-unlock-master-key-design.md), approved by Chris on 2026-11-18 (Q1 yes, Q2 later, Q3 follow-up by the coordinator).
**Branch:** `fix/050-passkey-master-key`. Larissa path (`packages/crypto`).
**Discipline:** test-first in every task: write or flip the test, see it fail for the right reason, then change the code, see it pass. One commit per task. Subagents never merge, push or switch branches. British English everywhere.

**Commands.** Package builds must exist before the user-client tests resolve `@chatsundere/crypto` (`pnpm run build` at the root once, then again after a change in `packages/*`). Crypto tests: `cd packages/crypto && bun test tests/flows/login-biometric.test.ts`. ui-shared: `cd packages/ui-shared && pnpm test`. User client: `cd apps/user-client && pnpm exec vitest run <file>`.

**Out of bounds.** No change to wrapped blobs, `PRF_INPUT_SALT`, AMK derivation, AADs, IndexedDB schema, wire types or any service. In `routes/login/index.tsx` only `handleBiometricUnlock` changes (PR #58 edits the rest). No edits to `obsidian/STATUS-*.md`, `obsidian/insights/*`, `superpowers/open-items.md`, `CHANGELOG.md`. No `close()` on a stored session anywhere except `closeAndForget()` (spec §3.4.1).

## Task 1 — `loginWithLocalBiometric` returns `{ session, mk }` (spec §3.1)

- New `packages/crypto/tests/flows/login-biometric.test.ts` (Bun). A software P-256 authenticator signs real assertions (port the helpers of `apps/user-client/tests/routes/login-passkey-mk-regression.test.tsx`: COSE key, DER signature, authenticatorData with counter). Fixture: `createLocalAccount` + `completeLocalBiometricRegistration` (see `tests/flows/biometric.test.ts` for the DB setup). Cases:
  1. valid assertion → `{ session, mk }`, `mk` byte-equal to the account MK;
  2. `session.close()` zeroes that same `mk` (all bytes 0 afterwards);
  3. wrong PRF output → `CryptoError('integrity_check_failed')`, and the stored sign counter is unchanged;
  4. bad signature → rejects in `verifyLocalAssertion`, sign counter unchanged;
  5. unknown credential → `CryptoError('not_found')`;
  6. sign counter advances on success.
- Code: return type `Promise<LoginLocalResult>` imported from `./login-local.js`; `const mk = asMasterKey(mkBytes)` passed to `createMasterKeySession` **and** returned (same object, no copy). Update `LoginLocalResult`'s JSDoc ("…and for the session store's raw-MK slice"). Add a JSDoc on `loginWithLocalBiometric`.
- The Login page caller breaks the user-client typecheck until Task 4; that is expected, do not touch it here.

## Task 2 — the store refuses a session without an MK (spec §3.3, Q1)

- `packages/ui-shared/tests/state/session.store.test.ts`: `setSession(session)` on an empty store throws `setSession: refusing to open a session without a master key` and leaves `{ session: null, mk: null }`; the existing preserve-on-omit case over an unlocked store still passes.
- Code `packages/ui-shared/src/state/session.store.ts`: in `setSession`, when `mk === undefined` and `get().mk === null`, throw before `set`. JSDoc of `setSession` and `closeAndForget` gains the §3.4.1 invariant in one sentence each ("A stored session is closed only here, which clears both slices together" / "Never `close()` a stored session or a spread of it; the session closure and `mk` share one buffer").

## Task 3 — `activateSession` requires `mk` and closes on a failed guard (spec §3.3, §3.4 F3)

- `apps/user-client/tests/boot/activate-session.test.ts` (keep the existing sweep test; give its call an `mk`; note PR #58 changes the sweep to `purgeExpiredTrash`, so keep the edit to that one call):
  1. sets both slices;
  2. guard throws → `session.close` called once, error rethrown, store unchanged;
  3. **re-unlock over an active session whose guard throws** → the first session is still in the store, its `mk` is not all zeros and `deriveDek` on it resolves (use real `createMasterKeySession` objects with two separate MK buffers).
- Code: `activateSession(session: AppSession, mk: MasterKey)`; `try { await enforceClientDataIdentity(session) } catch (e) { session.close(); throw e; }` then `setSession(session, mk)`. Rewrite the JSDoc per spec §3.3 and add the §3.4.1 sentence ("closes only the session it was handed, and only before it reached the store").
- Fix any typecheck fallout in callers (all pass `mk` already, except the Login page passkey handler which Task 4 fixes) and in test mocks.

## Task 4 — the Login page passes the MK; the regression test flips (spec §3.2, §5.2)

- Rewrite `apps/user-client/tests/routes/login-passkey-mk-regression.test.tsx` as a regression test (rename the `describe`, drop the "OBSERVATION" header comment, keep the authenticator and the fixture). Cases:
  1. cold start → Login page passkey button → `/app`; store `mk` set and byte-equal to the account MK (`mkCopy`); PRF salt is `PRF_INPUT_SALT`; a send reaches the stream manager;
  2. same buffer: keep `const held = store.mk`, `closeAndForget()`, assert `held` all zeros and both slices `null`;
  3. wrong PRF output from the authenticator → the passkey-unlock error copy shows, the store stays `{ session: null, mk: null }`;
  4. sync gate: with `useAccountLinkStore` linked and connectivity `linked_online`, after the passkey unlock `isClass2Allowed()` is `true`, and with `initSyncTriggers()` and the cycle replaced through `_setTriggerCycle` (`src/sync/triggers.ts`; reset with `_resetTriggersForTests`) the lock→unlock transition fires exactly one cycle.
  The old "control" case becomes redundant with case 1; drop it.
- Code: in `handleBiometricUnlock` only: `const { session, mk } = await loginWithLocalBiometric(…)`; `await activateSession(session, mk)`.

## Task 5 — late link after a passkey unlock (spec §3.6, F1 and F2)

- Tests (new `apps/user-client/tests/routes/invitation-confirm-latelink-passphrase.test.tsx`, harness as in `invitation-confirm-latelink-rename.test.tsx`):
  1. wrong passphrase → `loginLocalWithPassphrase` rejects `wrong_passphrase` → inline passphrase error, `linkToServer` never called;
  2. right passphrase → the proof session's `close()` is called, `linkToServer` called once, the store's `mk` untouched (still the same object, not zeroed);
  3. the store is emptied (`closeAndForget()`) while `linkToServer` is pending → after it resolves: `setLinked` and `resetEngineStateForNewLink` ran, the route is `/login`, no submit error is shown, `setSession` was not called.
- Existing late-link tests (`invitation-confirm-latelink-rename`, `invitation-replace-link`, `invitation-confirm-prefill`, `invitation-account-guard` and any other that reaches the late-link submit) mock `loginLocalWithPassphrase` to resolve a closable session.
- Code in `onboarding/invitation/confirm.tsx`, late-link branch only:
  - before `changeUsername`/`linkToServer`: `const proof = await loginLocalWithPassphrase({ db: getDb(), passphrase }); proof.session.close();`. Map `CryptoError('wrong_passphrase')` to the existing passphrase field error (reuse the copy the form already uses for a wrong passphrase; if none exists, use `copy.login.errors.wrongPassphrase`) and return to the form.
  - after `linkToServer`: `const live = useSessionStore.getState().session;` If `live` is null: `onServerOk()`, `setLinked` from `getLinkedAccount`, `await resetEngineStateForNewLink()`, `navigate('/login', { replace: true })`, return. Otherwise `setSession({ ...live, username: …, mode: 'linked' })` and continue as today.

## Task 6 — gates and review

- Root: `pnpm test`, `pnpm typecheck`, `pnpm run build`, `pnpm lint` (Biome). Record the numbers. The auth-service and sync-service suites need a Postgres: record whether they ran.
- Liz reviews the whole diff against the spec, then summons Larissa on the diff. Critical and high findings are fixed, not deferred.
- Merge `master` in; the last commit on the branch must not carry `[skip ci]`.
