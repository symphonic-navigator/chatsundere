# Chatsundere Status — Full Backend Transition

**Last updated:** 2026-07-04 (morning) — **PRE-TEST STATIC-REVIEW + FIX PASS DONE
— both audit gates green, ready for Chris's first extensive end-to-end backend
test.** Ahead of the manual test, a five-agent ultrathink static review swept
auth + sync (auth-service server, sync-service server, client sync engine +
blob, 401-degrade, invitation/guard/unlock), each cross-checking the
client↔server WIRE contract — the surface no prior review covered (Larissa/Laura
audit against intent, not the actual wire shape). It surfaced **16 real defects,
all fixed on the branch**, then Larissa (security) + Laura (UX) audited the fix
diff. **3 CRITICAL** (on the test path): the doorbell 4401-close refreshed with
the default `'user'` origin → `closeAndForget`/logout in the exact "server forgot
this client" scenario the degrade feature exists to catch (now `'background'`);
`link/passkey/finish` parsed the credential under key `response` while the client
(and shared-types) send `credential`, with an over-strict inner shape that even
stripped `clientExtensionResults.prf` → every passkey enrolment 400'd and fell
back to local-only (schema rebuilt with `looseObject`, PRF check now functional);
pre-link blob rows (bytes, no `blobRef` — write sites mint only once linked)
backfilled their record but never uploaded the bytes → dangling ref / "image
unavailable" on every other device (backfill now mints+persists the ref and
queues the PUT). **4 HIGH**: sync-service 500 + wedge on a `baseRev>0` push
against an absent row → **resurrect-as-insert** (Chris's call, heals restore
drift; tombstones are real rows so no deleted-record resurrection); a relink left
the in-memory auth-degraded latch set so the offered Reconnect silently did
nothing until reload (`link-reset` clears it); the backfill progress line was
mislabelled "Pulling…" (watermark stays 0 on a first link) → precedence fixed so
it reads "Uploading N of M"; an open-redirect via an unvalidated `?return=` sink
→ one shared `safeReturnPath` for every sink. **MEDIUMs**: invitation-finish
redemption guard (mirror pairing — no double-redeem/lockout), 413 `body_too_large`
now terminal, proxy egress refusal → `'background'`, apply.ts establishes a CAS
base without prior meta (backfill-wedge guard). **Audit-driven adds**: Laura's
collapse-dot-hides-attention (borderline-hard), Reconnect `?return=/app`, "0 of 0"
copy; Larissa's second unguarded `?return=` sink (`persona/hub.tsx`) +
`safeReturnPath` control-char-bypass hardening (`/%09/evil.com`). **Larissa
verdict: CLEAR TO COMMIT** (no Critical/High, zero-knowledge/OPAQUE-PRF/no-data-
loss invariants all hold). **Laura: no hard defects.** Verification: 3 packages
typecheck clean, Biome clean, **user-client 297 sync/component/route/lib tests +
sync-service 42 store/push/pull/ops/e2e green**, 5 new/updated regression tests
(doorbell-origin, store resurrect, SyncStatusLine precedence, safe-return unit),
no NUL/control bytes in source. **Deferred follow-ups (not test-blocking):**
backfill rate-limit smoothness (needs progress-aware re-arm to avoid a hot-loop),
cross-tab refresh reuse (two tabs of one browser only — a Web Lock around the
refresh would close it), a server-side passkey-finish integration test, and
assorted LOWs (bearerAuth skips the deny-list on logout, dev IP-rate-limit
collapses to `'unknown'`, re-epoch needs a service restart → runbook,
`local_account_exists` vs `conflict` naming). Squashed as one unit on
`full-backend-transition`; master untouched.

Prior entry below.

**Last updated:** 2026-07-04 (night) — **BACKFILL OVERNIGHTER IS SPECCED,
PLANNED, HARDENED, AND HANDED OFF.** The full pipeline ran in one session:
brainstorm (6 decisions with Chris) → spec
`superpowers/specs/2026-07-04-sync-backfill-design.md` (**v2** — Larissa
spec-pass 2 High / 4 Medium / 2 Low and Laura spec-pass 4 hard / 4 soft, ALL
folded, zero deferrals) → plan `superpowers/plans/2026-07-04-sync-backfill.md`
(18 tasks + hand-off, 3 stacked PRs) → overnight operating-rules contract →
kickoff prompt delivered to Chris. Scope: **PR 1** same-MK backfill for the
invitation late-link path (persistent `backfillPending` + interleaved pump
≤100/chunk, link-time engine reset [L-1: stale `syncRows` would silently
strand data on relink], `batchByBytes` count cap [L-2: the server rejects
>100-record pushes wholesale and the drain never count-capped],
`record_too_large` terminal sentinel [L-6], two-sided built-in-mindspace
enforcement [L-8 + the latent `enqueueFullRepush` gap], `bad_since`→recovery,
the backfill status vocabulary with pinned precedence [U-5], and the
**minimal global sync line** [U-1/U-2 — consciously revises WS-C SOFT-3;
design-language pass restyles later]); **PR 2** fresh-join guard (crypto
backstop `local_account_exists` before any key minting — closes the LAST
unguarded minting flow [L-9], unlock-first routing on both invitation routes,
login honours validated `?return=` [U-3 — login previously discarded it],
replace-link confirm for the linked+unlocked cell [L-7], start-over exit at
login for the lost-both-keys dead-end [U-4]); **PR 3** 401 degrade-to-offline
(refusal classifier on the parsed `'unauthorized'` envelope — the refresh
endpoint's only refusal shape — for BOTH origins [L-3/L-5: today even a
user-path 5xx destroys the session], single-flighted refresh [L-4:
concurrent background 401s self-inflict reuse detection], `auth_degraded`
attention with reconnect affordance, engine stop, boot re-arm). PRs stack
1→2→3, base `full-backend-transition`, worker never merges/pushes to master.
**Morning integration pipeline:** pull PRs → Liz review → Larissa built-diff
audit of all three (+ the still-owed light re-audit of `e1828537`/`0f9a2a91`
folds into the same window) → Laura pre-squash (global line, guard screen,
start-over exit, replace-link confirm, degrade attention) → Chris's spec §8
manual verification (8 steps; the degrade test deletes ONLY the account
server-side — a full dev reset re-mints the instance epoch and masks L-1).
Blob/two-browser manual verification (WS-C §15 / WS-D §14) still owed.

Prior entry below.

**Last updated:** 2026-07-03 (late evening) — **SYNC IS GREEN END-TO-END on the
dev stack.** Server-side proof: `sync_records` carries ciphertext rows
(4 chats, 1 KB), `sync_push_records_total{outcome="ok"} 4`, one pull, doorbell
connected + one poke delivered; the client status line reads "Synced" with
quota. Getting there surfaced **four real integration defects**, all fixed
inline on the branch (device-test + console probes found them; no unit gate
could have):
(1) the dev URL overrides (`lib/server-urls.ts`) were built but had **no
consumer** — the sync engine dialled the advertised `https://localhost:3200`
against plain HTTP (`e1828537`);
(2) **token refresh targeted the service being called** — any sync-side 401
refreshed against the sync service (404 there, cookie not even sent) and
`closeAndForget()` silently logged the user out (`e1828537`);
(3) the client sent `credentials: 'include'` to the deliberately cookie-free
sync service → every preflight failed CORS (`0f9a2a91`);
(4) **the OPAQUE server setup was generated per process** — every auth-service
restart/reload permanently bricked all accounts' passphrase auth. This was the
hidden root of the whole reset-dev-auth cascade AND of Chris's dead provider
secrets (a bricked account forced re-onboarding; the fresh-join path silently
minted a new MK over the local account). Now persisted via
`OPAQUE_SERVER_SETUP` (`bun run generate-opaque-setup`; dev value committed,
DEPLOYMENT ch.4 documents never-rotate) (`0f9a2a91`).
**Owed:** Larissa light re-audit of `e1828537` + `0f9a2a91` (token-refresh
routing + auth-service env change) with the branch gates. **Parked findings:**
(a) a linked client whose server forgot it gets its LOCAL session killed by the
background worker's 401→refresh-fail→`closeAndForget` cascade — needs a
degrade-to-offline design, candidate for the backfill overnighter; (b) cockpit
button reportedly missing on seed-from-template chats (unverified, one
observation).
**NEXT (decided with Chris): sync BACKFILL + fresh-join guard** — local
content created before linking never enters the vault (empirically: only the
4 post-link chats synced; the 61 pre-link chats did not — no
enqueueAll/initial-sync exists, a deliberate WS-C scope cut). Scope settled:
same-MK backfill for the invitation late-link path PLUS a guard so the
fresh-join can never silently overwrite an existing local account/MK again;
foreign-MK uplevelling stays deferred (couplings register). Fresh context
window: brainstorm → spec (Larissa + Laura spec-pass) → plan →
`superpowers:overnight-implementation`, goal 1..n numbered PRs against
`full-backend-transition`. Blob/two-browser manual verification (WS-C §15 /
WS-D §14) still owed after that.

Prior entry below.

**Last updated:** 2026-07-03 (evening) — **FIRST LOCAL END-TO-END RUN: auth is
green.** Chris drove the integrated branch on the dev stack for the first time.
Four blockers found and fixed inline (all committed, `master`-untouched — we are
on `full-backend-transition`):
(1) `dev.sh` never launched the admin-client + CORS/CTA/bootstrap gaps — wired
(`960b3df`, `6cad23a`);
(2) **join responses omitted the `kind` discriminator** → registration died at
`/join/start` (`b55a52a2`);
(3) biometric prompt `<dialog>` overlapped the entrance hall (`06bbd286`);
(4) **OPAQUE server identity diverged dev vs prod** (`${base_url}/auth/v1` client
vs `${API_BASE_URL}/v1` server) → every login/step-up/biometric/admin failed;
fixed with an origin-only shared helper `opaqueServerIdentity` across all 12
call-sites, Larissa-audited CLEAN, frozen-at-go-live recorded as LT-L3
(`dc1fff00`); dev auth-reset tool added (`540fccf8`).
**Verified working:** registration → login → local content intact (61 local
chats readable); admin-client loads (still shows demo data — follow-up);
biometric verified up to the PRF step (Bitwarden-on-PC lacks PRF — **device test
deferred to 2026-07-04**, soft deferral, biometrics seen working before).
**NEXT — the still-owed sync/blob manual verification.** Sync is built + merged +
audited but never exercised end-to-end: `sync_db` is empty (`sync_accounts` /
`sync_records` / `sync_blobs` all 0). Chris's 61 chats are local-only — expected,
since they predate account-linking (never enqueued) and auth was broken until
today (the worker had no valid token to push). The task is a **bring-up + verify**
of the already-wired engine, not a build. Kickoff drafted for a fresh window.

**Last updated:** 2026-07-03 — **ALL FIVE WORKSTREAMS ARE MERGED into
`full-backend-transition` and the integrated branch is green.** The earlier
"WS-B+E awaiting audits, then squash" framing below was **stale**: WS-B+E landed
via **PR #10** (`f7b5fb72`), then WS-A/C/D via PR #11/#12/#13 — in that
conflict-resolving order (B+E first, so the `apiFetch` step-up interceptor and
the Dexie-v33 line were already present when A/C/D layered on). Integrated-branch
gates on this machine: **`pnpm typecheck --force` 14/14** (0 cached); **user-client
vitest 2540 pass / 8 fail** (the 8 are the known Node-experimental-localStorage
baseline — `localStorage.clear()` undefined; environmental, not a regression).
**A local development stack landed** (`cf5b5640`) so the whole backend runs and is
testable on a dev machine: committed loopback-only dev secrets
(`apps/*/.env.dev`), `dev.sh`/`dev-infra.sh`/`dev-down.sh`, postgres `sync_db`
init, prometheus ops-port fixes, and a dev-only `VITE_PROXY_URL` override
(symmetric with `VITE_SYNC_URL`) so the http proxy is reachable locally while
discovery advertises the https URL the validator mandates. **Audit + test status (2026-07-03):**
**Larissa is DONE — CLEAR TO MERGE, no Critical/High** (integrated diff vs
merge-base `7081a4d`; crown-jewel blob/token/SSRF/sync/step-up checks all pass).
Two Lows deferred in [[insights/security-deferrals]] (LT-L1 step-up cross-tier
coalescing — no bypass; LT-L2 username-change no step-up gate — Chris to confirm
vs ADR 0027). **Backend service tests green** on this machine: auth 153 pass /
12 skip / 0 fail (integration skips cleanly without `TEST_DATABASE_URL`), sync
129 / 0, proxy 81 / 0. **`pnpm test` smoothed** (`dev-infra.sh` + compose init
now create/migrate `auth_test_db`/`sync_db_test`) — 18/19 turbo tasks green; the
only red is the known 8-test Node-experimental-localStorage baseline in the
user-client (environmental, pre-existing). **A stale cross-workstream test was
fixed** (`47277841`): WS-D admitted the 3 blob collections to `SYNC_COLLECTIONS`
but the WS-C `shared-types` assertion still expected 15 — it was in no
per-workstream gate (typecheck + vitest only), so `pnpm test` was the first to
catch it. **Laura is DONE — no hard defects** (pre-squash/holistic pass; all five
watch-items clean — proxy dead-end framed the dere way, disabled-over-hidden held,
matrix honest, step-up never dead-ends, blob placeholders never read as broken).
Three softs: **SOFT-1** (ConnectivityBadge suppressed on chat) and **SOFT-2**
(auth-action relay tap-through) both **fixed** (`8d901f45` — a minimal in-chat
offline cue + the auth-action linking link, +3 tests); the SOFT-1 chat cue was
then **Laura-re-glanced clean** and polished (`e92a7fa8` — `min-w-0` on the chat
title so `truncate` is the real 380 px shrink valve, and the `server_unreachable`
minimal label reads "Not synced" not "Offline"). **SOFT-3** (global
sync-attention surface) is spec-sanctioned (WS-C decision 2), **deferred to the
design-language pass** (registered in [[follow-ups-index]]). **Still owed before merge-to-master:**
(1) **Chris's device/two-browser manual verification** per each spec's
§-verification list; (2) the LT-L2 conscious confirmation (username-change
step-up gate vs ADR 0027). **Both audit gates are now green.**
Prior (now-superseded) entries below.

**Last updated:** 2026-07-02 — WS-E (step-up vertical) and WS-B (onboarding
un-gate, Add-a-device, server-synced passkeys) built on a branch cut from
`full-backend-transition`, awaiting Larissa (auth-service + `packages/crypto` +
both interceptor paths) and Laura (pre-squash on WS-B's user-reachable flows)
audits, then squash into two units (`E:` → one squash, `B:` → one squash).
**Last updated:** 2026-07-02 (late evening) — all remaining specs + plans done; WS-B+E building remotely.
This file is the orientation surface for the **Full Backend Transition**: the
focused, deploy-free sprint that integrates the three built backend workstreams
(authenticated proxy, zero-knowledge sync, blob transport) plus the two auth
remainders (step-up, onboarding un-gate) into the `v0.1.3` local-only client —
turning Chatsundere from a local-only companion into a full end-to-end-encrypted
backend client.

It is a **peer to** [[STATUS-BACKEND]] (server side, now built) and
[[STATUS-CLIENT-ONLY]] (client feature history). Read all three at session start
per CLAUDE.md §16; update this one at the end of every transition session. It
lives on the `full-backend-transition` branch and merges back to master turnkey.

> **Sibling note:** the other two STATUS files live under `obsidian/`. This one
> sits in the repo root (of the transition branch) at Chris's request for
> sprint-visibility; move it beside the others if peerage-by-location is
> preferred later.

---

## 1. The sprint frame (settled with Chris 2026-07-02)

- **~4.5 focused days**, deploy-free.
- **No mid-flight compatibility burden.** Because nothing deploys during the
  sprint, the client need not keep working end-to-end at every step. We build
  the transition **straight-line and turnkey**, and reconcile with the live
  world only at merge time. This is the sprint's biggest accelerant — it removes
  the coordinated-proxy-cut / don't-break-local-only dance entirely.
- **Isolated branch: `full-backend-transition`**, checked out as a **dedicated
  git worktree** under `.claude/worktrees/` (CLAUDE.md §8 — never a checkout of
  the main tree; the main tree stays on `master` so Chris's parallel work is
  safe).
- **Pushed to GitHub regularly (2–3× a day) as checkpoints/backup — this is
  safe.** `docker.yml` and `pages.yml` trigger **only** on `push: branches:
  [master]` and `tags: v*.*.*` (plus PRs to master). A push to
  `full-backend-transition` triggers **no workflow at all** — no CI, no image
  build, no Watchtower deploy. Push as often as wanted; it is inert.
- **Merge back to master only when schlüsselfertig** (turnkey): typecheck + full
  vitest green on the branch, Larissa clean on every `packages/crypto`/sync-
  touching unit, Laura clean on every user-reachable flow change.
- **`master` stays Chris's** during the sprint. Liz commits nothing to master;
  Liz pulls master **into** the branch periodically so the final merge is not a
  cliff.

## 2. Parallel master work — the one coordination point

Chris may, on master, in parallel:

- **Curate 1–2 models** for users — **collision-free** (no schema change), do
  anytime.
- Possibly a **tiny "artefact creator model" feature** (let users pick the model
  that generates all artefacts — a genuinely-wanted, sensible ask). Chris will
  **ask before building it.**

**The single collision surface is `apps/user-client/src/boot/client-data-db.ts`
— the Dexie version number.** The sync engine (WS-C) owns **Dexie v33**. If the
artefact-creator feature needs a schema field (e.g. on `SettingsRow`), it needs
its own Dexie bump and **collides with v33**. Resolution, pre-agreed: that
feature takes **v33** and the sync engine moves to **v34** (Chris tells Liz
before Liz locks the engine migrations), or it is sequenced. The concrete
question Chris asks before building: **"does it touch `client-data-db.ts` /
need a Dexie version?"** If no → no coordination needed. (Register:
[[insights/future-feature-couplings]].)

## 3. Scope — IN (this sprint) / OUT (the later go-live event)

**IN — turnkey client code on the branch:**

- WS-0 Foundation, WS-B Onboarding un-gate, WS-A Proxy client, WS-C Sync engine,
  WS-D Blob client, WS-E Step-up. All gated behind Larissa + Laura, green on the
  branch.

**OUT — a separate go-live event afterwards, consuming this branch:**

- The actual VPS deploy of the whole backend (auth + proxy + sync + postgres +
  redis + MinIO).
- The **coordinated `cors-proxy.tidesson.net` cut** (old container stopped-not-
  deleted, 60 s rollback, the constructive in-client cut message).
- The Discord "Chatsundere has a backend" announcement.
- The **v0.2.0** tag + the ADR 0031 / CLAUDE.md §12 roadmap amendment
  (v0.3.0 → v0.2.0).
- Larissa's still-owed **post-merge re-audits of the built 6A/6B/6C server
  diffs** (tracked in [[STATUS-BACKEND]]) — a server-side gate for the go-live,
  not a sprint task.

## 4. The workstreams — ordering, size, audit gates

Ordered by import-dependency and risk-frontloading (deploy pressure removed, so
purely technical sequencing).

| # | Workstream | Size | Audit | Depends on |
|---|---|---|---|---|
| **0** | **Foundation** — `GET /api/v1/config` consumer (`proxyUrl`/`syncUrl`/`features`), a real connectivity (online/offline) store, the "linked-account exists" gate + `features`-driven disabled-over-hidden | S–M | Laura | — |
| **B** | **Onboarding un-gate + verify** — un-gate the 3 disabled matrix cells (`onboarding/matrix.tsx:15-43`), make the server-linking badge real (`server-linking.tsx:21`), decide the unused server-passkey-linking caller, device-verify the already-built join/pairing/recovery flows against a live backend | S build / M verify | Laura | 0 |
| **E** | **Step-up client** — `<StepUpModal>` + a `step_up_required`/`webauthn_uv_required` interceptor (today `apiFetch` has no step-up branch; MCP/LLM bypass it), admin-client Tier-4 wire-up | S–M | Laura | B |
| **A** | **Proxy client** — swap the static MK-sealed `x-cors-proxy-api-key` for `x-chatsundere-authorization: Bearer <account JWT>` in `transport.ts:94` + `mcp-client.ts:43` (`Authorization` keeps the upstream key), consume discovery `proxyUrl`, 3xx re-issue, `CorsProxyBlock` collapses to "active because you're connected" | M | Laura (+ light Larissa on the token-attach path) | 0, B |
| **C** | **Sync engine — the long pole** — Dexie **v33** (`syncOutbox`/`syncState`/`trash` + migration), engine-stamped `updatedAt` on the 4 rows lacking it (chats/messages/mindspaces/attachments), outbox enqueue at the ~35 scattered write sites, two-class write discipline, single-flight worker (drain → pull-apply), `sync-envelope` consumption, conflict resolution (per-collection LWW keys, delete-wins + trash, journal state-precedence, vectors stamp-adopt, settings server-wins, memoryBody re-dream), watermark/epoch + recovery, doorbell WS consumer, the **27 `db.verno` assertion sweep**. Carries the two cross-flags: vectors shrunk-tail cleared-state, epoch-restore mechanics | **XL** | **Larissa** (zero-knowledge boundary in the client) + Laura (offline-disabled UX) | 0, B |
| **D** | **Blob client — rides on C** — `BlobRef` transform (artefacts/attachments/personaAvatars), outbox ordering (PUT-before-record, tombstone-before-DELETE), `sync-blob` consumption, fetch strategy (thumbnails/avatars eager, originals lazy — Laura), inert-resolution + repair PUTs (409/501/413), trash interplay, quota display, epoch-recovery re-upload | L | **Larissa** + Laura | C |

**Natural cut-line if 4.5 days squeeze: WS-D.** "Sync without blobs" is a
coherent intermediate — the sync spec itself names "artefacts/attachments not yet
following" as an ordered consequence. Records sync; images follow one iteration
later.

**Per-workstream discipline:** each of 0/B/A/C/D/E gets its own
brainstorm → spec (Chris reads every spec) → plan → subagent-driven build, with
the audit gate for that unit. This file tracks the sprint; the specs/plans live
in `superpowers/`.

## 5. Open decisions — carry into the per-workstream specs

1. **Local-only user vs. authenticated proxy (WS-A, gating decision).** The new
   proxy is **token-only** (shared-key mode dropped). A local-only user has no
   account JWT → after the cut cannot use the proxy without linking an account.
   Is linking then de-facto required for egress? A real UX consequence for the
   ~10 alpha users — decide, don't discover.
2. **Sync spec §12.1 reference is wrong (WS-C).** It cites the memory-body editor
   as the two-phase-commit precedent; the editor is purely local. The real
   precedent is the **passphrase-change staging**
   (`packages/crypto/src/flows/change-passphrase.ts` + `db/staging.ts` +
   `reconcileStagingOnBoot`) — a better model (write-ahead staging + boot
   reconcile). Correct the reference and adopt the staging pattern.
3. **Server-passkey-linking caller (WS-B).** ✅ **Resolved — wired in WS-B.**
   `registerServerSyncedPasskey` (`apps/user-client/src/lib/server-passkey.ts`)
   now drives `linkPasskeyStart`/`addPasskeyPostLink` from the post-onboarding
   biometric prompt and the Account → Biometric unlock page, with a
   local-fallback path when the server-sync step fails after a credential is
   minted (never an orphan credential, never a second `credentials.create`).

## 6. Doing now

- **WS-D (blob client — rides on C) BUILT on branch `claude/03-ws-d-blob-client`**
  (stacked on WS-C) — plan `superpowers/plans/2026-07-02-ws-d-blob-client.md`, all
  10 tasks green TDD-style. `blob-transport` (binary PUT/GET/DELETE/LIST, bearer +
  one 401-refresh; the §6 size gate counts the stream and aborts over the
  MK-authenticated `BlobRef.bytes`; `validateBlobRef` 22-char id + sane bytes
  before any fetch; `x-ciphertext-hash` always the local seal output);
  `blob-transform` (seal-side `Blob`→`BlobRef`+sentinel with mint-once ref
  stability; avatar removal is a `blobRef: null` upsert, NEVER a tombstone; no v33
  bump — interface-only ref/sentinel fields); drain phase ordering (blob-put →
  record → tombstone → blob-delete; replaced-id delete deferred until the record's
  `ok` ack and suppressed on `conflict` M-2; put+delete coalesce; tombstone drops
  pending puts in the trash tx L-1); `blob-repair` (the §7 matrix behind
  `resolveBlobFailure` — 404-with-bytes repair PUT under a per-cycle GET budget +
  rest-state, 409/corrupt-body → tamper + fresh-id repair capped at 3 generations,
  413 → durable oversize sentinel, quota → attention, 501 → suppressed); the fetch
  strategy (eager thumbs/avatars concurrency-3 + view-priority, lazy
  `useBlobBytes` for originals/attachments with detach-on-unmount-but-complete;
  bytes written only after `openBlob` authenticates them — no partial writes); the
  three-collection write-site sweep; the per-item markers + placeholders + quota
  line + the "Fetching images…" status gate; and the epoch blob re-upload wired
  into recovery. **The adversarial blob scenarios caught a real gap** — the §8
  epoch blob re-upload was never wired — fixed (`recovery.ts` `recoverBlobs()`
  diffs local refs against the inventory and idempotently re-PUTs what the server
  lost, after the record re-push and before the epoch persist, threshold-asking
  above 512 MiB, contained by the M-4 flap limit). Verification battery:
  `pnpm typecheck --force` **14/14** (0 cached); user-client vitest **2548 pass /
  0 fail**; ui-shared **68**; `pnpm build` **9/9**; Biome clean; no NUL bytes in any
  blob module. §11 invariants have dedicated passing tests (size-gate abort,
  local-hash PUT, `mintBlobId` randomness/one-ref, M-2 deferred delete, repair
  caps + tamper). **Awaiting Larissa (`blob-transport`/`blob-repair` + the
  recovery re-upload) + Laura (§10 placeholders/markers/lightbox) + Chris's spec
  §14 MinIO two-browser manual verification;** PR to `full-backend-transition`.
- **WS-C (sync engine — the long pole) BUILT on branch `claude/02-ws-c-sync-engine`**
  (stacked on WS-A) — plan `superpowers/plans/2026-07-02-ws-c-sync-engine.md`, all
  16 tasks green TDD-style. Dexie **v33** (syncOutbox/syncRows/syncState/trash +
  the updatedAt-stamp migration, 27-verno sweep); the pure foundations
  (`sync-keys`/`strip` [settings allowlist polarity — corsProxy/adultMode/one-shot
  flags stay device-local]/`resolution` [LWW + settings replay guard M-8 + state
  precedence + stamp adoption]/`gate`/`copy`/`watermark`); `enqueue`/`mutateSynced`
  (atomic outbox + Class-2 write-through, cascade tombstones, offline-defer); the
  single-flight worker (drain: coalesce/seal/byte-batch/CAS/poison-adoption M-1/
  piggyback L-1, watermark never advances in push) and the apply pipeline (echo
  local-hash shortcut §7.0, inert rejection §7.1, H-1 trash-anchored terminality,
  L-3 pending-delete suppression, tombstone→trash L-6 + §7.3a threshold/panic,
  per-collection resolution, coalesced invalidation); triggers/boot wiring, epoch
  recovery (flap rate-limit >2/hr → recovery_paused, reachable only from the
  authenticated path), the doorbell (4401 ≤1-refresh then degrade, ticket/URL out
  of diagnostics); the Class-1 + Class-2 write-site sweeps with disabled-over-hidden
  gating; SyncStatusLine + attention surfaces + the ConnectivityBadge offline
  framing; and the two-device adversarial scenarios. **The scenarios caught a real
  bug** — a pure-reader device never pulled (`runSyncCycle` only pulled on
  `needsPull`, but an empty outbox returns `head:null`) — fixed (pull when
  `needsPull || head === null`, L-1 preserved). Verification battery:
  `pnpm typecheck --force` **14/14** (0 cached); user-client vitest **2441 pass /
  0 fail**; ui-shared **68**; `pnpm build` **9/9**; Biome clean; no NUL bytes in any
  sync module. Security invariants (§12) each have a dedicated passing test (inert
  rejection, H-1, watermark monotonicity + stale-rev + local-hash echo, recovery
  rate-limit, doorbell 4401 cap, settings allowlist). **Awaiting Larissa (full
  zero-knowledge-boundary re-audit of the built diff — apply/worker/recovery/
  doorbell/strip) + Laura (offline-disabled UX + status surfaces; two soft
  deferrals logged: visual-effects settings left device-local, dense auto-save
  editors gated at the container) + Chris's spec §15 two-browser manual
  verification;** PR to `full-backend-transition`.
- **WS-A (proxy client) BUILT on branch `claude/01-ws-a-proxy-client`** (cut from
  `full-backend-transition`) — plan `superpowers/plans/2026-07-02-ws-a-proxy-client.md`,
  all 8 tasks green TDD-style. llm-unified: `ProxyAuthSource` late-binding seam,
  transport swap (`x-chatsundere-authorization` account JWT + `x-cors-proxy-target`,
  `redirect: 'manual'`), `fetchWithProxyAuth` (single 401-refresh + opaque-redirect →
  terminal `ProxyRedirectError`) and `withStreamingRetry.onUnauthorised`. user-client:
  boot-registered `proxyAuthSource`/`isProxyAvailable`, corsProxy threading retired
  across the send path (`WebContext`/`IntegrationContext` → a single `useProxy`),
  gate-driven availability (`useServerGate('proxy')`/`isProxyAvailable`), MCP proxy
  swap, and `CorsProxyBlock` collapsed into read-only `ServerRelayStatus`. Verification
  battery: `pnpm typecheck --force` **14/14** (0 cached); llm-unified `bun test` **420
  pass**; ui-shared **68**; user-client vitest **2253 pass / 0 fail** (clean end of the
  0/8 baseline); admin-client 40 pass / 2 pre-existing env-parse baseline failures
  (untouched, no llm-unified import — missing `.env` in the container); `pnpm build`
  **9/9**; Biome clean. Retirement greps: production code carries no
  `corsProxyUrl`/`corsProxyKey`/`x-cors-proxy-api-key`/`VITE_PROXY_URL` (residuals are
  deliberate negative test guards + the unrelated pre-existing admin `VITE_PROXY_URL`).
  Attach-scope invariant holds — the account JWT is attached at exactly two sites
  (llm-unified transport cors-proxy branch + `mcp-client.ts` proxy branch), both
  null-guarded, redacted from diagnostics. **Awaiting Larissa (light audit of the
  token-attach path) + Laura (pre-squash on the relay-status/provider surfaces) +
  Chris's spec §11 manual verification;** PR to `full-backend-transition`.
- **WS-E (step-up vertical) + WS-B (onboarding un-gate) BUILT on a branch cut
  from `full-backend-transition`** — spec
  `superpowers/specs/2026-07-02-ws-b-e-onboarding-and-step-up-design.md` (v2,
  Laura-passed), plan `superpowers/plans/2026-07-02-ws-b-e-onboarding-and-step-up.md`,
  all 11 implementation tasks green. **WS-E** (Tasks 1–7): step-up wire shapes
  in `shared-types`; auth-service t1-seeding on fresh OPAQUE/recovery evidence +
  the recovery `opaque_client_identifier` fix + tier enforcement on
  passkey-link / auth-method removal / passphrase-change / account-delete; the
  `packages/crypto` step-up ceremony flows (`stepUpWithPasskey`/`…Passphrase`);
  the `packages/ui-shared` step-up store + shared `StepUpModal`; the `apiFetch`
  403 `step_up_required` interceptor + modal host in both user-client and
  admin-client. **WS-B** (Tasks 8–11): un-gated onboarding matrix +
  probe-validated URL entry; the server-linking page made real off the
  `account-link.store`; Add-a-device pairing-code generation UI; server-synced
  passkeys (§5 decision #3). Verification battery: typecheck 14/14 (0 cached),
  crypto 189, ui-shared 68, admin-client 45, user-client 0-failure baseline (one
  known load-dependent `stream-manager-store` flake, unrelated — passes in
  isolation and on clean runs), auth-service 149 pass / 12 skip / 4 fail (the 4
  are the pre-existing `bootstrap.test.ts` environmental subprocess baseline),
  `pnpm build` 9/9, Biome clean. **Awaiting Larissa (auth-service +
  `packages/crypto` + both interceptor paths) and Laura (pre-squash on WS-B's
  user-reachable flows), then squash as two units and Chris's §15 manual
  verification.**
- **WS-0 Foundation** — built earlier on `full-backend-transition`; consumed by
  the WS-B work above (matrix `probeServer`, `account-link.store`,
  `discovery.store`).

## 7. Next

1. **WS-0 Foundation** — ✅ built, done-pending-verify (Liz review + Chris's
   spec §13 manual verification on a dev build).
2. **WS-B + WS-E** (onboarding un-gate + step-up) — ✅ built on the branch,
   awaiting Larissa + Laura audits and squash; produces linked accounts to
   exercise the rest.
3. **WS-A** proxy client — ✅ built on `claude/01-ws-a-proxy-client`, green on the
   branch, awaiting Larissa + Laura audits and Chris's device-verify; PR open to
   `full-backend-transition`.
4. **WS-C** sync engine — ✅ built on `claude/02-ws-c-sync-engine` (stacked on WS-A),
   green on the branch, awaiting Larissa + Laura audits and Chris's device-verify;
   PR open to `full-backend-transition`.
5. **WS-D** blob client — ✅ built on `claude/03-ws-d-blob-client` (stacked on
   WS-C), green on the branch, awaiting Larissa + Laura audits and Chris's
   MinIO device-verify; PR open to `full-backend-transition`.
6. Turnkey gate → merge to master → hand off to the separate go-live event.
- **WS-B + WS-E BUILDING remotely** — spec
  `superpowers/specs/2026-07-02-ws-b-e-onboarding-and-step-up-design.md` (v2,
  Laura-passed), plan
  `superpowers/plans/2026-07-02-ws-b-e-onboarding-and-step-up.md` handed to an
  overnight worker; PR to this branch expected. Integration pipeline on
  arrival: Liz review → Larissa (auth-service + crypto touched) → Laura →
  merge.
- **WS-A / WS-C / WS-D fully specced and planned (2026-07-02 evening):**
  - WS-A: spec `…ws-a-proxy-client-design.md` (v2, Laura-passed) + plan
    `…ws-a-proxy-client.md`. Open decision 1 RESOLVED: linking is the
    prerequisite for proxy egress, no legacy escape hatch. Found + pinned:
    browser fetch cannot read a proxied 3xx's Location — client re-issue
    (server spec §5.3) is impossible; terminal constructive error + a
    server-side 3xx-envelope follow-up registered for go-live.
  - WS-C: spec `…ws-c-sync-engine-design.md` (**v2** — Larissa spec-pass
    H-1/M-1–M-8/L-1–L-7/I-1–I-5 + Laura 2-hard/7-soft folded) + plan
    `…ws-c-sync-engine.md` (16 tasks). Open decision 2 RESOLVED (staging
    pattern, reference corrected). Chris decisions: trash internal-only v1,
    minimal status line (enriched vocabulary), Dexie v33 confirmed, offline
    bookmarking stays Class 2 with gentle copy.
  - WS-D: spec `…ws-d-blob-client-design.md` (**v2** — Larissa M-1–M-4/
    L-1–L-5/I-1–I-3 + Laura 1-hard/5-soft folded) + plan
    `…ws-d-blob-client.md`. Chris decisions: simple fetch strategy (eager
    thumbs/avatars, lazy originals), quota in the status line.
  - Spec-pass auditor models this sprint: Larissa as Fable, Laura on Opus 4.8
    (Chris 2026-07-02).

## 7. Next

1. **WS-0** — built; Chris's spec §13 manual verification on a dev build
   still owed.
2. **WS-B + WS-E** — remote build in flight → integrate on PR arrival
   (Liz review, Larissa, Laura, merge).
3. **Hand off the remaining plans SEQUENTIALLY: A → C → D**, each cutting
   from the branch tip after the previous PR merges. A and C both touch
   `send-message.ts`/`stream-engine.ts`/settings routes (A removes corsProxy
   threading, C adds enqueue calls) — parallel runs would manufacture
   integration conflicts. D's STOP-guard requires C landed.
4. Post-build per workstream: Liz review → Larissa re-audit of the built
   diff (A: token-attach path light; C: full zero-knowledge boundary; D:
   blob-transport/repair) → Laura pre-squash → merge to this branch.
5. Weekend: device testing (the specs' §-manual-verification lists),
   bugfixing, polish.
6. Turnkey gate → merge to master → hand off to the separate go-live event
   (which now also owns: the proxy 3xx JSON-envelope follow-up, the
   shared-proxy-retired cut message — a REQUIRED artefact coupled to WS-A).

## 8. Pointers

- Backend contracts (the client seams live in each spec's "§ client engine" +
  "scope boundary" sections):
  - Proxy: `superpowers/specs/2026-07-01-authenticated-cors-proxy-design.md`
    (§7 discovery, §12 seam)
  - Sync: `superpowers/specs/2026-07-01-client-sync-design.md`
    (§11 discovery, §12 client engine, §16 seam)
  - Blob: `superpowers/specs/2026-07-02-blob-transport-and-deployment-docs-design.md`
    (§11 dispositions, §12 client engine, §16 seam)
- Server-side status + owed re-audits: [[STATUS-BACKEND]]
- Client feature history: [[STATUS-CLIENT-ONLY]]
- Future-feature couplings register (Dexie-version ownership): [[insights/future-feature-couplings]]
- Roadmap / ADR 0031: [[ROADMAP]]
