# Admin console: resolve the auth URL at runtime, not at build time

**Date:** 2026-07-14
**Status:** Approved by Chris
**Author:** Liz

## 1. Problem

The admin console at `https://<app-host>/admin/` renders nothing — only the
application background. It has never worked in the production image.

`apps/admin-client/src/env.ts:15` runs a valibot parse at module scope:

```ts
const EnvSchema = v.object({
  VITE_AUTH_URL: v.pipe(v.string(), v.url()),
  VITE_SYNC_URL: v.pipe(v.string(), v.url()),
  VITE_PROXY_URL: v.pipe(v.string(), v.url()),
  VITE_USER_CLIENT_URL: v.optional(v.pipe(v.string(), v.minLength(1)), '/'),
});
export const env = v.parse(EnvSchema, import.meta.env);
```

`main.tsx` imports it transitively, so the parse runs before `createRoot`.
Nothing supplies the three required URLs to the production build:
`apps/user-client/Dockerfile:60` builds the admin with `VITE_BASE=/admin/` and
nothing else. They exist only in `apps/admin-client/.env.example` with
`localhost` values. In the image they are `undefined`, the parse throws, React
never mounts, and the page shows the stylesheet's background with an empty
`#root`.

Latent since `f301478e` (2026-07-07) baked the admin into the frontend image.

### 1.1 Why it looked like a client bug

Two independent defects produce the identical symptom, which is why the obvious
discriminating test did not discriminate:

1. The user-client's service worker (scope `/`, `navigateFallback:
   '/index.html'`) shadowed `/admin/` because the path was absent from
   `navigateFallbackDenylist`. Fixed separately in `a20a11c7`.
2. This defect.

In a normal window (1) serves the user-client shell. In a private window there
is no service worker, so (2) throws instead. Both render background-only. `curl`
bypasses both and returns correct admin HTML, which pointed at the client.

### 1.2 Root cause

Design drift. The user-client migrated to runtime discovery in WS0
(`apps/user-client/src/lib/server-urls.ts`): *"Discovery is the source of truth
for service URLs (spec §9). The VITE_* values are dev-only overrides — honoured
exclusively under the Vite dev server […] so a production build can never pin a
stale URL."* Its `env.ts:18-20` makes all three `v.optional`.

The admin-client predates that decision (plan of 2026-05-20) and was never
migrated. A build-time deployment constant survived into a deliberately generic,
multi-operator image. No review caught it because dev and prod were each
internally consistent.

## 2. Decision

The linked account row in the crypto IndexedDB is the source of truth for the
admin's auth base URL. The admin has no entry point of its own: with no linked
account it is a signposted dead end pointing at the user-client.

Rejected alternatives:

- **Own entry point** (admin asks for server URL + login itself) — duplicates the
  onboarding flow and raises the question of where its account row would live.
- **Derive from own origin** — impossible here: the admin is served from the app
  host, auth lives on a separate host.

`packages/crypto/src/db/schema.ts:28` already carries what is needed:

```ts
server_user_id: string;
base_url: string;                          // the bootstrap
role: 'primary_admin' | 'admin' | 'user';
```

This is precisely why the admin is served same-origin (Dockerfile step 5): so it
can read that row.

### 2.1 The signposted dead end already exists

`apps/admin-client/src/routes/login/failure-states.tsx` implements
`NoAccountFailure`, `NoLinkFailure`, `OfflineFailure` and `NotAdminFailure` —
each with copy and a button to the user-client.
`apps/admin-client/src/routes/login/decision-tree.ts` classifies into them and
`routes/login/index.tsx` renders them. The chosen behaviour is fully built. It
has simply never run, because the module-scope parse throws first.

`decision-tree.ts` already reads the row it needs:

```ts
const linked = await getLinkedAccount(db);
if (!linked) return { branch: 'no_link' };
```

It discards `linked` and returns only a branch. The information the admin needs
to function passes through this function on every start and is thrown away.

## 3. Architecture

Publish what the decision tree already reads; consume it through the shared
store the user-client already uses.

```
crypto IDB: linked_account.base_url
  → decision-tree.ts: useAccountLinkStore.setLinked(row)
  → server-urls.ts: effectiveAuthUrl()
  → data/api.ts (12 call sites)
```

`packages/ui-shared/src/state/account-link.store.ts` already holds `baseUrl` and
`role` and is already populated from this row for the user-client. Reusing it
means no new state concept, no second IndexedDB open, no retained handle
(`decision-tree.ts` keeps its `db.close()` in `finally` — only data is
published), and no new dependency: `main.tsx:7` already imports from
`ui-shared`.

Discovery (`probeServer`) is deliberately **not** involved. It yields `syncUrl`
and `proxyUrl`, which the admin does not use (§4.1), and it needs an auth base
URL to run — it cannot supply the bootstrap.

## 4. Changes

### 4.1 `apps/admin-client/src/env.ts`

Drop `VITE_SYNC_URL` and `VITE_PROXY_URL` outright — measured usage in
`apps/admin-client/src` is **zero** for both. They are schema-only ballast from
the 2026-05-20 plan, and two of the three values that crash the app.

Make `VITE_AUTH_URL` optional, mirroring `apps/user-client/src/env.ts:18-20`:

```ts
const EnvSchema = v.object({
  VITE_AUTH_URL: v.optional(v.pipe(v.string(), v.url())),
  VITE_USER_CLIENT_URL: v.optional(v.pipe(v.string(), v.minLength(1)), '/'),
});
```

After this the parse cannot throw on a production build, which is the actual
safety property. It still throws for a malformed `VITE_AUTH_URL` in dev — a
developer misconfiguration that should be loud.

`VITE_USER_CLIENT_URL` is unchanged: already optional with default `/`, one
consumer (`routes/login/failure-states.tsx:7`), and it never throws.

### 4.2 `apps/admin-client/src/lib/server-urls.ts` (new)

Mirrors `apps/user-client/src/lib/server-urls.ts`, including its dev-override
rule, so a production build can never pin a stale URL and tests never inherit a
developer's `.env`:

```ts
function devOverridesActive(): boolean {
  return import.meta.env.DEV && import.meta.env.MODE !== 'test';
}

export function effectiveAuthUrl(): string {
  const override = devOverridesActive() ? env.VITE_AUTH_URL : undefined;
  const url = override ?? useAccountLinkStore.getState().baseUrl;
  if (!url) throw new Error('No linked account — the pre-login decision tree must run first');
  return url;
}
```

### 4.3 `apps/admin-client/src/routes/login/decision-tree.ts`

Publish the row it already read: `setLinked(linked)` on the `ready` path,
`setLocalOnly()` on `no_link`. No new read, no signature change to
`PreLoginResult`.

`ui-shared` also exports `initAccountLinkFromDb(db)`, which the user-client uses
to populate the same store at boot. The admin deliberately does **not** use it:
that would open the crypto IDB a second time to read a row the decision tree
reads anyway, and would race the decision tree's own read. `setLinked` takes
exactly `Pick<LinkedAccountRow, 'base_url' | 'issuer_label' | 'role'>`, so the
row is passed through as-is with no adapter.

### 4.4 `apps/admin-client/src/data/api.ts`

Replace `baseUrl: env.VITE_AUTH_URL` with `baseUrl: effectiveAuthUrl()` at all
twelve call sites; drop the now-unused `env` import.

## 5. Error handling

`effectiveAuthUrl()` throws rather than returning `string | null`.

The pre-login decision tree guarantees a linked row exists before the login form
renders, and all twelve `api.ts` functions run only after login. A missing
`baseUrl` there is therefore not a user state but a programming error — a route
wired past the login, say. Throwing names that fault where it happens; the throw
surfaces through TanStack Query as a query error.

Returning `null` would push twelve null-checks into the call sites to handle a
case the decision tree already excludes, and would defer diagnosis to a point
where the context is gone. Chris's call, and his standing preference: fail fast,
fail early.

This is not defensive error handling for an impossible scenario (CLAUDE.md §10) —
it is a named assertion of an invariant the architecture relies on.

## 6. Testing

- `tests/unit/data-api.test.ts:10` currently mocks `env: { VITE_AUTH_URL:
  'http://auth.test' }`. Move the mock to `effectiveAuthUrl`.
- **Regression test for this bug, structural:** with no `VITE_*` whatsoever in the
  environment, the admin mounts and renders a failure state rather than throwing.
  This is the test that would have caught it.
- Dev-override semantics, mirroring the user-client: the override is honoured
  under `DEV`, ignored under `MODE === 'test'` and in a production build.
- `effectiveAuthUrl()` throws with no linked account and no override.

## 7. Out of scope

- The service-worker denylist fix — already committed as its own unit
  (`a20a11c7`). Necessary but not sufficient for a working admin; both are
  required.
- Laura spec-pass — no user-reachable flow is added or altered. The four failure
  states exist unchanged; this change only makes them reachable.
- Larissa — `apps/admin-client/**` is outside her paths and nothing
  cryptographic changes. The row is read through the existing `@chatsundere/crypto`
  accessor.

## 8. Manual verification

Chris runs these himself, against the deployed image:

1. On the PC with the linked account, open `https://app.chatsundere.me/admin/`
   after a cold start (all tabs closed — the service worker activates silently on
   next cold start, `apps/user-client/src/sw/register.ts:4-10`). The login form
   renders.
2. Log in as the primary admin. The user list loads — i.e. `api.ts` reaches the
   auth host through the account's `base_url`, with no `VITE_*` present.
3. Open `/admin/` in a private window (no account on that origin). Expect
   `NoAccountFailure` with a working button back to the user-client — not a blank
   page.
4. On the phone, same as (1) to confirm the URL is not pinned to one device.
5. `dev.sh` still serves the admin at `localhost:5174` through the Vite proxy,
   with `VITE_AUTH_URL` from `.env` honoured as a dev override.
