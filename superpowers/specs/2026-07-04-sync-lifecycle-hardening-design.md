# Sync-Lifecycle Hardening & Device Decoupling — Design

- **Date:** 2026-07-04
- **Branch:** `worktree-sync-lifecycle` (off `full-backend-transition`)
- **Status:** Design — awaiting Laura spec-pass (Unit 3) and Chris review
- **Author:** Liz
- **Origin:** First multi-device backend test (2026-07-04). Two live defects surfaced when Chris paired a second browser (Chromium) against an established one (Vivaldi); this spec is the durable fix for both, plus the device-decoupling feature Chris requested alongside them.

---

## 1. Context & verified root causes

Two independent defects were diagnosed end-to-end during the first multi-device test. Both are confirmed against the code and the live backend, not inferred.

### 1.1 The pre-existing corpus never backfills (silent data stranding)

The late-link backfill pump (`apps/user-client/src/sync/backfill.ts`) only runs when `syncState.backfillPending === true` (guard at `backfill.ts:166`). On the established device the row carried `backfillPending: undefined` — **not** `false` — because the row predates the backfill fields on `SyncStateRow` and was never migrated.

- `getSyncState()` (`apps/user-client/src/sync/watermark.ts:32-40`) returns an existing row **verbatim** (`if (existing) return existing;`). The defaults from `defaultState()` (`watermark.ts:14-26`, which include `backfillPending: false`) are applied **only when the row is absent**. An existing row missing the optional fields never heals.
- No Dexie migration stamps the field. Top version is 33 (`client-data-db.ts:1201`); its `.upgrade()` touches only `updatedAt` on a few tables. There is no v34.
- Consequence: `undefined !== true` → the pump returns immediately → the entire pre-existing vault (personas, avatars, knowledge base, …) is never uploaded. Only post-link live-drain edits reach the server. Confirmed against the backend: 1 of 17 personas present, 0 blobs, before the manual fix.

**Safety property that frames every fix here:** `resetEngineStateForNewLink()` (`link-reset.ts:15-39`) and the proposed siblings touch **only** sync bookkeeping (`syncRows`, `syncOutbox`, `watermarkRev`, `epoch`, backfill flags). They never touch user-data tables. Therefore **over-arming / over-resetting the engine is non-destructive** — worst case is redundant re-upload traffic, which `apply.ts`/`recovery.ts` reconcile. The only data-loss paths are the wipe (Unit 4). This makes "arm on everything never transferred" the safe bias.

### 1.2 "Erase this device" leaves residue (incomplete wipe)

`wipeDevice()` (`apps/user-client/src/lib/wipe-device.ts:40-44`) deletes `chatsundere_client_data` **while the module-level Dexie handle is still open** (`getClientDataDb()`, `client-data-db.ts:1222,1248`; the sync loop runs on the main thread coordinated via `navigator.locks`, so the handle lives in the same context). The browser fires `onblocked`; the wipe treats `onblocked` as completion (`wipe-device.ts:31` resolves on blocked) and immediately `window.location.assign('/onboarding')` — the pending blocked delete is aborted by the navigation. **The DB survives intact, personas and all.**

The data DB has a permanent open handle → its delete blocks → data persists. Re-seeding is ruled out — boot seeds only built-in mindspaces + the settings singleton (`client-data-db.ts:1236`), never personas.

> **Correction (Larissa security audit, 2026-07-04).** An earlier draft of this section claimed the crypto DB `chatsundere` has *no* retained handle (reasoning only from the per-op `packages/crypto/src/db/open.ts`). That was wrong: `apps/user-client/src/boot/open-db.ts` caches the crypto connection in a module-level handle for the app's lifetime (`main.tsx` → `openDb()`), so the crypto DB has the SAME open-handle blocking risk as the data DB. Closing only the two Dexie handles would leave the crypto account material (wrapped MK, passkey-PRF-wrapped MK, local-account) surviving the wipe — a HIGH finding. Unit 4 (§6.1) therefore closes all THREE handles, including the crypto one, before deleting. The originally-observed "account gone, persona survived" asymmetry was timing/environment-dependent, not evidence of a missing crypto handle.

The wipe additionally ignores several persistence surfaces (see §5.4): **plaintext** chat drafts in localStorage, Cache Storage, the service-worker registration, and — the trust breach for a zero-knowledge product — it never revokes the device's server session, leaving a live HTTP-only refresh cookie on a device the user was told is erased.

---

## 2. Scope & decisions

Agreed with Chris on 2026-07-04:

- **Decoupling is per-device and reversible.** "Decouple this device" makes the device local-only: sync stops, local data stays, the device's server session is revoked. The **server account and other paired devices are untouched**; the device can re-link at any time. Deleting the whole server account is explicitly **out of scope**.
- **Naming:** the user-facing action is **"Decouple this device"** (working term "entkoppeln"). Rejected: "Go offline" (ambiguous with network state), "Disconnect from server" (which server?).
- **Confirmation:** decoupling uses a **typed-phrase gate** (the phrase `decouple`) — from the user's perspective it is a weighty action and should feel deliberate (Principle of Least Astonishment), even though it is technically reversible. Chris held this against Laura's advisory to reserve typed-phrase for irreversible actions (spec-pass, §8). The two existing wipes already use *inconsistent* idioms (typed-username on the logout-delete, typed-phrase `start over` on start-over); harmonising the confirmation grammar across all weighty actions is a separate follow-up (§11), not this scope.
- **Session revoke on both** decouple and wipe, via the existing `POST /api/v1/auth/logout` (bearer-auth, `apps/auth-service/src/routes/auth.ts:20`). The server account remains joinable; only *this device's* session is revoked. `DELETE /api/v1/me` is never called.
- **Server switch** needs no dedicated flow: it composes as *decouple → link to the new server* using the existing link path.

---

## 3. Unit 1 — Backfill robustness

**Purpose:** guarantee the backfill arms for everything never transferred, and heal legacy `syncState` rows so the `undefined` guard can never strand a corpus again.

**Mechanics:**

1. **Heal the shape.** In `getSyncState()` (`watermark.ts`), when an existing row is missing any optional field, merge in `defaultState()` values and persist once via `update`. `backfillPending` heals to `false` (a blind `true` would needlessly re-arm correctly-synced devices).
2. **Arm on "never transferred".** A boot/link-time reconciliation, idempotent and safe: if `linkStatus === 'linked'` and `backfillPending` is not already `true` and at least one local row across `BACKFILL_ORDER` has neither a `syncRows` CAS base nor a `syncOutbox` entry, set `backfillPending: true`. This is the direct realisation of the requirement and rescues already-stranded devices (unlike a heal-only fix or a v34 migration, which would normalise the shape but leave the stranded corpus un-rescued). Reuses the existing `listUnsyncedKeys` predicate (`backfill.ts:132-141`).

**Where it runs:** the reconciliation is invoked once per boot after link status is known, and after a successful link. It must run *before or at* the first sync cycle so the pump picks up the armed flag. Candidate site: the sync engine boot wiring that already registers the backfill (`worker.ts` `_setBackfill`) / boot foundation.

**Edge cases:** a device mid-backfill (`backfillPending` already `true`) is untouched. A fully-synced device finds no un-synced candidate and does not arm. `vectors` live in the separate knowledge DB; the predicate already handles that via `listLocalKeys`.

**Tests:** legacy row with `backfillPending: undefined` + un-synced rows → heals to `false` then arms to `true`; fully-synced linked device → stays `false`; local-only device → never arms.

---

## 4. Unit 2 — Transfer-state reset on decouple & server switch

**Purpose:** reset all transfer-state when a device goes local-only or changes server, and make the server-switch guarantee explicit rather than reliant on the runtime epoch/`bad_since` net.

**Mechanics:**

1. **`resetEngineStateForLocalOnly()`** — a sibling of `resetEngineStateForNewLink()` in `link-reset.ts`. Clears `syncRows`, `syncOutbox`, `watermarkRev`, `epoch`, and sets `backfillPending: false` (a local-only device has no engine; the *next* link re-arms via `confirm.tsx:181` and Unit 1's reconciliation). Does **not** touch user data.
2. **Server-identity tagging.** Add `linkedServerUserId` (the `server_user_id` from `LinkedAccountRow`) to `SyncStateRow` (`client-data-db.ts:575-588`). Stamp it inside `resetEngineStateForNewLink()`. At cycle start (`worker.ts` `canRunCycle`/`runSyncCycle`), if the stamped identity differs from the current `useAccountLinkStore` identity, force a reset+arm before running. This closes the future-path hole where a server change that bypasses `confirm.tsx:181` would rely solely on the epoch net (which *merges* rather than *arms*, so genuinely un-transferred local rows could remain unpushed).

**Dexie migration:** adding `linkedServerUserId` to `SyncStateRow` is a plain optional field (the `syncState` store is keyed by `id` only, no index change), so it needs **no** `stores()` change. Unit 1's heal covers rows missing it. Confirm no `expect(db.verno).toBe(N)` sweep is triggered — if a version bump is introduced for any other reason, the verno-assertion sweep applies (see the Dexie-bump follow-up register).

**Tests:** decouple clears all four bookkeeping fields; a cycle whose stamped server-id ≠ current id forces reset+arm; same-id cycle runs normally.

---

## 5. Unit 3 — Decouple-device UI + session revoke

**Purpose:** the user-facing "Decouple this device" flow — the trigger Chris asked to build, wired to Unit 2's reset.

### 5.1 Placement

The `linked` state of the Server-linking sub-page (`apps/user-client/src/routes/app/account/server-linking.tsx:97-132`), a new section **below** `AddDeviceSection`. The same surface already flips by state: when `local-only` it shows the "Link to server" CTA (`:77-95`), so after decoupling the screen naturally becomes the re-link entry point. No new route — decoupling is a transient begin→end operation, so it gets an inline confirmation, not its own navigable surface (consistent with the "transient ops get no surface" principle).

The dashboard badge hard-coded to "Local-only mode" (`account.tsx:158-159`, a Block-1 placeholder) becomes dynamic, reading `linkStatus` from the account-link store — this also removes a live misdirection (the badge currently reads "Local-only" even when linked).

Two Laura spec-pass polish notes (§8) land here: the Server-linking nav tile's meta (`account.tsx:189`, currently "sync across devices") is broadened to acknowledge it both establishes *and* ends the link, so a user in a "disconnect" frame of mind finds it; and the decouple affordance carries its own section heading (**"End this link"**) so it reads as a distinct, scannable zone rather than an afterthought beneath `AddDeviceSection` — verify at 380 px that a QR/pairing block above it does not push it far below the fold.

### 5.2 Flow

1. User opens Server-linking (linked) → taps **"Decouple this device"**.
2. Inline confirmation expands with a typed-phrase gate (§2) and constructive copy that explicitly distinguishes decouple from signing out (Laura soft, §8):
   > *This is different from signing out — it ends this device's link to the server. Your data stays on this device. Syncing stops. Your other devices keep their copies, and you can reconnect any time.*
3. On confirm, the decouple sequence runs (§5.3). While in flight, a calm progress line; on completion the surface re-renders to the `local-only` state with a brief, **reassuring** confirmation that names what remains — *"Your data is still here; your other devices still have their copies; link again any time"* — not a merely terminal "done" (the *dere* moment, Laura soft §8).

Copy is British English; exact wording is a soft matter for Laura/Chris. The typed phrase (e.g. `decouple`) is defined in `copy.ts` alongside the wipe's phrase.

### 5.3 Decouple sequence

All primitives exist; no new crypto primitive is needed.

1. `POST /api/v1/auth/logout` (bearer) — revoke this device's session; clears the refresh cookie server-side and deny-lists the session. A thin client helper wraps this (the client currently has no logout call; add one in `lib/`).
2. `deleteLinkedAccount(db)` (`packages/crypto/src/db/linked-account.ts:23`) — remove **only** the local `linked_account` row. Server account untouched (we deliberately do **not** call `deleteServerAccount`).
3. `useAccountLinkStore.getState().setLocalOnly()` (`account-link.store.ts:34`).
4. `resetEngineStateForLocalOnly()` (Unit 2).

**Ordering & failure handling:** the logout call is best-effort — a network failure must not strand the user in a half-decoupled state. If step 1 fails, still complete steps 2–4 locally (the local link is gone, engine reset) and surface a constructive note that the server session could not be revoked remotely and will expire on its own; offer retry. Steps 2–4 are local and ordered so the engine is reset last.

**Tests:** happy path flips to local-only + clears bookkeeping; logout failure still completes local decouple + raises the constructive note; the `linked_account` row is gone but user-data tables are intact.

---

## 6. Unit 4 — Complete wipe + session revoke

**Purpose:** make "Erase this device" actually erase everything, and revoke the server session so the device holds no live credential.

### 6.1 Complete-deletion sequence

1. **Stop the engine**, then **close every open handle** before deleting — ALL THREE: the client-data Dexie handle (`closeClientDataDb()`), the knowledge-vectors singleton (`closeKnowledgeVectorsDb()`), **and the raw crypto handle** (`closeDb()` in `boot/open-db.ts`, nulling both `dbHandle` and the in-flight `pending` promise). Nulling the module singletons stops anything re-opening mid-wipe. Defence-in-depth: `openLocalDb` registers `db.onversionchange = () => db.close()`. Reuse the pattern proven in `_resetClientDataDbForTests` (`client-data-db.ts:1259-1268`).
2. **Delete completion-aware.** `await Dexie.delete(name)` for the two Dexie DBs (closes + awaits real completion). For the raw crypto DB (`chatsundere`), keep `indexedDB.deleteDatabase` but **do not resolve on `onblocked`** — on blocked, wait/retry rather than reloading, so a delete is never silently abandoned.
3. **`POST /api/v1/auth/logout`** (bearer) before the wipe — the erased device holds no live server credential (decision C).
4. **Navigate only after deletions actually complete** — `window.location.assign('/onboarding')` last.

### 6.2 Non-IndexedDB surfaces the current wipe ignores

- **localStorage** — at minimum every `cockpit-draft-new:*` key (`cockpit-draft.ts:12`, **plaintext** user input). Simplest correct move: `localStorage.clear()` + `sessionStorage.clear()` (the app owns the origin).
- **Cache Storage** — `caches.keys()` → delete all (app shell, `fonts`, self-hosted `/model/` weights; the transformers.js/ORT poisoning surface).
- **Service worker** — `registration.unregister()` so the next boot serves a clean shell.

### 6.3 Product note (state in the UI, not a bug)

A *local* wipe cannot delete server-side ciphertext; a persona returns on a deliberate re-pair to the same account — this is by design (`start-over.tsx:56` already states the server account is not touched). It only holds honestly once §6.1.3 revokes the session, so an "erased" device cannot silently re-hydrate while still authenticated.

**Tests:** after wipe, all three IDBs are gone (verified by re-open returning empty/absent), localStorage/sessionStorage cleared, Cache Storage empty, SW unregistered, logout called; the surviving-persona scenario (open handle) no longer reproduces.

---

## 7. Security considerations (Larissa surfaces)

- Units 2/3/4 touch crypto-adjacent DBs (`packages/crypto` linked-account) and the **auth session** (logout/revoke). Unit 4 additionally handles credential revocation and a "delete everything" trust claim. **All three are a Larissa gate before squash.**
- The wipe's former `onblocked → resolve → reload` gave a **false completion signal** — a zero-knowledge product claiming "erased everything" while ciphertext, plaintext drafts, and a live credential remained. Fixing this is the security crux of Unit 4.
- Decouple's logout-best-effort must never leave the local link present while claiming decoupled — local steps 2–4 always complete.
- No new server endpoints; no broadening of auth scope. `DELETE /api/v1/me` is never invoked by these flows.

## 8. UX audit (Laura)

Unit 3 adds a new user-reachable flow (decouple) and changes an affordance's reachability (dynamic badge, state-flip surface). It gets a **Laura spec-pass on this document before implementation** (her main lever), and a pre-squash pass on the built flow. Units 1/2/4 are internals/bug-fixes and are out of her scope, except the wipe's confirmation copy which she may advise on.

**Laura spec-pass verdict (2026-07-04): no hard defects — placement correct, no dead-end, and Unit 3 removes a live misdirection (the badge).** Six soft findings. Five folded into this spec: not-signout copy (§5.2), reassuring success copy (§5.2), tile-meta acknowledging unlink + "End this link" section heading + 380 px visibility (§5.1). One — reserve typed-phrase for irreversible actions and give reversible decouple a lighter gate — was raised as advisory; Chris arbitrated to **hold the typed-phrase** (§2). Laura's related observation that the two *existing* wipes use inconsistent confirmation idioms is logged as a follow-up (§11).

## 9. Audit & commit plan

Squash units (one per feature unit, §8):

1. **Unit 1** — Backfill robustness (heal + arm-on-never-transferred). *(sync internals; Larissa optional — trust-critical, so summon.)*
2. **Units 2 + 3** — Decouple-device feature (reset primitive + server-identity tag + UI + session revoke). *(Larissa gate; Laura spec + pre-squash pass.)*
3. **Unit 4** — Complete wipe + session revoke. *(Larissa gate.)*

Separately: the CORS `PUT` fix (`apps/sync-service/src/cors.ts`) already applied and verified live in the main tree — squashed on its own.

## 10. Manual verification (device-tested by Chris)

1. **Backfill rescue:** on a device with a stranded corpus (`backfillPending` undefined/false but un-synced rows), boot → the corpus climbs up; backend record counts match local; avatars/blobs present.
2. **Decouple:** linked device → Server-linking → Decouple (type phrase) → surface flips to local-only, sync stops, local data intact; the server session is revoked (a subsequent background refresh from that device is refused); other device unaffected.
3. **Server switch:** decouple, then link to a *different* server → all local data re-uploads to the new account; no stale data from the old server appears.
4. **Complete wipe:** erase device → re-open app → onboarding with **zero** residue (no surviving persona, no drafts, clean shell); the device is signed out server-side.

## 11. Out of scope

- Deleting the whole server account from the client (a separate, heavier action).
- A dedicated "switch server" wizard (decouple → link composes it).
- Any change to server-side ciphertext retention semantics.
- Migrating the knowledge-vectors DB schema.
- Harmonising the confirmation grammar across all weighty actions — the two existing wipes use typed-username (logout-delete) vs typed-phrase "start over", and decouple adds a third typed-phrase gate. Consolidating these into one deliberate idiom (Laura spec-pass, §8) is a separate follow-up, not this scope.
