# Chatsundere Status — Backend

**Last updated:** 2026-07-14 — **v0.2.0 CUT AND PUSHED — BACKEND GO-LIVE.** Chris
completed the spec-§9 device verification owed by the 2026-07-13 entry (all
surfaces looked correct locally), pushed the pre-go-live fix bundle, and tagged
`v0.2.0` on `b5d00085` (the master tip). `master` and `origin/master` are in sync.
**Run `29362731641` green** — Build Backend 1m6s, Build Frontend 4m31s. Verified
against GHCR, not merely from the run status: `chatsundere-backend` now answers on
`latest` / `0.2.0` / `0.2` / `0`, with `latest` and `0.2.0` sharing digest
`sha256:3d48ad2f…`; `chatsundere-frontend` likewise on `sha256:8070443b…`.

**Why the tag was the missing piece:** the backend image had never carried a
`latest`. `latest` is deliberately gated on a `v*.*.*` tag push
(`.github/workflows/docker.yml:78`/`:182`) so that Watchtower — which watches
`:latest` — only moves on a conscious release, never on a plain master merge. The
backend job only entered CI with `f301478e` (2026-07-07), and the last tag before
now was **v0.1.4 (2026-06-30)**, so no tag had ever contained the backend job.
`v0.2.0` is the first that does, which is why this is both the go-live and the
first backend `latest`. `deploy/compose.template.yml` pins
`chatsundere-backend:latest` at lines 19/64/120 and was therefore dangling until
this tag.

**`version.txt` bumped 0.1.0 → 0.2.0.** Tagged builds read the version from the
ref, so the image is `0.2.0` either way; the bump exists so subsequent master
builds produce `0.2.0-pre.N` rather than a `0.1.0-pre.N` that sorts *below* the
shipped release.

**Standing lesson:** a release tag is not a build step — it *is* the deploy.
Watchtower pulls `latest` the moment the tag build lands. Cut it only behind the
verification gate, never to "get an image built".

Prior entry: 2026-07-13 — **PRE-GO-LIVE FIX BUNDLE LANDED: six units
squashed to `master` (A→F), NOT pushed — Chris pushes after his device
verification.** *(Both OWED items below are now discharged — see the 2026-07-14
entry.)* The release-day audit (pairing / client sync / CORS proxy /
recovery-key restore) surfaced one BLOCKER + one HIGH + a set of MEDIUMs; all six
fix units are now built, audited, and on master. **Server-relevant units:
Unit A** (`84d3f7dd`) — the BLOCKER fix: the pairing QR and bootstrap CLI minted
`${API_BASE_URL}/join#code` WITHOUT the `/auth` strip the invitation mint had, so
on the deploy-kit topology every QR-driven pairing 404'd. All three mint sites now
route through one shared `buildJoinQrUrl` helper (auth-service) that strips `/auth`
uniformly and, when the new optional **`APP_PUBLIC_URL`** env is set, points QR
codes at the client origin `${APP_PUBLIC_URL}/join?server=…#code`; the client
serves a new public `/join` chooser route so a system-camera scan (the HIGH) lands
on a real screen. New env wired through the deploy kit (`generate.sh`,
`deployment.env.template`, `DEPLOYMENT.md`). **Unit C** (`6b143299`, MEDIUM-1) —
document/library delete now enqueues `vectors` tombstones server-side (same
blind-id key path as the upsert, verified byte-for-byte; excluded from the
user-facing tombstone tally). **Client-side units B/D/E/F** are summarised in
[[STATUS-CLIENT-ONLY]] (2026-07-13). **Audits:** **Larissa CLEAR** on the Unit A
auth-service diff (env parity with `ADMIN_PUBLIC_URL`, no injection/info-disclosure,
join code rides the fragment as before, no new route, no new wipe path, ZK intact)
**+ courtesy CLEAR** on B+C (tamper guard monotone, tombstone keys blind-id-only
with no new plaintext, blind-id memo MK-scoping safe — **no security-deferrals row
warranted**). Laura no hard defects on A/D/E. **Verified pre-audit (still true):**
wire contracts no-drift, wafer/xAI `bad_target` fix on master (`62874ec4`,
regression-tested), Content-Encoding fix present, recovery-key format tolerance
test-pinned. Gates on `master` post-squash: `pnpm typecheck --force` **14/14** (0
cached); auth-service `bun test` **209 pass / 12 skip / 0 fail** (the pre-existing
`admin-users` ordering artefact passed this run); full user-client vitest **2967
pass / 9 environmental**; `pnpm build` **9/9**; llm-unified **421/421**; no Dexie
bump. **Six squash SHAs:** A `84d3f7dd` · B `b4a4944b` · C `6b143299` · D
`cf5b3f77` · E `cd0a3935` · F `16890861`. Spec/plan under `superpowers/`; branch
`fix/pre-golive-bundle` kept until push. **OWED: Chris's spec-§9 device
verification** (system-camera + in-app scans of both QR forms against the staged
prod topology — closes F7's "one live scan"; recovery copy; flow-R back; relay-cut
footer; empty-account status; many-chunk delete no-alarm/no-hang) **+ the non-code
checklist** (one real xAI/wafer proxy send with a real key) **then the push.**

Prior entry: 2026-07-10 (later) — **`TRUST_PROXY_HOPS` ON AUTH SQUASHED to
`master` (`dc25cdd`, one feature unit). NOT pushed — Chris pushes.** Closes the
long-tracked go-live blocker **L-β-2** (auth's per-IP rate limits were
client-spoofable: `ipKey()` read the LEFT-most `X-Forwarded-For`, so a client
without a fronting proxy could forge the header and bypass the step-up, `/join`,
and login/passkey/recovery per-IP limits). Fix ports the already-audited
proxy/sync pattern into auth: new `net/client-ip.ts` (`deriveClientIp`, verbatim
copy) reads the trusted hop `TRUST_PROXY_HOPS` positions from the RIGHT of
`X-Forwarded-For` over the real socket peer (`index.ts` now injects it via
`server.requestIP`), and `ipKey()` uses it. The interim default-off boolean
`RATE_LIMIT_TRUST_FORWARDED_IP` is **replaced** by `TRUST_PROXY_HOPS` (int,
default 1 for the single Traefik hop; `.env.dev`=0, no proxy on loopback); the
per-IP login backstop now runs **unconditionally** on the spoof-resistant
address, with the `'unknown'` sentinel the sole exclusion (Finding M2 both harms
stay closed — Larissa confirmed the `'unknown'` fallback, deliberately unlike
sync's `'0.0.0.0'`, is what keeps harm-1 shut). Deploy kit wired
(`compose.template.yml`; `deployment.env.template` already had it) + `.env.example`
+ `DEPLOYMENT.md` §4.1. Built inline TDD (RED→GREEN watched); **Larissa CLEAR TO
SQUASH** (no Crit/High/Medium; 3 informational, all documented/proxy-sync-parity).
Gates: `pnpm typecheck --force` **14/14**; Biome clean; new tests client-ip
**7/7** + ip-key **5/5** + login-backstop routes **4/4** + rate-limit unit **1/1**;
full auth-service suite **204 pass / 12 skip / 1 fail** — the lone fail
(`admin-users` "returns the filtered total") is **pre-existing** (proven: passes
under a `-t` filter and fails identically on the stashed base code — a within-file
test-ordering artefact, zero relation to this change). **Environment note:** the
running dev Redis container (`chatsundere-dev-redis-1`) is in a corrupt state
(its working dir was removed host-side → can't persist, can't be `exec`d); tests
ran against an isolated throwaway Redis. Recreate it before the next `./dev.sh`
(`docker rm -f` + `./dev-infra.sh`; Postgres/accounts unaffected). Branch
`feat/auth-trust-proxy-hops` kept until Chris pushes. L-β-2 + the deployment-kit
`TRUST_PROXY_HOPS` row closed in [[insights/follow-ups-index]] /
[[insights/security-deferrals]].

Prior entry: 2026-07-10 — **OPAQUE/SYNC HARDENING SPRINT SQUASHED to `master`
(3 feature units: `8a19192d` auth+sync, `78d2cb59` client sync engine, `252e47ac`
(3 feature units: `8a19192d` auth+sync, `78d2cb59` client sync engine, `252e47ac`
client identity). NOT pushed — Chris pushes.** A ~20-finding hardening sprint from
an external second-opinion review (Codex, run by a tester), every finding first
cross-verified against the real code by four parallel audit passes (register
[[insights/2026-07-10-opaque-sync-hardening-findings]]; spec
[[../superpowers/specs/2026-07-10-opaque-sync-hardening-design]]). **Nothing was a
zero-knowledge/plaintext/key breach**; the heaviest were a *Critical* data-loss and
an adversarial-server DoS — both on the very engine going live at v0.2.0.
**Workstream A (server):** #2 collection validation before store, #9 atomic GETDEL
state-consumption (4 sites) + partial unique index, #8 atomic Lua login limit +
trust-gated per-IP backstop, #10a decoy OPAQUE wraps (enumeration oracle), #10b
hard-fail on missing OPAQUE_SERVER_SETUP, plus C1b (pairing conveys the frozen
identifier). **Workstream B (client sync, 12 tasks):** #2-client crash-proof pull
loop, #4a/b/c lock+TOCTOU+monotone-rev, #5 hold-watermark on MK-vanish (no silent
loss), #6a/b epoch-recovery blobs, V embeddingStatus device-local, #7 corpus-wide
reconnect reconciliation, C/P/G. **Workstream C (crypto):** #1 master-key buffer
copy (the Critical — a *successful* linked-online login was wiping the vault via a
shared-then-zeroed buffer; regression test covers the previously-untested happy
path), #3 frozen OPAQUE client identifier across renames, R online-recovery adopts
the access token. Built spec→plan→**subagent-driven (24 tasks + fix waves,
per-task spec+quality reviews, the subtle ones on opus)**; the review loop caught
real cascading bugs the register missed (2 extra #9 GETDEL sites, B9's
cryptographically-broken re-seal premise, B11 key-order divergence, B12 stuck
indicator, C1b pairing gap). **Whole-scope Larissa over all three surfaces:
CLEAR TO SQUASH** — no Crit/High/Medium; the pairing-start identifier disclosure
adjudicated acceptable (already obtainable pre-auth via `/login/start` wrap_aad);
all seven adversarial-server client-sync invariants verified to hold composed.
Gates on master post-squash: `pnpm typecheck --force` **14/14**; crypto `bun test`
**218/0**; user-client sync vitest **391/0**; auth-service **194/0**; Biome clean.
No Dexie/crypto-DB version bump (optional non-indexed fields). Four non-blocking
Low follow-ups tracked (L-A1..L-A4 in [[insights/follow-ups-index]]): eager
OPAQUE-setup check + `/readyz`, migration 0006 duplicate-row note, renamed-account
`wrap_aad` privacy pass, recovery blob re-push ordering. **OWED: Chris's
device-verify (spec §9 — linked-online login #1, rename→login/step-up/pairing #3,
online-recovery R) then push.** Branch `feat/opaque-sync-hardening` kept until push.

Prior entry: 2026-07-09 — **Proxy-service fix: `ERR_CONTENT_DECODING_FAILED`
on non-streaming forwards SQUASHED to `master`.** Chat titles stopped generating;
the console showed intermittent `POST /v1/chat/completions net::ERR_CONTENT_DECODING_FAILED
200`. Root cause (reproduced empirically): Bun's `fetch` transparently decodes the
upstream body (gzip/br) but leaves `Content-Encoding` on the response headers;
`filterResponseHeaders` forwarded it verbatim while the route re-streamed the
already-decoded body → the browser tried to gunzip plaintext. Only non-streaming
JSON replies hit it (title-gen, memory-extraction); SSE carries no `Content-Encoding`.
Two-layer fix: `buildForwardHeaders` now forces `Accept-Encoding: identity` upstream
(no compression at source), and `filterResponseHeaders` strips `content-encoding` +
`content-length` (safety net; the stale content-length was also a latent desync
vector Larissa flagged as removed). Proxy suite **87/87**, typecheck clean.
**Larissa CLEAR TO SQUASH** (Finding 2 closed at source — no deferral). **NOT pushed.**
Prior entry: 2026-07-07 (later) — **DEPLOYMENT KIT for the v0.2.0 backend
go-live SQUASHED to `master`** (two feature units: `f301478e` "Add backend
container image and CI; bake admin console into the frontend image" + `45ba197d`
"Add self-hosted deployment kit and update deployment docs"). **NOT pushed —
Chris pushes after the VPS staging dry-run.** The whole backend (auth+sync+proxy
+postgres+redis+minio) was built/merged/audited but never deployed; this kit makes
the first deploy real for Chris AND for third-party self-hosters (AGPLv3). What
landed: **(1)** a single **backend image** (`apps/backend/Dockerfile`) carrying all
three Bun services (pnpm/corepack install, Bun runtime, service chosen by compose
`command:`) + a CI `build-backend` job mirroring the frontend (cosign, `:latest`
tag-gated); **(2)** the **admin-client baked into the frontend image** under
`/admin/` (same-origin, so the shipped Admin tile works in prod); **(3)** a
`deploy/` kit — `compose.template.yml` (unified frontend+backend+infra behind an
existing Traefik), `deployment.env.template`, `generate.sh` (local, openssl-only,
mints all random secrets + renders the compose), `install.sh` (server: MinIO
bucket+scoped-key, OPAQUE-once, bring-up, first-admin bootstrap), prod Postgres
init, README; **(4)** `INSTANCE_NAME` namespacing so **two Chatsundere stacks run
side-by-side on one host/Traefik** (Ksena's catch — Traefik router names are
globally unique per Traefik; list-form labels required). Built spec→plan→
**subagent-driven (8 tasks + fix wave + INSTANCE_NAME), per-task spec+quality
reviews**; **whole-branch opus review** "ready with fixes" (all folded);
**Larissa CLEAR TO SQUASH** (OPAQUE-once + MinIO scoped-not-root robust; network
posture sound; no secrets in git). **Corrections the live checks caught:** auth+
sync **migrate-then-serve** in their compose command (`index.ts` runs no migrator);
`mc version suspend` not `disable` (live-verified vs dev MinIO); `bootstrap-admin`
is **non-interactive** (mints the first invitation — spec/DEPLOYMENT.md corrected);
`bun run` banner-on-stderr fixed in the invitation capture (live-verified);
`TRAEFIK_AUTH_USERS` `$$`-doubled (Compose `--env-file` interpolation); auth
`/metrics//healthz//readyz` no longer publicly routed (`cs-auth` scoped to
`PathPrefix(/api)`); prod Prometheus scrape config (was dev `host.docker.internal`);
openssl-only base64url (dropped `basenc` → stock-macOS-safe). Gates: image builds;
`docker compose config` parses (monitoring on/off); shellcheck clean; `nginx -t`
ok; **live**: `mc` scoped-key + `bootstrap-admin` capture against real containers.
**OWED: Chris's VPS staging dry-run (spec §10) — `generate.sh` → scp `out/` →
`install.sh` → healthy → MinIO key → OPAQUE → `/readyz` → invitation → register →
chat/sync/blob through the new proxy — then push.** Before the real go-live,
resolve the tracked **`TRUST_PROXY_HOPS` on auth** (L-β-2, per-IP rate-limit
spoofing). Spec/plan:
[[../superpowers/specs/2026-07-07-deployment-kit-design]],
[[../superpowers/plans/2026-07-07-deployment-kit]].

---

**Prior — 2026-07-07:** **PRE-TEST-ANALYSIS OPEN ITEMS #8 + #9 FIXED on
the remote branch `claude/pre-test-analysis-open-items-6s118y`** (remote
session; the #1–#4/#6 fix branch is merged to master as PR #26, `25e0e80`).
**(#8 Medium)** generic sync transport failures are no longer invisible: the
cycle wrapper counts consecutive whole-cycle failures (only while connectivity
reads `linked_online` — airplane mode never false-alarms) and raises a new
self-healing `transport_failing` attention after 3; the next completed cycle
retires it and stamps `lastSyncAt` (previously **never written** — the
"Synced · …" suffix now works as a side effect). Renders app-wide via
`GlobalSyncLine`, where it is collapsible to the dot (Laura's lead soft,
folded: an affordance-less attention pinned over the chat would be nagging).
**(#9 Low)** the Entrance Hall no longer misdirects a freshly
recovered/paired user: while the first post-link sync is pending (linked,
`linked_online`, `lastSyncAt === null`) a calm non-gold `FirstSyncCard`
("Syncing your account…") takes the Crown instead of the SetupCard's "Create
your first companion" (duplicate-persona risk); local-only and
offline/unreachable devices keep the SetupCard (the cue could never resolve
there). **Laura pre-squash on both: no hard defects** (3 residual softs ruled
acceptable-as-built, logged in [[insights/follow-ups-index]]). Not a Larissa
path (client-only sync engine + Entrance Hall; no crypto/auth/sync-service
change). Gates: `pnpm typecheck --force` **14/14**; full user-client vitest
green (incl. 6 new transport-attention, 4 new first-sync-gate, 2 new
GlobalSyncLine collapse tests); Biome clean on changed files. **Still open
from the analysis: #5 (mindspace convergence — dedicated session), #7
(join/finish invitation strand — runbook now, structural fix a Lyra/Chris
design question), #10 (QR native-camera dead end — operator docs + F7
convention decision).** Test-plan impact recorded in the analysis addendum
(steps 2 + 9 now carry *fixed* expectations). **OWED: Chris reviews + merges
the branch; the manual multi-device run.**

---

**Prior — 2026-07-06 (late):** **PRE-TEST-ANALYSIS FIXES built on the
remote branch `claude/pre-test-analysis-fixes-ltcwag`** (remote session; Chris
asked for the problems in `PRE-TEST-ANALYSIS-v0.2.0.md` to be fixed ahead of
tomorrow's test run). **Findings #1–#4 and #6 are fixed; #5 and #7–#10 stay
open as test targets** (rows added to [[insights/follow-ups-index]]; the
analysis file carries a fix-status addendum with the revised test-plan
expectations). What landed: **(#1 Critical)** recovery-key regeneration now
reaches the server — new `POST /api/v1/me/recovery` (Tier-1 step-up, material
validated, audited as `recovery_key.regenerated`), `ServerClient.updateRecovery`
+ wire types, account page pushes **server-first** via the crypto flow's
`serverUpdate` (failure → honest "NOT changed" alert; link-state `unknown`
refuses), login-screen recovery disables regeneration for linked accounts and
names My Account → Recovery Key. **(#2 High)** the in-app "Delete all my local
data" now runs the full `wipeDevice()` erase, with link-state-honest confirm
copy. **(#3 High)** `DELETE /api/v1/me` refuses the primary admin (403, checked
before the step-up ceremony). **(#4 High)** the logout page gains a linked-only
"Delete my account everywhere" — server delete first (nothing deleted anywhere
on failure), then device wipe; disabled-with-reason for the primary admin.
**(#6 Medium)** role change revokes the subject's sessions exactly as suspend
does; transfer-primary revokes both actor and target (integration tests pin the
deny entries; admin-users tests re-issue tokens after the transfer). **Bonus:
the entire auth-service "OPAQUE baseline" failure set is fixed** — the stale
`${API_BASE_URL}/v1` OPAQUE server identity sat in **13** integration-test
fixtures (root cause of the long-carried red set, incl. the `buildProof`
serverId bug); all aligned with `opaqueServerIdentity(origin)`, the bootstrap
CLI tests' hard-coded `/home/chris/…` cwd made portable + spawned CLI given
`env: {...process.env}` — suite green for the first time: **174 pass / 12 skip
/ 0 fail** against native PG16+Redis, so `recovery/finish` finally has green
automated coverage. **Audits:** **Larissa CLEAR TO SQUASH** — her MEDIUM
(regenerate tail failure: server accepted, local write failed → key minted
but never revealed = probability-gated lockout) was **fixed, not deferred**
(`localWriteFailed` result + honest split-state reveal, tests pinned); both
LOWs fixed (stray `dump.rdb` removed + gitignored; delete-everywhere 403 now
branches on envelope code); informationals done (pino redact names for the new
wire fields, AAD non-empty check) and the Tier-1-vs-Tier-3 decision recorded in
[[insights/security-deferrals]]. **Laura pre-squash CLEAN** — 3 of 4 softs
folded (honest "everywhere" residue copy, confirm-modal failure nuance,
login-checkbox `null` link-state fails safe); the 4th (stale cached role gates
the disabled reason — pre-existing Q2 caveat) logged in
[[insights/ux-deferrals]]. Gates: `pnpm typecheck --force` **14/14**; build
**9/9**; user-client vitest **2836/0** (full clean run); crypto `bun test`
**201/0**; auth-service **174/0**; Biome clean on all changed files. STATUS
staleness flagged by the analysis (step-up modal/interceptor, onboarding
three-path) corrected below. **OWED: Chris reviews + merges the branch, then
tomorrow's manual multi-device run** (test plan in the analysis file, steps
1/3/4/8 now carry the *fixed* expectations).

---

**Prior — 2026-07-06:** **EXTERNAL-REVIEW BACKEND HARDENING squashed to
`master`** (`672e72e5`, one feature unit). Four defects from an external code
review (Codex, run by a tester) — each verified against the real code before
touching it. **(1) Refresh-token rotation race (was Critical)** — `refresh.ts`
did read-then-write without atomicity, so two concurrent presents of the same
still-valid token both minted a successor → two live tokens in one family,
defeating re-use detection. **Reproduced empirically: 39/40 concurrent pairs
double-minted before, 0/40 after.** Fix: **revoke-first** — an atomic conditional
claim (`UPDATE … WHERE id = ? AND revoked_at IS NULL RETURNING id`) before
issuing the successor; the race loser is denied (`reuse_detected`, no family
nuke — a benign multi-tab race is indistinguishable from theft at claim time and
the winning rotation is intact). Pinned with a looping race test (needs live PG).
**(2) Redis limiter immortal buckets (sync + proxy, was Medium)** — INCR then a
separate EXPIRE could leave a TTL-less bucket on a mid-op fault; now one atomic
constant Lua script. **(3) Doorbell subscribe (was Medium)** — a failed SUBSCRIBE
left a socket counted healthy that never receives pokes; a failed subscribe now
tears the account's sockets down (client reconnects + re-subscribes). **(4) Proxy
dropped explicit target port (was Low)** — `https://host:8443` connected on 443;
`Target` now splits `hostname` (DNS + SNI) / `host` (Host header, with port) /
`port` (pinned connection). **No SSRF change — the blocked-range check still
governs the pinned IP** (Larissa verified). Gates: `pnpm typecheck --force`
**14/14**; proxy `bun test` **84/0**; sync `bun test` **131 pass** (1 pre-existing
`ops.test` CORS fail, confirmed identical on master — environmental); auth rotation
test **6/0** vs `auth_db_test`; auth no-DB fail-set **identical to master** (my
change adds zero regressions); Biome clean. **Larissa CLEAR-TO-SQUASH** (no
Crit/High/Med/Low; two informational notes, both already commented). **NOT pushed**
— master is 3 commits ahead of origin (this + username-uniqueness + the Codex
deferrals doc). Codex #4/#6 (embeddings byte-budget bypass + `rowBytes` throw)
were **Low/client-local** — logged in `follow-ups-index.md`, deferred.

---

**Prior — 2026-07-06:** **USERNAME-UNIQUENESS across the server link fixed
on `full-backend-transition`** (one squashed feature unit, ahead of the v0.2.0
go-live). Two defects Chris found in a multi-device test, one root cause: the
client did not enforce username uniqueness across the local↔server boundary.
**Defect A** — a late-link username conflict was silent: in the late-link path
(`confirm.tsx`) no username field is rendered, so the correctly-set inline error
landed in a hidden field. Fix: on a late-link `409 username_taken` /
`CryptoError('conflict')` the screen now enters a **rename-and-retry mode** —
reveals the username field pre-filled with the local name, `changeUsername`
local-only (device not yet linked) then retries `linkToServer`; a repeat conflict
renders inline. (Laura spec-pass v1 killed the original pairing-CTA remedy as a
structural dead-end — `finishJoinByPairing` refuses any device with a local
account — so the CTA was replaced by the rename-and-retry Chris used manually.)
**Defect B** (the dangerous one) — "My Account" rename called `changeUsername`
**without** a `serverPatch`, so a **linked** account renamed locally-only,
bypassing the server unique constraint (local/server username divergence → OPAQUE
online-login sends the wrong identity). Fix: `account.tsx` now wires
`serverPatch` → `PATCH /api/v1/me` **server-first, offline-refuse** only when
linked (409 → "already taken" copy; network/5xx → "wasn't changed" copy; unlinked
stays local-only; `'unknown'` link state refuses — Larissa LOW-2). New wire types
`PatchMe{Request,Response}`, a `patchMe` method on the `ServerClient` interface
(+ HTTP adapter, admin-client stub, 8 crypto test-mocks), and `InlineEditRow` now
**surfaces the thrown `Error.message`** (Laura HARD #2 — it previously swallowed
every message). Server `me.ts` unchanged (already correct). Built spec→**Laura
spec-pass v1 (2 HARD, both fixed)→v2 CLEAN**→TDD build→**Larissa CLEAR** (no
Crit/High/Med; LOW-2 fixed inline; LOW-1 residual-TOCTOU + LOW-3 sticky-rename
logged in `security-`/`ux-deferrals`)→**Laura pre-squash CLEAN** (1 soft focus
note logged). Gates: `pnpm typecheck --force` **14/14**; crypto `bun test`
**190/0**; user-client vitest at the **8** Node-localStorage baseline + new
coverage (mapSubmitError conflict/invalid_input, InlineEditRow message-surfacing,
account rename linked/unlinked/409/offline/unknown, late-link rename-mode entry).
No Dexie bump. **NOT pushed — OWED: Chris device-verify (spec §7: two browsers
same name → rename-and-retry; linked rename 409; offline rename; free rename +
admin console; unlinked local rename) then push.** Spec
[[../superpowers/specs/2026-07-06-username-uniqueness-across-link-design]].

---

**Prior — 2026-07-06:** **ARTEFACT EXPERT landed on `full-backend-transition`**
(squashed feature unit `59fd45dd`, ahead of the v0.2.0 go-live). Second member of
the **"expert"** delegation family after `ask_expert` — Chris's deliberate umbrella
term for the delegation features to come. Lets the user nominate a dedicated model to
build artefacts (`create_artefact`) instead of the persona's own: strong upstream for
the privacy-light heavy lifting (SPAs, sims, boards) while the persona can stay small/
local. **Omakase:** off by default; when a global expert is set it is **on by default
per chat with a persisted per-chat opt-out**. Surfaces: (1) a global **"Artefact
expert"** slot under *My Settings › "Ask an Expert"* (`settings.artefactExpertModel`)
with an **honest, distinct privacy note** — the brief is persona-authored and can carry
conversation-derived detail, deliberately NOT the `ask_expert` "only the sanitised
question leaves" line; (2) a per-chat **cockpit toggle** (`ChatRow.useArtefactExpertModel`,
a synced Class-2 write — deliberately unlike the transient `askExpert`), shown only when
a global expert is set, with **scope sub-labels** on both expert toggles ("for this turn"
vs "for this chat", Laura #1). `create_artefact` resolves the **expert offering's own**
provider/target/reasoning (never the persona's); when the chat wants the expert but it is
unreachable **pre-flight** (removed offering / missing key), it **errors honestly with a
constructive next-step and NO silent fallback** (Chris's call), and the failure is
surfaced **inline in the cockpit** (`role="alert"` + route to the expert settings),
**independent of the persona relaying it** (Laura #4) — cleared on next send, on dismiss,
and on chat switch. **No Dexie bump** (both fields pre-scaffolded, non-indexed;
`useArtefactExpertModel` syncs by deny-list omission — no `strip.ts` touch, no collision
with the parallel sync-hardening). Built spec→**Laura spec-pass PASS** (2 soft findings
folded: sub-labels + persona-independent note; 2 future-watch logged to `ux-deferrals`)→
plan→**subagent-driven (6 TDD tasks + 1 final-fix wave)**→**opus whole-branch READY TO
MERGE**→**Laura pre-squash CLEAN**. **Larissa NOT required** (client-only: no
auth/sync/proxy/crypto service). Gates (controller-run on the tip): `pnpm typecheck
--force` **14/14**; user-client vitest at the **8** Node-localStorage baseline (no
artefact-expert failures; new coverage: `resolve-artefact-expert` 5/5, expert-vs-persona
key selection + discriminant, CockpitMenu chip semantics, store hold/clear/reset).
Deferred non-blocking Minors: inline note covers pre-flight only, not a runtime
proxy-down `author()` failure (conscious §3.4 narrowing — no silent fallback, relies on
persona relay for that sub-case; logged in `ux-deferrals`); note visible only once the
cockpit is open (mirrors the dictation note, Laura soft); test-helper duplication. **Still
NOT pushed — OWED: Chris device-verify (Plan §Manual verification, needs `./dev.sh` +
a configured expert model) then push.** Spec/plan:
[[../superpowers/specs/2026-07-06-artefact-expert-design]],
[[../superpowers/plans/2026-07-06-artefact-expert]].

---

**Prior — 2026-07-05 (later still, II):** **My Account Admin-tile & dashboard
reorg LANDED on `full-backend-transition`** (two squashed feature units, ahead of
the v0.2.0 go-live). Chris asked for a gold, admin-only "Admin" launcher on the My
Account page plus a tidy-up of the tile grid. **Unit 1 — backend discovery
(`530ac2d2`):** the auth-service's public `GET /api/v1/config` now advertises an
optional `adminUrl` (new optional env `ADMIN_PUBLIC_URL`, strict-https, gated exactly
like `proxyUrl`/`syncUrl`, plus an `'admin'` feature flag); `adminUrl` is carried
through the `ServerConfig` wire type and the client discovery parser
(`parseServerConfig`, same https/loopback guard). **Unit 2 — client feature
(`08832d54`):** a gold, full-width Admin `NavTile` on the dashboard, gated on
`useAccountLinkStore().role ∈ {admin, primary_admin}` **AND**
`useDiscoveryStore().config.adminUrl` present, opening the admin-client in a new tab
(`window.open(url, '_blank', 'noopener,noreferrer')`; the admin-client has its own
5-branch login — pure launcher, server still enforces `minRole`). Deliberately
hidden-not-disabled for non-admins (spec §4.2 exception to CLAUDE.md §11, Laura-
confirmed). The two sign-in-security tiles merged into one **"Passphrase &
Biometrics"** hub (the biometric screen gains a Change-passphrase section, now
reachable in every load state — a final-review reachability fix); Recovery Key
re-homed to the bottom row and recoloured pink→purple; the 2×3 grid given a coherent
device(pink)/server(blue)/exit(purple) colour scheme. Built spec→**Laura spec-pass
PASS** (SOFT-1 tile-legibility + SOFT-2 "opens the admin console" meta folded in)→
plan→**subagent-driven (5 TDD tasks + 1 plan-gap test-fix + 1 final-fix)**→**opus
whole-branch READY** + **Larissa CLEAR TO SQUASH** (auth-service diff: no
info-disclosure/SSRF, validation parity exact, zero-knowledge untouched). Gates: `pnpm
typecheck --force` **14/14**; user-client vitest at the **8** Node-localStorage
baseline (account-page 14/14 + account-biometric 5/5, incl. 5 new page-level admin-tile
gating tests); auth-service `config.test.ts` **10/10**, full suite baseline unchanged
(14 pre-existing DB-integration fails, none config/env). **Plan gap caught at the
integrated gate:** two pre-existing test files under `apps/user-client/tests/routes/`
(planning searched `src/routes/` only) encoded the old grid/crumb and broke; fixed +
extended with admin-gating coverage. **DEVICE-VERIFIED
on the dev stack (2026-07-05):** the gold tile appears for an admin and opens the
admin-client in a new tab; Chris logged in. Two things surfaced and were fixed
(follow-up commit `2134016b`, Larissa re-audited the env change CLEAR): **(1)** the
server env `ADMIN_PUBLIC_URL` was strict-https like proxy/sync, but the dev
admin-client is http-served and the client OPENS the URL (real navigation, no VITE
override) — relaxed to accept loopback-http too, mirroring the client parser's
`isAcceptableUrl` (non-loopback http still refused; proxy/sync unchanged). **(2)**
the admin-client must be **same-origin** as the user-client to see its account
IndexedDB ("No account on this device" otherwise) — so the dev URL is
`http://localhost:3000/admin/` (user-client Vite reverse-proxies `/admin/`→`:5174`,
as Traefik does in prod), with the trailing slash the admin `base` needs. Spec §6.1
records both amendments; `.env.example` documents the same-origin rule for
self-hosters. **Still NOT pushed (Chris pushes).** Deferred Minors (non-blocking):
3rd conditional-spread repetition in `server-config.ts` (revisit at a 4th field);
inert `colour="blue"` on the gold tile (required prop, `gold` overrides). Spec/plan:
[[../superpowers/specs/2026-07-05-account-admin-tile-and-reorg-design]],
[[../superpowers/plans/2026-07-05-account-admin-tile-and-reorg]]. Prior entry:
2026-07-05 (later still) — **Onboarding/auth hardening LANDED on
`full-backend-transition`** (two feature units, ahead of the v0.2.0 go-live).
**Unit A — F3 (`ab30e903`):** the client token-refresh round-trip is now serialised
across tabs by an exclusive `navigator.locks` lock (`chatsundere-token-refresh`),
closing the multi-tab bug where two tabs refreshing concurrently tripped the
server's refresh-token reuse-detection and hard-logged-out both. The module-local
`refreshInFlight` guard is kept as the within-tab collapse; jsdom fallback
preserved. Not a Larissa path. **Unit B — F4/F5 (`a918e3b4`):** five join lifecycle
codes (`code_expired`, `code_already_redeemed`, `code_attempts_exhausted`,
`rate_limited`, `session_expired`) now map to specific, flow-tailored constructive
messages in both onboarding confirm handlers instead of the generic "Something went
wrong"; `shared-types` `JoinError` is reconciled with what the auth-service emits
(phantom `rate_limit_exceeded` removed, four real codes added); and the server's
`code_already_redeemed` is unified to **410 Gone** (was split 409/410) with a new
integration test on the previously-untested guard. Built spec→(Laura skipped: copy
on existing screens)→plan→**subagent-driven (4 tasks, per-task spec+quality
review)**→**opus whole-branch READY** + **Larissa CLEAR TO SQUASH** (no
Critical/High/Medium; the refresh lock verified deadlock-free). Gates: `pnpm
typecheck --force` **14/14** on the integrated tree; user-client vitest at the 8
Node-localStorage baseline; auth-service `bun test` **127 pass** (no new failures
beyond the pre-existing OPAQUE-setup baseline). Two follow-ups logged
([[insights/follow-ups-index]]): `recovery.tsx` phantom-literal cleanup, and a
refresh-fetch `AbortController` timeout. **NOT pushed (Chris pushes after
device-verifying spec §7 against the live backend — needs the join error states
triggered).** Spec/plan:
[[../superpowers/specs/2026-07-05-onboarding-auth-hardening-design]],
[[../superpowers/plans/2026-07-05-onboarding-auth-hardening]]. Prior entry:
2026-07-05 (later) — **Frontend↔backend integration audited,
deviceless-recovery analysed, recovery-key safety communication SHIPPED** (commit
`e184413`, client-only copy) — ahead of a planned **v0.2.0 whole-backend go-live in
~48 h** (Chris, from ~10:00 CEST). **(1) Integration audit (two read-only sweeps of
the real code, not the docs):** the user-client on `full-backend-transition` is
**fully wired against all three services + blob transport** — no missing frontend
code, no stubs. Sync engine (`apps/user-client/src/sync/`, 43 files, Dexie **v34**,
push/pull/doorbell/outbox live at boot); proxy client (header-swap
`x-chatsundere-authorization` + `GET /api/v1/config` discovery); onboarding
QR/manual/local all on the **new** `POST /api/v1/join/{start,finish}` (the old
`linkOpaque` is gone); step-up 401-interceptor + `<StepUpModal>`; blob
put/get/delete + eager-fetch. **Blobs are live locally** (Chris syncs images via
`./dev.sh` + MinIO). Remaining work is **server scharfschalten + live verification**
(smoke-test the three onboarding paths, doorbell WSS, step-up tier mapping,
discovery feature-flag consistency), not client code. **(2) Deviceless recovery —
verdict:** **YES via the recovery key**, NO via passphrase alone. The full chain
works: onboarding matrix "I lost my devices" → `recoverFromScratch` unwraps
`users.wrapped_mk_recovery` after a recovery-HMAC proof → OPAQUE re-register under a
new passphrase → fresh device is fully linked → pull-loop `since=0` backfills the
whole ciphertext vault. **No bridge device needed.** The gap: a passphrase-only
fresh-device flow does **not** exist even though the passphrase-wrapped MK sits
server-side — and **Chris's decision is C: keep it that way.** Rationale: it
preserves an out-of-the-box 2FA property (credentials + *either* a device *or* the
recovery key); opening a passphrase path would make the passphrase a single point of
failure. Instead we **communicate recovery-key care better** rather than soften the
guarantee (empower, don't infantilise). Known silent-loss trap: login can succeed
into an *empty* vault if the corpus was never synced. **(3) Shipped:** recovery-key
safety copy — reveal `body` reworked (`lib/copy.ts:41`, covers both onboarding
reveals via shared `StepRecoveryReveal`) now names the "lose every device" case + a
password-manager (Bitwarden/Proton Pass) recommendation; a quiet always-on note in
`routes/app/account/recovery.tsx`; and a Discord-ready **user safety guide**
(`obsidian/guides/safety.md`) explaining zero-knowledge ("the admin *cannot* help —
the server only sees ciphertext") + the PM-notes recommendation, for the SCAI
channel. Gates: `pnpm typecheck --force` **14/14**, Biome clean. Not a Larissa path
(client-only, no crypto/auth/sync/proxy change); Laura consciously skipped (copy on
existing screens, no new flow). **Next (fresh context window): the tests.** Prior
entry: 2026-07-05 (earlier) — **Admin-console overhaul BUILT** on the overnight
remote branch `claude/admin-console-live-wiring-xwn71o` (from
`full-backend-transition`; parallel to the trashcan run on
`claude/trashcan-tombstone-throttle-haqiwv`, disjoint file surface — the two only
co-touch `shared-types/src/index.ts`, see below). All 19 TDD tasks landed as
per-task commits (unsquashed, for Larissa + Chris to audit before integration).
Spec/plan under `superpowers/`. What landed: the admin-client mock layer deleted
entirely (the `hybrid` 501-fallback was why /admin showed demo data) and every
screen wired to the live auth-service via one typed `data/api.ts` + `data/types.ts`
view-model layer; the audit endpoint enriched server-side (username left-joins +
DESC ordering) and the users-list `total` bug fixed with role/status filters;
`shared-types/admin.ts` made the single wire truth; change-role, transfer-primary
(typed-phrase confirm + forced sign-out with a login notice) and invitation
`suggested_username`/`note` all functional; the reveal-once screen shows code +
`qr_url`; a constructive `QueryErrorPanel` replaces every eternal spinner; and a
Catppuccin-Mocha **retrofuturistic control-panel restyle** (cassette-futurism
base kit, CRT accents budgeted to three spots, synthwave login; dark-only — Latte
removed; CLAUDE.md §11 revised + [[decisions/0035-retrofuturistic-admin-console|ADR
0035]]). **Gates on the build host:** `pnpm typecheck --force` **14/14**;
`pnpm run build` **9/9**; auth-service `bun test` **120 pass / 12 skip / 13 fail**
(the 13 are the pre-existing OPAQUE-login/recovery/join/bootstrap baseline —
unchanged; +6 new admin tests all pass); admin-client `pnpm vitest run` **59 pass
/ 0 fail** (68→59 because Task 12 deleted the 9-test mock suite); Biome clean.
**Deviation (flagged):** the plan assumed `shared-types/src/index.ts` used a
wildcard re-export; it uses an explicit named list, so one additive line was
needed there to export the five new admin types — this is the one file shared
with the trashcan run (additive on both sides; expect a trivial merge). **Env
note:** the build host's Docker registry is egress-blocked, so Postgres 16 + Redis
were provisioned natively (not via compose) to run the auth-service integration
suite — the integration legs DID run and are green, not owed. **Post-run owed:**
Larissa audits the Unit 1 diff (auth-service + shared-types + data layer — the
worker cannot summon her), Chris runs the spec-§11 manual device verification on
the styled screens, then squash into two feature units (Tasks 1–13 "Wire
admin-client to live backend"; Tasks 14–19 "Restyle admin console as
retrofuturistic control panel") and integrate. Laura consciously skipped (admin
console is not the user-client's mobile surface — Chris's call). Prior entry:
2026-07-04 — **Sync-lifecycle hardening squashed onto
`full-backend-transition`** (`9fe0595e`), plus a separate CORS fix (`b5b2b4a3` —
allow `PUT` in the sync-service preflight; blob/avatar uploads were blocked, so
records synced but avatars did not). Four units from the first multi-device test
(Vivaldi→Chromium): (1) **backfill robustness** — `getSyncState` heals legacy
`syncState` rows (the diagnosed bug: `backfillPending: undefined` silently
stranded a whole vault) and arms whenever a linked device holds un-transferred
rows; (2) **transfer-state reset** on decouple/server-switch
(`resetEngineStateForLocalOnly` + a `linkedServerUserId` stamp + a cycle-start
guard); (3) **Decouple-this-device** flow (best-effort `logoutCurrentSession`,
`decoupleDevice`, Server-linking UI + typed-phrase confirm + a working Retry +
dynamic badge); (4) **completion-aware all-surface wipe** (`wipeDevice` closes
ALL THREE IDB handles — incl. the crypto account DB — before deleting, clears
localStorage/sessionStorage/Cache Storage/SW, and revokes the session). Spec+plan
under `superpowers/`. **Audits:** whole-branch review clean; **Larissa found +
cleared a HIGH** (the crypto account DB survived the wipe — `boot/open-db.ts`
caches its handle; the root-cause investigation's "no retained handle" premise
was wrong); Laura passed Unit 3 (three soft advisory notes). Gates: `pnpm
typecheck --force` **14/14** on the integrated tree; user-client vitest baseline-
only (8 known Node-localStorage); crypto **190/0**. **Open (next window):** Chris's
on-device §10 verification (the `onblocked` wipe fix needs a real browser — cannot
be exercised in fake-indexeddb) + his device-test findings ("a few things") +
three Laura soft notes (destructive button tone for a reversible action; "End
this link" fold at 380 px; tile-meta "sync & unlink devices" plural ambiguity →
suggest "unlink this device"). Prior, 2026-07-03 — local dev onboarding wired for
the first end-to-end test (see "Doing now"). Prior, 2026-07-02 (later): **Block 6C blob
transport is BUILT** on
branch `claude/blob-transport-impl-xtpius` (17 `03:` commits; the designated
remote-run branch — the plan's `feat/backend-03-blobs` name was overridden by the
harness). All 16 plan tasks landed TDD-style: the deterministic blob envelope
(`packages/crypto` sync-blob), `BlobRef` + the three collections in shared-types,
the `sync_blobs` table + migration, the S3 backend (a hand-rolled SigV4 client —
a documented deviation from the provisional Bun.S3Client probe pick, since
Bun.S3Client exposes no bucket-admin ops; single-shot UNSIGNED-PAYLOAD PUT → no
multipart → no lifecycle rule), the locked-quota blob store, the four routes
(§7.1 pipeline + §7.5 statuses verbatim), ciphertext-blind metrics + logger
credential redaction, the avatar cleared-state lifecycle pin, the `re-epoch`
command, the auth-service `"blobs"` flag, the seal-cli blob subcommands, the
cross-channel e2e, MinIO in both composes, and `obsidian/DEPLOYMENT.md` (10
chapters, congruent with the `.env.example`s). Gates on the build host:
`pnpm typecheck --force` **14/14**; sync-service `bun test` **125 pass / 5 skip /
0 fail** (baseline 73); crypto **181 pass** (baseline 165); auth config unit
**7 pass**; Biome clean on all 40 changed TS files. **Environment caveat, owned
honestly:** the build host had no Docker daemon and no MinIO binary, so the 5
S3-live legs (`s3.test.ts`) skip loudly and the route/store/e2e suites run
against an in-memory `BlobBackend` (the interface seam) over native Postgres +
Redis. The empirical S3 probes (Bun-fetch streaming PUT/GET against real MinIO,
bucket bootstrap, versioning read) are **OWED** and recorded in
`apps/sync-service/probes/README-blobs.md` — Chris's §20 VPS dry-run exercises
them for real. **Next: Larissa audits the built diff** (sync-service +
`packages/crypto` are mandatory paths; the SigV4 client + streaming pipeline +
credential-redaction are the focus), Chris device/VPS-verifies (blob spec §20),
then merge. Prior entry: **6A + 6B are BUILT AND MERGED to
master** (remote runs completed; PRs #5 `feat/backend-01-cors-proxy` and #6
`feat/backend-02-sync`, merged by Chris — post-merge Larissa re-audit of the
built diffs is still owed before deploy). **Block 6C (blob transport S3/MinIO
+ deployment docs) is fully specced, planned, and hardened for a remote
run.** Spec `superpowers/specs/2026-07-02-blob-transport-and-deployment-docs-design.md`
(v2 — dual Fable-class review folded: Larissa 1 High / 3 Medium / 7 Low;
protocol lens 2 Critical / 8 Important; tags `[L]`/`[F]`). Headline outcomes:
**proxy-through-sync-service** (MinIO never public), **immutable rev-less
blobs**, **deterministic SIV-style sealing** (nonce =
HMAC(nonceKey, blobId ‖ SHA-256(plaintext)) — Larissa sign-off on record;
collapses the same-id race + retry idempotency in one stroke; plaintext hash
never leaves the device), **quota enforced under the account lock** (shared
2 GiB records+blobs, 64 KiB accounting floor), the **avatar terminality trap**
fixed (`personaAvatars.blobRef` nullable — removal is a cleared-state Class-2
update, never a tombstone), traffic-shape correlation owned honestly in §6,
and a **`re-epoch` command** (a Postgres restore alone does NOT flip the
epoch — it travels inside the backup; DEPLOYMENT ch. 7 runbook depends on
it). **Two cross-flags for the engine session:** (1) `vectors` shrunk-tail
terminality — cleared-state updates, not tombstones, on document-edit
shrinks; (2) epoch-restore mechanics above. Plan
`superpowers/plans/2026-07-02-blob-transport.md` (16 TDD tasks + 6-probe
Task 0 with decision matrices + overnight Operating-Rules contract). Branch
for the remote run: **`feat/backend-03-blobs`** (STOP-guard: `routes/changes.ts`
exists, `routes/blobs.ts` does not). After the run: Larissa audits the built
diff, Chris device-verifies (spec §20), then merge. The **client engine**
(Dexie v33, outbox, BlobRef transform, fetch strategy with Laura) remains a
later Liz-inline session. Prior entry: 2026-07-02 — **Sync workstream (Block 6B) fully specced,
planned, and hardened for overnight remote execution.** Built in one session
with Chris from the settled deep-dive decisions: spec
`superpowers/specs/2026-07-01-client-sync-design.md` (v2), plan
`superpowers/plans/2026-07-01-client-sync.md` (18 TDD tasks + a probe task
with decision matrices + the overnight Operating-Rules contract). The spec
passed a **dual Fable-class adversarial review — Larissa (security: 1
Critical, 4 Medium, 4 Low) and a protocol/functional lens (3 Critical, 11
Important)** — all findings folded, tagged `[L]`/`[P]`. Headline outcomes:
the server is honestly framed as a **rev-watermarked state store** (not an
oplog); an explicit **§6.2 integrity/availability trust boundary**
(malicious-server withholding/rollback/destruction undefended in v1, said
plainly); the tombstone destruction primitive bounded three ways
(**`jti`/`sub` revocation deny-list pulled into v1** — Chris's call, iat-aware
`sub` entries; per-account delete-rate ceiling; client-side 30-day trash for
*pulled* tombstones — local shame-delete stays immediate); a **binary-aware
envelope codec** (bare JSON silently corrupts `EncryptedBlob`/`Uint8Array`
fields); a **store `instance_epoch`** against silent restore divergence;
`seedTemplates` added to allowlist + padding set (schema is at Dexie **v32**,
engine bump will be **v33**); a per-field **`chats` disposition table**
(`draftInput` demoted to device-local — Chris revised the 2026-06-30
inventory); per-collection conflict-resolution keys (LWW needs engine-stamped
`updatedAt` on chats/messages/mindspaces; journal = state precedence; vectors
= stamp-based adoption, **kept in v1** per Chris — battery over bytes);
ceiling arithmetic fixed (2 MiB record cap, pull byte budget, batch-by-bytes);
doorbell hardened (single-use tickets, ping vs Bun's 120 s idleTimeout,
post-commit publish, token-TTL socket lifetime). **Scope seam:** overnight =
sync-service + `packages/crypto` envelope + shared-types + auth-service
deny-list writes + `/config` `syncUrl`; the **client engine** (Dexie v33,
outbox, worker, gating) is a later Liz-inline + Laura session — its contract
is spec §12. **Blobs (artefacts/attachments/personaAvatars) deferred to an S3
blob-transport follow-up spec.** Branch for the remote run:
**`feat/backend-02-sync`** — **sequenced strictly after the proxy run merges**
(it extends `GET /api/v1/config` and adapts proxy-service in-tree files;
kickoff prompt STOP-guard checks `routes/config.ts` exists). Larissa
re-audits the built diff before squash. **Next: S3/MinIO blob-transport spec
+ deployment documentation (deployment = docs for Chris AND for third-party
operators — AGPLv3, deredere towards operators too), planned with Chris in the
next session.** Prior entry: 2026-07-01 — **Proxy workstream (Block 6A) fully
specced, planned, and hardened for overnight remote execution.** A session with Chris
resolved the last proxy details and settled the deployment strategy. Four
refinements over the analysis: **token-only** (the shared-key mode is dropped —
the old `tidesson.net` relay is retired in a **coordinated cut**, not a soft
overlap); the **two-Bearer header rule** (`x-chatsundere-authorization` carries
the account token, `Authorization` the forwarded upstream key); a **single
transparent egress policy** (no LLM allow-list — a private-range SSRF block +
per-user/IP rate limits are the whole boundary; method-agnostic forward with a
tested header deny-list); and **backend self-description** via a new public
`GET /api/v1/config` (self-hosting first-class — the client learns the proxy URL,
never hard-codes it). The spec passed **two adversarial reviews — Larissa
(security) and Fable (protocol/functional)** — both folded in (redirect-follow
SSRF bypass, `X-Forwarded-For` rate-limit bypass, NAT64/6to4 range gaps, the
wrong skeleton `JWT_ISSUER`, the `/metrics` namespace collision → a second ops
port, `Location` dropped by the response filter, MCP GET/DELETE + reconnect
headers; **Bun pinned-IP connect empirically verified**). Artefacts on `master`:
spec `superpowers/specs/2026-07-01-authenticated-cors-proxy-design.md`, plan
`superpowers/plans/2026-07-01-authenticated-cors-proxy.md` (15 TDD tasks + the
overnight Operating-Rules contract). Branch for the remote run:
**`feat/backend-01-cors-proxy`**. **Deployment strategy settled:** the whole
backend goes live for the first time (auth+proxy+sync+postgres+redis were never
deployed) as **v0.2.0, not v0.3.0** (so much landed in 0.1.x that the
intermediate is dropped — **needs an ADR amendment to 0031 / CLAUDE.md §12**);
Chris pre-stages the stack (`docker compose ps` green) before going live;
coordinated cut of the old proxy with a **constructive in-client message** (the
*dere* way), old container stopped-not-deleted for a 60 s rollback; the existing
~10 alpha users uplevel their local (plaintext-at-rest) data **in-place**. The
proxy **client-side** (header swap, discovery consumption, `CorsProxyBlock`
collapse, onboarding, the constructive cut message) is a **separate Laura-gated
client session**, not the overnight run. **Next: the sync spec** (the big,
zero-knowledge-critical one) in a fresh context window. Prior entry: 2026-06-30
(deep-dive) — **Block 6 design decisions now complete.** A focused brainstorm with Chris closed every open sync question and
revised two earlier calls; all captured in the
`BACKEND-ANALYSIS-cors-proxy-and-sync.md` "Deep-dive session 2026-06-30" section.
Resolutions: delete **always** wins over a racing edit (shame-delete dignity;
tombstone terminal per uuid); foreign-MK uplevelling is an **in-place merge**
(local Dexie is plaintext at rest → read + push up under the account MK; union
with duplicates; secrets re-sealed in the dual-MK join window) — this
**supersedes** the earlier export-then-import call (now a manual fallback);
compaction checkpoints **sync as-is** (Class-1 append, never re-derived — would
break live device equivalence); backend→device is **pull-based** (timer +
pull-on-foreground + push-piggyback) **plus a doorbell WebSocket poke** (carries
only a `rev`, no content; best-effort accelerator; isolated unit) — this
**supersedes** the earlier "poke deferred" call; `settings` is the **only global
singleton** (server-wins, whole row, no field-level merge); proxy onboarding gets
a configurable `VITE_INVITE_REQUEST_URL` invitation pointer (no vetting tooling —
manual, operator-specific). Durability against the ChatGPT cross-device
data-loss scenario comes from append + outbox + set-union, not from WSS. **Next:
write the two real briefs (proxy first, then sync) from these decisions.**
No code written; Chris deliberately chose depth over hardening plans tonight.
Prior entry: 2026-06-30 — **Block 6 kick-off analysis landed**:
`BACKEND-ANALYSIS-cors-proxy-and-sync.md` (repo root) designs the two
server-coupled workstreams — authenticated CORS proxy and zero-knowledge
client sync — from a brainstorm with Chris. Verified ground truth
(auth-service EdDSA + JWKS **done**; proxy/sync-service still Phase-0
skeletons; full client crypto + uuidv7 data model in place). Key
decisions settled: **proxy first** (resource-server JWT via JWKS, not
zero-knowledge-critical); sync as a **blind-indexed per-account oplog**
(HMAC server keys hide the uuidv7 creation-timestamp → plausible
deniability); **only appends offline, everything else write-through**;
padding for persona+memory blobs, NSFW flag ciphertext-only; uplevelling
= local→linked (export-then-import + red irreversible warning on the
foreign-MK path); a **device/session-revocation surface** is the main
gap for the "lost device" story (MK rotation deferred post-beta). Next:
write the two real briefs (proxy, then sync). Prior entry: 2026-05-23 —
Status tracking split off: this file covers server-coupled work (auth,
sync, proxy, admin, plus the server-gated parts of the user-client);
client-only / standalone-mode work moved to [[STATUS-CLIENT-ONLY]].

This file tracks server-coupled work — anything that needs auth-service,
sync-service, proxy-service, or admin-client to exist, plus the user-
client surfaces that are inherently bound to them (auth flows, linking,
recovery, biometric register/unlock, etc.). Client-only / standalone
work lives in [[STATUS-CLIENT-ONLY]]. Read both at the start of every
session; update the relevant one at the end. Anything more detailed
than the high-level "where are we" lives elsewhere (see Pointers below).

---

## Phase 0 — Foundation

### Done

- Project setup, monorepo, tooling, lint, hooks, CI
- **Auth-service**: OPAQUE register/login, passkey + PRF, JWT refresh,
  audit log, bootstrap-admin CLI
- **User-client**: signup, passphrase login, recovery flow, biometric
  register / unlock, settings, server-linking, disconnect, change passphrase
- **Admin-client (Squash C, 2026-05-20)**: login (5-branch decision tree),
  dashboard, users list + detail + actions, invitations list + create + reveal,
  audit log, route-guard, self-target + last-primary-admin gating
- **QA-fixes-from-Squash-C (2026-05-21)**: test-isolation via
  TEST_DATABASE_URL + auth_db_test (no more live-DB truncation on
  `pnpm test`); session.mk lifecycle refactor (mk owned by store as a
  separate slice, partial-spread drops structurally impossible).
  Larissa-approved-with-defer.
- **UV-relaxation-wiring (2026-05-21)**: ADR 0022 implemented —
  `userVerification: 'preferred'` across every WebAuthn ceremony in
  apps/user-client; PRF (ADR 0005) untouched. Cross-platform passkeys
  (Bitwarden Desktop unlocked, Yubikey-no-PIN) now unlock. Larissa-approved.
- **ProtectedRoute-guard (2026-05-21)**: `<ProtectedRoute>` wrapper added
  for `/app`, `/linking/*`, `/change-passphrase`, `/settings/*`. Service-
  worker refresh on a protected route now correctly reroutes through Gate
  instead of leaving the user on a session-stripped header.
- **Cross-device-identity API-shapes spec (2026-05-22)**: brainstorm with
  Chris resolved brief's Open #3. Spec at
  [[../superpowers/specs/2026-05-22-cross-device-identity-api-shapes-design]].
  Key decisions: URL+code two-field UX (Baalnet sub-path hosting
  first-class, relaxes ADR 0023); 10-char/50-bit code; QR is real URL
  with `#code` fragment; unified `POST /api/v1/join/{start,finish}` with
  `kind` discriminator absorbs `/v1/link/opaque/*`; pairing-finish returns
  wrapped MK material with three-layer integrity guarantee; step-up per
  ADR 0027 (implicit Redis check, no proof header). Triggers ADR-0023
  amendment + new ADR (~0028) for the unified two-round join flow.
- **Cross-device-identity Squash α (2026-05-22)**: backend infrastructure
  landed at commit `9b170c1`. Route prefix migrated repo-wide from `/v1/`
  to `/api/v1/` (link/opaque/* and link/passkey/* deferred to Squash β).
  DB rename `invitations` → `pending_codes` with type discriminator,
  suggested_username, note; migration 0003 + 0004 (role nullable).
  `codes/token.ts` with 10-char ambiguity-removed Base32 generator and
  HMAC_KEY_PENDING_CODES env var (leak-domain-isolated). POST
  `/api/v1/admin/invitations` reshape to return `code` + `qr_url` and
  accept `suggested_username` + `note`. requireStepUp helper for Tier 1
  and Tier 4 with Redis-backed grace windows per ADR 0027. JWT access
  tokens now carry a `jti` claim used as the server-side `session_id`.
  Tier 4 gate wired onto admin-invitations POST. Larissa-approved with
  two fixes applied (HMAC keys added to pino redact list; defence-in-depth
  guard against undefined step-up tier). Tests: 97 pass / 9 fail (the 9
  are pre-existing `full-lifecycle.test.ts` failures from `002e6e1`,
  tracked in [[insights/follow-ups-index]] line 82).
- **Step-up backend Squash γ (2026-05-22)**: landed at commit `cffeb0b`.
  `POST /api/v1/auth/step-up/{start,finish}` mechanism-discriminated
  (webauthn | opaque); requireStepUp extended to Tier 2/3 (10s
  tolerance); logout cascade clears `step_up:<jti>:*` via SCAN;
  rate limits 10/session/5min + 20/IP/5min; audit
  `auth.step_up.{confirmed,failed}`; metrics
  `auth_step_up_{started,finished}_total{method_type, tier, ...}`.
  Brief patched: t3 accepted at `/start` (10s tolerance is the TTL,
  not a grace window). Migration 0005 added
  `auth_methods.opaque_client_identifier` to fix the pre-existing
  username-change-bricks-OPAQUE bug (Larissa H1) across login and
  step-up. Two further Larissa fixes landed pre-squash: GETDEL atomic
  on WebAuthn `/finish` round-state (M1), counter persist before
  UV-required throw (M2). L-γ-1 / L-γ-2 / L-γ-3 deferred in
  [[insights/security-deferrals]]. Larissa γ verdict: clear to squash
  on re-pass. Tests: 118 pass / 9 fail (same baseline failures; +21
  new step-up tests). WebAuthn `/finish` is implemented but
  integration-tested only via the synthetic-passkey-row shortcut at
  `/start`; real assertion verification is manual-verification only.
- **Cross-device-identity Squash β (2026-05-22)**: landed at commit
  `7a01697`. `POST/GET/DELETE /api/v1/me/pairing-codes` (Tier 1 gated;
  GET surfaces `code: null` and `qr_url: null` because storage is
  HMAC-only — spec §4.5 deviation tracked in
  [[insights/follow-ups-index]]). Unified `POST /api/v1/join/{start,finish}`
  with `kind: 'invitation' | 'pairing'` discriminator absorbs the
  former `/v1/link/opaque/*`; pairing-finish returns the owner's
  wrapped MK material so the new device joins the existing crypto
  domain. `assertOpaqueWrappingPresent` (ADR 0021 defence-in-depth)
  writes `wrapping_invariant_violated` audit + metric on any anomaly
  and refuses with a generic 500. Per-IP rate limits on `/join/*`
  per spec §6 (10/min + 100/hour on /start, 10/min on /finish);
  `kind_mismatch` short-circuits before the 4-attempt cap consume
  (Larissa β M1). `/v1/link/opaque/*` and `invitations/token.ts`
  deleted; passkey-link migrated to `/api/v1/link/passkey/*`.
  bootstrap-admin CLI writes the new `{ code, qr_url, ... }` shape.
  ADR 0023 amended (transparent sub-path proxy allowed), ADR 0028
  added (unified two-round join flow). Larissa β-approved on re-pass
  after H1+M1+L1 fixes; L-β-1 / L-β-2 deferred in
  [[insights/security-deferrals]]. Tests: 136 pass / 9 fail (same
  baseline; +18 new endpoint + integrity tests). User-client
  `linkOpaqueStart`/`linkOpaqueFinish` wiring intentionally broken
  pending the onboarding overhaul (next session).

### Briefed, awaiting implementation

- auto-handover client state machine (ADR 0026)
- `DELETE /api/v1/me/account` partial-upload cleanup (per ADR 0026
  Failure Mode C)
- UUIDv4 → UUIDv7 migration across the entire data model (ADR 0025)
- ~~Client-side step-up: `<StepUpModal />` + request interceptor~~ —
  **implemented and live** (step-up modal + 401 interceptor confirmed in the
  2026-07-05 integration audit; staleness flagged by the 2026-07-06
  pre-test analysis and corrected here).
- ~~Client-side cross-device identity (onboarding three paths QR / manual /
  local; admin-client invitation-form fields)~~ — **implemented and live**
  (onboarding matrix + admin console overhaul).
- Theming pivot to cyberpunk (mood-board curation pending from Chris)

### Open design questions / blockers

- API endpoint shape curl-verification — Chris-tracked
  (cross-device-identity brief, Open #3)
- Conflict resolution on concurrent sync edits — Phase 1 brief

---

## Doing now

- **Block 6 is the active workstream.** The client side is feature-complete and
  live at `v0.1.3`; the whole backend ships live for the first time as **v0.2.0**.
- **Block 6A — proxy: BUILT + MERGED** (PR #5). Post-merge Larissa re-audit of
  the built diff still owed before deploy.
- **Block 6B — sync: BUILT + MERGED** (PR #6). Same owed re-audit. Note from
  the 02 run: Bun caps WS `idleTimeout` at 255 s (spec said 960) — liveness is
  carried by the 30 s ping; recorded in `apps/sync-service/src/env.ts`.
- **Block 6C — blobs (S3/MinIO) + deployment docs: SPECCED + PLANNED +
  HARDENED (2026-07-02).** Remote run next, on `feat/backend-03-blobs`.
- **Local dev onboarding wired for the first end-to-end test (2026-07-03).**
  `dev.sh` now launches the admin-client (`:5174/admin/`) and the auth CORS
  allow-list points at `:5174`; the admin "Open user-client" CTA follows
  `VITE_USER_CLIENT_URL` (dev `:3000`, prod `/`); and `./bootstrap-admin.sh`
  mints the first `primary_admin` with the dev env loaded. First-owner steps
  are in `obsidian/ONBOARDING.md` ("Create the first owner").
- **First local end-to-end run — AUTH GREEN (2026-07-03 evening).** Registration
  → login works on the dev stack. Four blockers fixed inline (full account in
  `STATUS-TRANSITION.md`): join `kind` discriminator (`b55a52a2`),
  biometric-prompt overlap (`06bbd286`), and the big one — the **OPAQUE
  server-identity dev/prod divergence**, fixed with an origin-only shared helper
  `opaqueServerIdentity` across 12 call-sites, Larissa CLEAN (`dc1fff00`, LT-L3
  frozen-at-go-live); dev auth-reset tool (`540fccf8`). Admin-client loads (still
  demo data); biometric verified to the PRF step (device test deferred to
  2026-07-04). **Next: the still-owed sync/blob manual verification** — the
  engine is built + merged + audited but never run end-to-end; `sync_db` is
  empty. A bring-up + verify task, not a build.

---

## Next session

1. **Frontend integration of the backend — spec + plan** (agreed with Chris
   2026-07-02, runs while the 6C remote run builds): the client engine
   (sync spec §12 + blob spec §11/§12 contracts — Dexie v33, outbox, worker,
   BlobRef transform, fetch strategy) plus the proxy client-side (header
   swap, `GET /api/v1/config` consumption, `CorsProxyBlock` collapse) and
   the cross-device onboarding overhaul. Laura gates the UX (spec-pass
   first). Carry the two cross-flags in: `vectors` shrunk-tail cleared-state
   rule and the epoch-restore mechanics.
2. **After the 6C remote run lands:** Larissa re-audit of ALL THREE built
   diffs (6A + 6B owed, 6C fresh), Chris's device/VPS dry-run verification
   (sync spec §18 + blob spec §20), then merge + the roadmap ADR amendment.
2. **Full-build spec + two docs** — the whole backend deployed for the first
   time (auth+proxy+sync+postgres+redis; Traefik/Watchtower/healthcheck/metrics;
   dry-run-first), plus (a) a **deploy guide for Chris** built on his existing
   VPS compose, and (b) a **Discord announcement** ("Chatsundere has a backend").
3. **ADR amendment** — record the v0.3.0 → **v0.2.0** roadmap revision against
   ADR 0031 / CLAUDE.md §12 (Chris's call; not a silent drift).
4. **Proxy client-side session** (Laura-gated, device-verified) — header swap in
   `transport.ts`/`mcp-client.ts`, `GET /api/v1/config` consumption,
   `CorsProxyBlock` collapse, onboarding overhaul, the constructive old-proxy-cut
   message. Bundles with the cross-device-identity onboarding already briefed.
2. **Client-side cross-device identity** — user-client onboarding
   overhaul (three paths: QR / manual / local) targeting the new
   `/api/v1/join/{start,finish}` surface. Replaces the now-broken
   `linkOpaqueStart`/`linkOpaqueFinish` wiring in
   `apps/user-client/src/lib/server-client.ts`. Includes the
   admin-client invitation-form fields for `suggested_username`
   and `note`. Inline execution preferred per
   [[insights/2026-05-22-subagent-vs-inline-trade-off]].
3. **Client-side step-up** — `<StepUpModal />` + 401 interceptor in
   user-client that catches `step_up_required` /
   `webauthn_uv_required` and runs the unified step-up flow.
   Admin-client wire-up for Tier 4 admin-invitations POST.

---

## Pointers

- **Roadmap to beta (locked 2026-05-31):** [[ROADMAP]] / [ADR 0031](decisions/0031-eight-block-roadmap-to-beta.md). This backend block is **Block 6 → v0.3.0**; **now active** — Blocks 1–5 are complete and live at `v0.1.3`.
- Client-only / standalone-mode work: [[STATUS-CLIENT-ONLY]]
- All open todos: [[insights/follow-ups-index]]
- Decisions: `decisions/0001–0028`
- Design briefs: `briefs/phase 0/`
- Session journal: `insights/YYYY-MM-DD-*.md`
- Recent commits: `git log --oneline -20`
