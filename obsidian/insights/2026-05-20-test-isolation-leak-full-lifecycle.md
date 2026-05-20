# Test isolation leak: `full-lifecycle.test.ts` wipes the live `auth_db`

**Status:** documented; fix deferred to a dedicated test-isolation squash.
**Discovered:** 2026-05-20 during Squash C Manual QA.

## What happened

I ran `pnpm test` in `apps/auth-service` repeatedly while debugging the
OPAQUE identifier mismatch and the wire-field-name drift. Each run executed
`tests/integration/full-lifecycle.test.ts`, whose `beforeAll` block contains:

```ts
const { db } = createDb();
await db.update(invitations).set({ createdBy: null, redeemedByUserId: null });
await db.delete(authMethods);
await db.delete(users);
await db.delete(invitations);
```

`createDb()` reads `DATABASE_URL` from the environment. The dev `.envrc`
points that at the live `auth_db`. There is no `TEST_DATABASE_URL` override,
no transaction-rollback wrapper, and no random prefixing. Result: every test
run is a full live-DB truncation.

Chris's `primary_admin` user got deleted mid-debug-session. The user-client
IDB still held a `linked_account` referencing the (now-vanished) server user,
which produced a cascade of confusing symptoms:

- Login: OPAQUE returned a fake registration record (per-RFC anti-enumeration
  behaviour), client `opaqueLoginFinish` threw `CryptoError`, classified as
  `unreachable`, surfaced as "Could not reach server".
- Disconnect: blocked by a separate ordering bug in `deleteServerAccount`
  (see commit message of the bridge-fix), which silently left the IDB row
  behind on server-call failure.

## Why this is worth a dedicated entry, not just a one-liner

The combination is dangerous in a way neither half is on its own:

1. The truncating test passes happily on a clean DB or even on a polluted
   DB — it doesn't read what it deleted, so destruction is invisible.
2. The fallout *looks* like crypto bugs ("Could not reach server",
   "Couldn't complete linking"), so the natural debugging instinct is to
   poke at the crypto flows — not at test infrastructure.

If we don't fix this before any further dev session that exercises the
test suite, the next person (or me, next session) will lose work the same
way and waste hours diagnosing downstream symptoms.

## Fix options, ranked

1. **`TEST_DATABASE_URL` override** with a dedicated `auth_db_test` schema
   created in the dev compose. Cleanest separation; matches what most
   shops do. Test setup creates the schema if missing.
2. **Transaction-per-test** with savepoints, rolled back in `afterEach`.
   Works for serial test runners; harder with parallel.
3. **Random prefixes + WHERE-filtered cleanup**. Easy retrofit, but every
   test author has to remember to use the prefix.

My instinct is (1) — it's a one-time setup cost and makes the failure
mode impossible rather than discouraged.

## Out of scope for the current Squash

This is not a Squash C concern. Squash C is the admin-client; the live-DB
truncation predates it and would have hurt us regardless. Tracking via
[[follow-ups-index]] under Hygiene & Tooling so the next test-touching
session picks it up.

## Cross-references

- The disconnect-ordering bug that compounded this is fixed in the bridge
  commit that precedes Final-Squash C.
- General pattern: tests must not be able to corrupt dev data. Candidate
  for a future "test infrastructure principles" insight if we hit this
  shape again.
