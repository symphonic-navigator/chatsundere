# Spec — Client-data identity isolation (wipe-on-identity-change)

Status: IMPLEMENTED · 2026-07-06 · Author: Liz
Larissa: **CLEAR TO SQUASH** (3 rounds). Initial audit CLEAR + LOW-1 (adoption
window). The LOW-1 fix (wipe-before-persist) introduced HIGH-1 (wipe could fire
before the crypto `conflict` backstop on the three unguarded onboarding routes →
returning-user data loss); closed by gating the onboarding wipe on a fresh device
(`wipeClientDataForFreshOnboarding` wipes only when no local account exists). One
non-blocking INFO carried: the onboarding wipe now has a single chokepoint — a
future onboarding route must route its pre-persist wipe through it.

## Problem

The client-data database (`chatsundere_client_data`, a fixed name) is **never
cleared when the local identity / MasterKey changes**. The only code path that
deletes it is `wipeDevice()` (`lib/wipe-device.ts`), reached solely from the
explicit **"Start over"** action (`routes/login/start-over.tsx`).

The crypto DB, by contrast, holds exactly **one** local account at a fixed key
(`getLocalAccount` → `store.get('primary')`), overwritten on each new identity.
So when a device establishes a **new** identity (register / recover-from-scratch
/ join) the crypto DB gets the **new MK**, but the client-data DB keeps the
**previous identity's rows**, sealed under the **old MK**.

Result: a **mixed-MK client-data store**. Old-MK rows cannot be decrypted by the
current MK → `OperationError` at `openSecret` (`lib/secrets.ts:76`). Observed
live 2026-07-06 (Chris's device): **two `nano-gpt` provider rows** — one old-MK
(`019e5e81…`, referenced by a persona) + one new-MK (`019eb342…`). Every send on
the old-MK provider throws; a re-login "resurrects" the stale identity's data.

This is a data-isolation defect and a v0.2.0 release blocker (Chris, 2026-07-06).

## Root cause

No binding between the client-data (and knowledge-vectors) stores and the account
identity, and no wipe on identity change outside the explicit Start-over. Any
identity establishment that is not Start-over leaves the prior identity's local
data in place.

## Design

### Primary mechanism — boot-time identity guard (MK-fingerprint binding)

Bind client-data to the **MK identity** directly, not to the flows (fewer call
sites to get right; covers every path that changes the MK, including ones added
later).

- **Fingerprint:** a deterministic, **non-secret, one-way** tag derived from the
  session MK — `tag = SHA-256(deriveDek(mk, 'client-data/identity-binding-v1'))`
  (reuses the existing HKDF-based `deriveDek`; the stored value is a hash of a
  derived sub-key, never the MK, and never leaves the device). New helper
  `deriveClientDataIdentityTag(mk)` in `packages/crypto` (LGPL).
- **Storage:** the tag lives on the existing `settings` row (id `1`) as a new
  **unindexed** field `identityTag?: string` — **no Dexie version bump** (per the
  "unindexed fields ride free" rule), so no `verno` test churn and no
  parallel-work collision.
- **Guard** `enforceClientDataIdentity(mk)`, run once at boot **after** the MK is
  available (session set post-unlock) and **before** the app reads/writes
  client-data:
  - stored tag **absent** → adopt: write the current tag (first run / legacy).
  - stored tag **== current** → same identity, proceed untouched.
  - stored tag **!= current** → **wipe client-data + knowledge-vectors** (close
    handles, `Dexie.delete`, mirroring the client-data portion of `wipeDevice`),
    reopen empty, write the current tag.

This one guard covers every case:

| Scenario | MK | Tag compare | Action |
|---|---|---|---|
| Register a new account | new | mismatch (or absent) | clean start |
| Recover account X on a device holding Y's data | X | mismatch | wipe Y's data |
| Same-account re-login (online or offline) | same | match | keep |
| Change username / passphrase / recovery key | unchanged | match | keep |

### Defense-in-depth — explicit wipe on new-account creation

At `create-local-account` completion in the client (fresh register), proactively
wipe client-data + knowledge-vectors before first use. Redundant with the guard
but immediate and explicit. (This is the "both" Chris approved; note the guard
already subsumes it — kept as belt-and-braces, not the primary defence.)

### Legacy / migration

Pre-fix installs have no tag. A **tag-less, non-empty** store is treated as
"adopt current identity" (write tag, keep data) — we must not nuke a legitimate
single-identity user who simply predates the tag. The resurrection only bites on
an actual MK change, which post-fix always writes a tag, so future contamination
is prevented. Already-contaminated pre-fix devices (like Chris's) are cleared by
the Start-over reset, not by this migration.

## Integration points

- `packages/crypto/src/primitives/` — `deriveClientDataIdentityTag(mk)` + tests.
- `apps/user-client/src/boot/client-data-db.ts` — `identityTag?` on the settings
  row type; a `wipeClientDataStores()` helper (close + `Dexie.delete` for
  client-data + knowledge-vectors, reusing the existing close helpers).
- `apps/user-client/src/boot/` — `enforceClientDataIdentity(mk)` guard.
- Boot wiring (`routes/root.tsx` / boot store) — call the guard after the session
  MK is set and before `/app` renders; block render until it resolves.
- `flows/create-local-account` client caller — defence-in-depth wipe.

## Test plan (TDD, key-free — runs in CI)

- crypto: `deriveClientDataIdentityTag` is deterministic, differs across MKs, and
  the output is not the MK/DEK (one-way).
- guard unit (fake-indexeddb): absent→adopt (no wipe); match→no wipe; mismatch→
  wipe called + tag rewritten.
- integration: seed client-data with tag A + provider/persona rows → boot with MK
  B → rows gone, tag B present; boot again with MK A → (fresh) rows persist for A.

## Larissa gate

Crypto/auth data-isolation change → Larissa audits the fingerprint derivation
(one-wayness, no MK leak, AAD/context separation), the wipe completeness (both
stores, handle-close ordering like `wipeDevice`), and the legacy-adopt policy,
before squash.

## Manual verification (Chris, device)

1. Start over → onboard as user X → add a provider + a chat.
2. Log out → onboard/recover as a **different** identity Y.
3. Confirm X's provider/chat are **gone** (not resurrected), no `OperationError`.
4. Re-login as the current identity → its data intact across reloads.
