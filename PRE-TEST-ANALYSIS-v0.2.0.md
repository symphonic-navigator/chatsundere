# Pre-Test Analysis — v0.2.0 Backend Go-Live

**Date:** 2026-07-06 · **Tree audited:** `master` tip `86db075` · **Author:** Liz
**Purpose:** Chris asked for a focused pre-test sweep of ten account-lifecycle and sync questions before tomorrow's test run and the v0.2.0 deployment. Four parallel read-only audits traced the real code (not the docs); every claim below carries a `file:line` reference. Verdicts: **OK** / **OK with caveats** / **GAP** / **MISSING**.

---

## Executive summary — the problem zones, ranked

| # | Severity | Finding | Question |
|---|---|---|---|
| 1 | **Critical (data-loss class)** | Regenerating the recovery key updates **only the local copy** — the server keeps the old key's wrap + verifier. Deviceless recovery then only works with the **old** key; the confirm dialog falsely claims the old key is invalidated immediately. Rotate → discard old key → lose all devices = **permanent lockout**. | Q8 |
| 2 | **High** | The in-app "Delete all my local data" flow deletes **only the `local_account` row**. Personas, chats, sealed API keys, localStorage, Cache Storage all physically survive, despite the dialog promising "permanently deletes all your local data". The thorough `wipeDevice` exists but is reachable only from the locked-login "Start over". | Q3 |
| 3 | **High** | The sole `primary_admin` can self-delete via `DELETE /api/v1/me` (no role guard, unlike the admin route). That leaves an instance with **zero** primary admins and no in-band way to mint a new one (bootstrap refuses once auth methods exist). | Q5 |
| 4 | **High (product gap)** | Server-side account deletion (`DELETE /api/v1/me`) is fully implemented server-side and in the crypto layer, but has **no UI entry point** — dead code from the user's perspective. No single action deletes local + server. | Q10 |
| 5 | **Medium** | Built-in mindspaces are seeded with per-device `uuidv7()` and never sync, but the synced `settings.defaultMindspaceId` and `persona.mindspaceId` reference those ids → dangling references on other devices, silent fallback to `mindspaces[0]`. Same bug class as the just-fixed provider duplication, displaced onto the reference fields. | Q4 |
| 6 | **Medium** | Role change / transfer-primary does **not** revoke the subject's tokens (suspend/delete do). A demoted admin keeps elevated server access for up to ~15 min (access-token TTL). Client-side, the cached role on already-linked devices never refreshes (tile visibility only — the server and admin-client re-derive the role from a fresh JWT). | Q2 |
| 7 | **Medium** | Uplift interruption at exactly `join/finish`: the invitation code is burned server-side before the local link row is written. A lost response strands the user with `code_already_redeemed` — a fresh invitation is needed. | Q6 |
| 8 | **Medium** | Generic sync transport failures (persistent 500s, network errors) are swallowed (`void cycle()`); only typed per-record errors raise attention states. A persistently failing sync is invisible beyond the idle status line. | Q4 |
| 9 | **Low** | After deviceless recovery the Entrance Hall shows the "Create your first companion" setup card while the backfill is still running — active misdirection that can induce a duplicate persona (known deferred Laura soft). | Q8 |
| 10 | **Low** | The invitation QR is only consumable by the **in-app** camera. Scanned with the phone's native camera it opens `<server>/join#CODE` in a plain browser tab — there is no boot-time hash handler. Needs operator/onboarding documentation. | Q7 |

Items 1–4 are the ones worth fixing (or consciously deferring with sign-off) before go-live; 5–10 are decisions and test targets for tomorrow.

---

## Addendum 2026-07-06 — fix status (branch `claude/pre-test-analysis-fixes-ltcwag`)

Findings **#1–#4 and #6 are FIXED** on the branch; #5 and #7–#10 remain open (logged in [`follow-ups-index.md`](obsidian/insights/follow-ups-index.md)) and stay test targets for tomorrow.

- **#1 fixed.** New `POST /api/v1/me/recovery` (Tier-1 step-up, audited, material validated) replaces the recovery verifier + wrap server-side; the account page pushes it **server-first** via the crypto flow's `serverUpdate` callback, so a failed push leaves the old key fully valid — and the page says so honestly. Link-state `unknown` refuses (fail safe). The login-screen recovery flow disables regeneration for linked accounts and names the constructive path (My Account → Recovery Key).
- **#2 fixed.** The in-app "Delete all my local data" now runs `wipeDevice()` — the same complete erase as "Start over". Confirm copy is honest per link state (linked: server copy survives, recovery key brings it back; local-only: no recovery).
- **#3 fixed.** `DELETE /api/v1/me` refuses `primary_admin` with 403 (before the step-up ceremony); transfer-primary is the named path.
- **#4 fixed.** The logout page gains a linked-only "Delete my account everywhere": server delete first (nothing deleted anywhere on failure — honest error), then the full device wipe. Disabled-with-reason for the primary admin.
- **#6 fixed.** Role change revokes the subject's sessions exactly as suspend does; transfer-primary revokes both actor and target. The ≤15-min stale-role window in test plan step 8 no longer exists — expect an immediate sign-out instead.
- **Bonus — the auth-service test baseline is green.** The `buildProof` serverId fixture bug turned out to be one instance of a stale OPAQUE server identity (`${API_BASE_URL}/v1` vs `opaqueServerIdentity(origin)`) sitting in **13** integration-test files — the root cause of the entire long-carried "OPAQUE baseline" failure set. All fixtures aligned, the bootstrap CLI tests' hard-coded `/home/chris/…` cwd made portable, and the spawned CLI now inherits the test env. **`recovery/finish` has green automated coverage for the first time**; full suite 174 pass / 12 skip / 0 fail.

Test plan impact: step 1 now has the *fixed* expectation (deviceless recovery works with the **new** key after rotation); step 3 expects a genuinely clean device from the in-app delete; step 4 expects a 403 + disabled button; step 8 expects immediate revocation instead of the 15-minute window.

## Addendum 2026-07-07 — findings #8 and #9 fixed (branch `claude/pre-test-analysis-open-items-6s118y`)

- **#8 fixed.** Whole-cycle transport failures are no longer swallowed silently: three consecutive failed sync cycles raise a new self-healing `transport_failing` attention (rendered on the account page's status line AND app-wide via `GlobalSyncLine`, where it is collapsible to the dot — no affordance to hide). Failures are counted only while connectivity reads `linked_online`, so airplane mode never false-alarms; the next completed cycle retires the banner, resets the streak, and stamps `lastSyncAt` (previously never written — the "Synced · …" relative suffix now works too).
- **#9 fixed.** While the first post-link sync is pending (linked, online, `lastSyncAt === null`), the Entrance Hall shows a calm non-gold "Syncing your account…" card instead of the SetupCard's "Create your first companion" — closing the duplicate-persona misdirection after deviceless recovery/pairing. Local-only and offline devices keep the SetupCard. Laura pre-squash on both: **no hard defects** (her lead soft — the banner's collapsibility — folded).
- **Still open: #7 (join/finish invitation strand — runbook now, structural fix a Lyra/Chris design question), #10 (QR native-camera dead end — operator documentation + the F7 base-URL convention decision).**

Test plan impact: step 9's first leg now has a *fixed* expectation — a persistently 500-ing sync-service surfaces the `transport_failing` banner after ~3 failed cycles instead of nothing; step 2's setup-card misdirection watch is replaced by the expectation of the "Syncing your account…" card while the backfill/first pull runs.

## Addendum 2026-07-07 (later) — finding #5 fixed (this branch)

- **#5 fixed.** Built-in mindspaces now carry deterministic slug ids
  (`mindspace-builtin-<name>`, defined once in `BUILT_IN_MINDSPACES`); a Dexie v36
  migration rekeys the seeded rows and remaps every reference in the same
  transaction — `settings.defaultMindspaceId`, `personas.mindspaceId`,
  `chats.resolvedMindspaceId` (a third synced reference field the original finding
  missed: every synced chat rendered with the fallback palette on other devices),
  and trash row snapshots. Built-ins stay excluded from sync; convergence follows
  from identical seeding. No republish choreography — same load-bearing assumption
  as the provider fix (no real account has pre-migration ciphertext; v0.1.3 is
  local-only, dev sync state is reset before go-live). Spec:
  [`superpowers/specs/2026-07-07-builtin-mindspace-deterministic-ids-design.md`](superpowers/specs/2026-07-07-builtin-mindspace-deterministic-ids-design.md).

Test plan impact: step 7's second leg now has a *fixed* expectation — device B
shows device A's chosen default/persona mindspace after sync (and synced chats
render with their original palette) instead of the silent fallback.

---

## Q1 — Can user data only be seen by the user themself, after authentication?

**Verdict: OK** (one by-design caveat)

- **Account scoping is airtight.** Every sync route derives the account exclusively from the verified JWT `sub`, never from request input: the single guard at `apps/sync-service/src/http/authenticate.ts:23-59` (rate limit → `verifyToken` → revocation deny-list), then `apps/sync-service/src/routes/changes.ts:123,155,180` and `blobs.ts:162-343` pass `sub` down. The store layer scopes **every** query with `eq(syncRecords.accountId, accountId)` (`records/store.ts:103,234,266`; `blobs/store.ts:43-147`); S3 object keys are namespaced per account (`blobKey(sub, blobId)`). There is no code path where user A can address user B's rows or blobs.
- **Zero-knowledge at rest holds.** `sync_records` stores only `blind_id`, collection tag, envelope version, rev, nonce, ciphertext and its hash — deliberately no timestamp columns (`apps/sync-service/src/db/schema.ts:24-71`). The server verifies `sha256(ciphertext)` but never decrypts.
- **JWT verification is sound.** Algorithm pinned to `EdDSA`, issuer enforced, expiry with 5 s tolerance, fail-closed on any error (`sync-service/src/auth/verify-token.ts:37-54`); the revocation deny-list is checked per request and fails **closed** (503) on a Redis outage (`authenticate.ts:50-51`).
- **Caveat (by design, note for the threat model):** the sync verifier ignores `aud` (`verify-token.ts:19`) while the auth-service enforces it — one access token is valid for both services. Intentional single trust domain; not exploitable, but there is no per-service audience segmentation.

---

## Q2 — Do admin rights work correctly across multiple devices of the same user?

**Verdict: OK with caveats**

- **Pairing gives the same account and the current role.** `join/finish` for pairing reads the owner's **live** role at finish time (`apps/auth-service/src/routes/join.ts:475-515`) and the new device stores the same `server_user_id` — same user, not a sibling account.
- **Enforcement is server-side and fresh.** The gold Admin tile is a pure launcher, never a privilege gate (`apps/user-client/src/lib/account/admin-tile.ts:11-19`); the admin-client's 5-branch login classifies on the **fresh** `session.role` from the server login response, not the cache (`apps/admin-client/src/routes/login/decision-tree.ts:41-44`), and every admin route enforces `minRole` server-side.
- **Caveat 1 — stale cached role on linked devices.** The client role feeding the tile comes from the IndexedDB `linked_account.role`, written only at link/join/pairing time; `loginOnlineLinked` never writes the fresh server role back. A promotion/demotion changes tile *visibility* on other devices only after a re-link. Cosmetic, but will confuse a tester.
- **Caveat 2 — demotion latency server-side.** Role change and transfer-primary do **not** revoke the subject's tokens (`admin/users.ts:189-248` — no `denySub`/`revokeAllForUser`, unlike suspend/delete). With a 15-minute access-token TTL (`jwt/issue.ts:27`), a demoted admin keeps admin access for up to ~15 min. Recommendation: revoke on role change, exactly as suspend does.

---

## Q3 — Can a user correctly delete all their local data?

**Verdict: GAP**

- **The complete wipe exists and is well-built** — `lib/wipe-device.ts:148` revokes the server session first, zeroes the MK, closes all three IDB handles before deleting, clears localStorage/sessionStorage/Cache Storage/service worker, and handles `onblocked` correctly (bounded wait, no false completion, `wipe-device.ts:51-66`). But its **only caller is "Start over"** on the locked login screen (`routes/login/start-over.tsx:42`).
- **The in-app path under-deletes.** `/app/account/logout`'s type-username "delete" calls `deleteLocalAccount(getDb())` (`routes/app/account/logout.tsx:42`), which removes **only the `local_account` row** (`packages/crypto/src/db/local-account.ts:24-29`). The `chatsundere_client_data` Dexie DB (personas, chats, providers, **sealed API-key secrets**), the knowledge-vectors DB, `linked_account`, Web Storage, Cache Storage and the service worker all survive, and the server session is not revoked — while the dialog claims *"This permanently deletes all your local data. There is no recovery."* (`logout.tsx:83`). Plaintext personas/chats remain readable to anyone with disk or devtools access. A test even pins the under-deleting behaviour (`tests/routes/account-logout.test.tsx:125`).
- **Recommendation:** point the in-app delete at `wipeDevice` (or a linked-aware variant of it) before go-live, or soften the dialog copy — the current promise is false.
- **Minor hardening notes:** `wipeDevice` enumerates a **hard-coded list of three DB names** (`wipe-device.ts:32,167-169`) — any future Dexie DB must be added by hand. OPFS is not touched; verify where the embedding-model weights actually cache (Cache Storage is covered, OPFS would not be).

---

## Q4 — Does client↔server sync work as a whole?

**Verdict: OK with caveats** — the engine is in genuinely good shape; strong test coverage including a real two-device harness.

- **Push (client→server): OK.** Dexie write + outbox row commit atomically in one transaction (`sync/enqueue.ts:32-40,186-198`); no payload on the outbox row, so a crash between commit and drain loses nothing — the boot reconcile drain picks it up. Oversized records (>2 MiB) are refused server-side, marked terminal client-side, surfaced as an attention banner and self-heal on a smaller edit (`sync/worker.ts:490,674-679,713-739`). Conflicts keep the outbox entry and trigger the pull-side resolution; a poison conflict adopts the server rev and re-pushes. Tombstones are never minted for rows the server never saw, and blob puts/records/blob-deletes run in a load-bearing phase order with typed failure repair (`worker.ts:308-317,363-521`).
- **Pull (server→client): OK.** All triggers present (10-min timer, foreground, connectivity regain, boot, push-piggyback, doorbell poke); apply is security-hardened (locally computed hash for echo detection, inert rejection on open failure, durable dead-key tamper anchor — `sync/apply.ts:437-673`); LWW/precedence rules match the spec per collection (`sync/resolution.ts`); the 30-day trash for pulled tombstones is transactional; the 2026-07-04 `backfillPending` heal is present (`apply.ts:656-671`, `backfill.ts:167-182`); `instance_epoch` divergence and `bad_since` both route into recovery; doorbell reconnects with backoff and degrades silently to the timer.
- **Caveat 1 — the remaining convergence gap (mindspaces).** Provider duplication is structurally fixed (`id == templateId`, Dexie v35 dedup + `persona.providerId` remap — confirmed in `fc8b3f4`). But the **seven built-in mindspaces** are seeded per device with fresh `uuidv7()` (`data/client-data-db.ts:1513`) and never sync — while the synced `settings.defaultMindspaceId` (in the allowlist, `sync/strip.ts:47`) and `persona.mindspaceId` reference those per-device ids. On the other device the reference dangles and `resolveMindspace` silently falls back to `mindspaces[0]` (`state/mindspace-resolver.ts:27-28`). No crash, no data loss — but device B ignores device A's chosen mindspace. Fix direction: deterministic ids for built-ins (the provider-fix pattern) or stable-key mapping on apply.
- **Caveat 2 — silent transport failures.** `fireCycle` swallows all cycle errors (`sync/triggers.ts:55-58`); a persistently 500-ing or unreachable sync-service raises no attention state. Only typed per-record errors (quota, too-large, delete-rate) are user-visible.
- **Caveat 3 (minor).** Non-terminal push errors retry every cycle with no per-entry backoff (chatty, not incorrect). Background sync calls don't set `skipStepUpGate`, so an unexpected 403 `step_up_required` on a background drain would pop a step-up modal — sync endpoints shouldn't emit it, but the surface is unguarded.
- **Coverage note:** the two-device scenario harness drives the real worker/apply/recovery/resolution code (`tests/sync/scenarios.test.ts:76-92` + echo-storm, tombstone-resurrect, epoch-flap, malicious low-rev page, poison heal, replay guard), and the server has its own e2e suites. What does **not** exist is a single full-stack test wiring two real clients through the actual Bun sync-service — tomorrow's manual multi-device run is exactly the missing leg.

---

## Q5 — Is user identification (especially the primary admin) correctly implemented?

**Verdict: OK with one gap**

- **Identity model is consistent everywhere.** `users.id` (uuidv7) == JWT `sub` == sync `accountId` == client `linked_account.server_user_id`. Username is `citext` unique, no email/phone anywhere (`apps/auth-service/src/db/schema.ts:36-59`).
- **Exactly one primary admin, enforced at the DB.** Partial unique index `users_one_primary_admin` (`schema.ts:54-58`); bootstrap CLI refuses once any primary admin or auth method exists (`cli/bootstrap.ts:13-26`); transfer-primary runs SERIALIZABLE with demote-then-promote (`routes/admin/users.ts:210-249`); self-suspend/self-demote/self-delete are blocked **on the admin routes** (`admin/users.ts:101,146-152,186`).
- **The old "rename bricks OPAQUE" bug is fully fixed.** OPAQUE identifiers are frozen at registration on `auth_methods` (`opaque_user_identifier`, `opaque_client_identifier`, `schema.ts:80-88`); login, step-up and join all read the frozen columns; `PATCH /api/v1/me` touches only `users.username` (`routes/me.ts:87`).
- **GAP — the sole primary admin can self-delete via the self-service route.** `DELETE /api/v1/me` (`me.ts:109-136`) is Tier-3 step-up gated but has **no role guard**. The DB index enforces *at most* one primary admin, not *at least* one; after self-deletion there is no in-band path to a new primary admin. Recommendation: refuse `DELETE /api/v1/me` for `primary_admin` (point at transfer-primary first), mirroring the admin-route guard.

---

## Q6 — Uplift: local Chatsundere → backend-linked. Remaining pitfalls?

**Verdict: OK with caveats** — the flow is real, implemented, and safer than the design history suggests.

- **The premise "local data is plaintext with no MK" is only half true — and that resolves most feared pitfalls.** A real 32-byte MK is minted at local-account creation (`packages/crypto/src/flows/create-local-account.ts:72`); secrets are sealed under a DEK derived from it. **`linkToServer` preserves that MK** (wraps the same key under the OPAQUE AMK, `link-to-server.ts:60-64,107`), so: no re-seal of API keys, **no dual-MK window**, and the identity tag (SHA-256 of an MK-derived DEK) is unchanged — the identity-change wipe (`521ffaf`) provably cannot fire during uplift (`boot/client-data-identity.ts:81-98`; the late-link branch also never calls the fresh-onboarding wipe).
- **Username collision → rename-and-retry: implemented** (`routes/onboarding/invitation/confirm.tsx:125,195-197,277-283`) — reveals the field, renames locally, retries the link.
- **Backfill is resumable and self-healing.** `backfillPending/Total/Done` persist in `syncState`; an interrupted drain resumes next cycle; `armBackfillIfCorpusUnsynced` rescues a device that crashed before arming (`sync/backfill.ts:167-251`).
- **Pitfall 1 — the link step itself is not atomic.** `join/finish` burns the invitation code server-side, but the local `linked_account` row is written only at the very end (`link-to-server.ts:107`). If the response is lost, retry hits `code_already_redeemed` → the user needs a fresh invitation. Test this deliberately tomorrow; the admin remedy (mint a new invitation) works but should be a known runbook entry.
- **Pitfall 2 — pairing onto a device with pre-existing local data is accepted data loss.** `finishJoinByPairing` refuses a device with a local account outright (`join-by-pairing.ts:152-157`); true local↔local merge is explicitly Phase-0 deferred (`join-by-pairing.ts:226-230`). Fine for the alpha cohort (they will late-link, not pair), but testers must know which path to use.

---

## Q7 — Can a user start directly with a server invitation, without a local account first?

**Verdict: OK**

- The matrix offers "I have an invitation" with no account precondition (`routes/onboarding/matrix.tsx:14-18,40`). The fresh-device branch mints a fresh MK + recovery key and writes `local_account` **and** `linked_account` atomically in one transaction — linked from birth (`packages/crypto/src/flows/join-by-invitation.ts:168-268`).
- The account guard only interposes when a **locked** local account exists (routing through login into the late-link path, avoiding a second MK) and fails open on a DB read error (`routes/onboarding/invitation/_account-guard.tsx:33,42`). Both join flows carry hard backstops against double-account creation.
- The QR encodes `https://<server>/join#CODE` with the code in the **fragment** (never sent to the server); the in-app scanner parses and validates it (`lib/qr.ts:14-41`).
- **Caveat:** there is **no boot-time hash/deep-link handler** — the QR only works through the in-app camera. A native-camera scan opens the auth-service `/join` URL in a plain browser tab and goes nowhere. Either add a handler later or make the operator instructions explicit ("scan from inside the app").

---

## Q8 — Will recovery work purely with the recovery key?

**Verdict: the deviceless chain itself is OK — but recovery-key regeneration is a critical GAP.**

- **The full deviceless chain is wired end-to-end and correct:** matrix → `/onboarding/recovery` → fresh-device guard → `recovery/start` (returns wrapped MK + nonce + OPAQUE registration) → unwrap via `deriveRecoveryAmk` → HMAC proof → OPAQUE re-registration under a **new** passphrase → `recovery/finish` (single-use 60 s nonce, consumed even on mismatch; revokes **all** prior sessions and deletes **all** prior auth methods before issuing new tokens) → session + `maybeProbeLinkedServer()` arms sync → `since=0` full backfill (`packages/crypto/src/flows/recover-from-scratch.ts:91-243`, `apps/auth-service/src/routes/recovery.ts:56-240`, `routes/onboarding/recovery.tsx:77-95`, `sync/worker.ts:1044-1122`). Old devices lose server access; brute force is bounded (10/15 min per username on `/start`, 256-bit proof, single-use nonce).
- **GAP 1 (Critical) — regenerate-recovery-key never reaches the server.** The crypto flow supports a `serverUpdate` callback (`regenerate-recovery-key.ts:20-47`) but **no caller passes it and no server endpoint exists** (`routes/app/account/recovery.tsx:47`, `routes/login/recovery.tsx:210`; server recovery columns are written only by `recovery/finish` and `join`). Result: after rotation, local recovery-key login accepts the **new** key, but deviceless recovery still requires the **old** one — and the dialog claims the old key is invalidated immediately (`recovery.tsx:113`). On a no-forgot-password platform this is a data-loss class defect. **Fix before go-live or disable regeneration for linked accounts** (plus a deferral entry with Chris's sign-off if postponed).
- **GAP 2 (Low) — empty-vault misdirection.** After recovery the Entrance Hall shows the first-run setup card while backfill runs (known deferred Laura soft, `follow-ups-index.md:124`). A "syncing your data" cue would prevent duplicate-persona creation.
- **Notes:** recovery deliberately does not rotate the recovery key or MK (re-usable by design); a lost physical device with a local biometric can still unlock its **local** vault offline (no MK rotation, no remote wipe — design property worth stating in the safety guide); the recovery integration test is red due to a fixture bug (`buildProof` wrong serverId, `follow-ups-index.md:156`), meaning `recovery/finish` currently has **no green automated coverage** — tomorrow's manual run is the actual verification.

---

## Q9 — How is a local username change handled?

**Verdict: OK with an accepted caveat**

- **Linked rename is server-first, offline-refusing.** `changeUsername` calls `serverPatch` **before** any local write (`packages/crypto/src/flows/change-username.ts:25-42`); the account page refuses while the link state is `unknown` (cold-boot guard), maps 409 → "already taken" and network/5xx → "wasn't changed" (`routes/app/account.tsx:107-149`). Unlinked stays local-only. `PATCH /api/v1/me` validates, enforces uniqueness via the DB constraint, and never touches the frozen OPAQUE identifiers (`routes/me.ts:79-101`).
- **Late-link collision → rename-and-retry** works (see Q6).
- **Accepted caveat — LOW-1 residual TOCTOU** (`obsidian/insights/security-deferrals.md:689-695`): if the server PATCH succeeds but the subsequent local write dies (quota/tab-kill in a single JS tick), server and local usernames diverge; the next **online** login fails OPAQUE, local login keeps working, recovery key reconciles. Consciously deferred, low severity — a "rename pending" self-heal marker is the eventual fix.

---

## Q10 — Are all account-lifecycle operations the user needs correctly implemented?

**Verdict: mostly OK — two MISSING items and the Q8 gap.**

| Operation | Verdict | Notes |
|---|---|---|
| Register local-only / via invitation | OK | Both matrix paths live |
| Add device via pairing | OK w/ caveat | Paired devices cannot local-recovery-key-login (placeholder verifier, known O-5-1) — they use online/full recovery |
| Login: OPAQUE online, offline fallback, passkey/PRF | OK | Offline degrade on `unreachable/auth_failed` works |
| Logout (sign out) | OK w/ caveat | Local-only; deliberately does **not** revoke the server session (token lives ≤15 min) |
| Change passphrase | OK | Rewraps MK + OPAQUE re-register + server finish; offline-refuses when linked |
| Biometrics add/rename/remove, last-one lockout | OK w/ open check | Client and server both guard the last one; **verify tomorrow** that removing a server-synced passkey also removes the server row (page calls the local delete, `biometric.tsx:156`) |
| Regenerate recovery key | **GAP** | See Q8 — server never updated |
| Rename username | OK | See Q9 |
| Late-link to server | OK | See Q6 |
| Decouple device | OK | Best-effort revoke, local unlink always completes, typed confirm + retry |
| Delete local data | **GAP** | See Q3 — in-app path under-deletes |
| Delete server account | **MISSING (UI)** | `DELETE /api/v1/me` + crypto flow + wire method all exist, zero UI callers; also needs the Q5 primary-admin guard |
| Auto-handover (ADR 0026) | **MISSING** | Not implemented — no primary-admin device-handover flow exists yet |
| Refresh rotation, multi-tab locks, step-up | OK | Revoke-first rotation race fixed (2026-07-06); `navigator.locks` serialisation; step-up modal + 401 interceptor live (the STATUS "briefed, awaiting implementation" list is stale here) |

---

## Recommended manual test plan for tomorrow

Ordered so the highest-risk findings get verified first.

1. **Recovery-key rotation trap (finding #1):** on a linked account regenerate the recovery key, keep both keys noted, then attempt deviceless recovery in a fresh profile with the **new** key (expect: rejected) and the **old** key (expect: works). This proves the gap and its severity.
2. **Deviceless recovery happy path:** fresh profile → "Use a recovery key" → new passphrase → full vault backfilled. Watch for the setup-card misdirection while backfill runs; verify the old device hard-logs-out on its next refresh and can no longer sync.
3. **In-app "Delete all my local data" (finding #2):** run it, then inspect devtools — expect personas/chats/localStorage/Cache to survive and the server session to stay valid. Compare with "Start over" on the login screen (expect a genuinely clean device).
4. **Primary-admin self-delete (finding #3):** as sole primary admin call the account-delete path (via API if no UI) — confirm whether the instance is left ownerless. Decide guard before go-live.
5. **Uplift happy path:** local alpha profile with personas + a sealed provider key → late-link via invitation → secrets still open, backfill completes, `backfillPending` clears; username-collision variant → rename-and-retry fires.
6. **Uplift interruption:** kill the network exactly around `join/finish` → confirm the `code_already_redeemed` strand and the mint-new-invitation remedy; kill mid-backfill → confirm resume on reconnect/reboot.
7. **Multi-device convergence:** create the same provider on two devices (verify the v35 dedup); set a built-in mindspace as default/persona mindspace on device A and check device B (expect convergence — finding #5 fixed).
8. **Admin role lifecycle across devices:** promote/demote/transfer-primary with a second linked device open — observe the ≤15-min token window, the stale gold tile, and that the admin-client itself 403s correctly on fresh login.
9. **Sync failure visibility:** force the sync-service to 500 persistently → confirm what (if anything) the user sees; quota-exceeded → banner appears, retires only after an accepted write; oversized record → terminal banner, drain not wedged.
10. **QR paths:** in-app camera scan (works) vs native camera scan (dead end — document for operators).
11. **Environment discipline:** run the backend via `./dev.sh` only — `pnpm dev` leaves `OPAQUE_SERVER_SETUP` ephemeral and every passphrase login fails with `server_auth_failed` (known footgun).

---

## Known-stale documentation noted in passing

- STATUS-BACKEND's "Briefed, awaiting implementation" list still names the client step-up modal and interceptor — both are implemented and live.
- The recovery integration test (`recovery.test.ts`) is red from a fixture bug (wrong serverId in `buildProof`), not a runtime regression — but it means the recovery finish path has no green automated coverage until fixed.
