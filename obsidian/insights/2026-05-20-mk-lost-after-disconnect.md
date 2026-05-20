# `session.mk` disappears after a disconnect without a logout

**Status:** observed during Squash C Manual QA on 2026-05-20; not root-caused
yet. Workaround documented; deferred fix.
**Severity:** correctness, not security. The MK isn't leaked anywhere — it
just becomes unreachable from `useSessionStore.session.mk` while the rest
of the session object survives.

## What we saw

Sequence (single browser tab, no reload between steps):

1. Login as `primary_admin` against a server whose `users` table had been
   wiped by a stray test run. Login degraded to `mode: 'local'`,
   `serverOutcome: 'unreachable'`. `useSessionStore.session.mk` was set.
2. Settings → Server linking → Disconnect → confirm. IDB row removed
   (Layer B fix), UI flipped to "Not linked".
3. Scan/paste a fresh bootstrap invitation, type the passphrase, click
   Confirm.
4. `linking/confirm.tsx`'s pre-flight check found
   `useSessionStore.session.mk === undefined` despite
   `useSessionStore.session` itself still being a populated object with
   `mode: 'local'`. Bailed with `ce.unknown`, sent no request.
5. Logout → login again → the same re-link sequence succeeded.

## Why this matters

The failure is silent and looks like a server problem. From the user's
seat: "I disconnected, I scanned a fresh invitation, it told me
'Couldn't complete linking' and there were no network requests at all."
Without the temporary debug logging we added during this session, the
real cause is invisible.

## What we know is *not* the cause

- `handleDisconnect` in `apps/user-client/src/routes/settings/server-linking.tsx`
  does not call `setSession` or `closeAndForget`. It reads
  `useSessionStore.getState().session` and never writes back.
- `deleteServerAccount` in `packages/crypto/src/flows/server-account-delete.ts`
  only touches IndexedDB and the server. It does not have a reference
  to the in-memory session.
- `MasterKeySession.close()` zeroes the closure-captured `mk` byte
  buffer in place. *If* close() were called on the live session, then
  `mk.fill(0)` would zero the same `Uint8Array` that's also referenced
  from `useSessionStore.session.mk` — the property would still exist
  (no `undefined`), but be all zeros. Chris observed `hasMk: false`
  (i.e. falsy after `!!`), so close() is probably *not* the cause —
  unless somewhere we explicitly delete the property or rewrite the
  store with a copy that omits `mk`.

## Hypotheses to investigate

Ranked by what I'd check first:

1. **A redirect or remount path between disconnect-completion and the
   linking screen calls `setSession({...currentSession, ...something})`
   without spreading `mk` back in.** Suspect candidates: the
   `connectivity` transition fired by disconnect (`setState({ kind:
   'local_online' })`); the navigation from /settings/server-linking
   to /linking/{paste,scan} crossing a route gate that sanitises the
   session; or an `App.tsx`-level effect that re-derives a "public"
   session shape and overwrites the store entry.
2. **A `JSON.parse(JSON.stringify(...))` somewhere on the session
   object.** `Uint8Array` does not survive that round-trip and would
   become a plain object or be dropped depending on the path.
3. **A storage middleware on the zustand store** (e.g. `persist`) we
   haven't yet wired but maybe inherited from an example. Pre-emptive
   check: `useSessionStore` definition is plain `create(...)`, no
   `persist`, so probably not.

## Workaround

Logout (Settings → Account → Sign out) then log in again. The fresh login
populates `mk` cleanly. We documented this in the Manual QA notes for
Squash C so Chris can finish the QA pass without being blocked.

## Fix shape, when we get to it

The right answer probably isn't "patch the disappearing spot"; it's
"make the store own the lifecycle of `mk`". Options:

- Keep `mk` inside the `MasterKeySession` closure exclusively (where it
  already conceptually lives) and have callers reach in via session
  methods only. The store would store the session and never see the
  raw MK. Anything that needs the raw MK — recovery-key regeneration,
  link-to-server — would acquire it through a session method that
  consumes it (single-use) rather than reading it from the store.
- If we want to keep the current ergonomics, add a unit test that
  reproduces "disconnect, then re-link without logout" and catches
  the property loss. Anything subtle enough to slip past code review
  needs a test.

Decision deferred until after Squash C lands and we can give this its
own focused session.

## Cross-references

- [[follow-ups-index]] — Active — Implementation row.
- Related security follow-up: "Raw MK in login-flow returns — tighten MK
  custody" (already on the list); this insight is concrete evidence that
  the tightening is overdue.
