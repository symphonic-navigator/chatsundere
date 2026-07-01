# Chatsundere Status — Backend

**Last updated:** 2026-07-02 — **Sync workstream (Block 6B) fully specced,
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
- Client-side step-up: `<StepUpModal />` + request interceptor in
  user-client that catches 401 `step_up_required` + `webauthn_uv_required`
  and runs the unified `/api/v1/auth/step-up/{start,finish}` flow.
- Client-side cross-device identity:
  - User-client onboarding overhaul (three paths: QR / manual / local)
  - Admin-client invitation-form fields for suggested_username and note
- Theming pivot to cyberpunk (mood-board curation pending from Chris)

### Open design questions / blockers

- API endpoint shape curl-verification — Chris-tracked
  (cross-device-identity brief, Open #3)
- Conflict resolution on concurrent sync edits — Phase 1 brief

---

## Doing now

- **Block 6 is the active workstream.** The client side is feature-complete and
  live at `v0.1.3`; the whole backend ships live for the first time as **v0.2.0**.
- **Block 6A — proxy: DONE (specced + planned + hardened for overnight).** Spec +
  plan on `master`; remote run goes on `feat/backend-01-cors-proxy`. Larissa
  re-audits the built diff **after** the run, before merge.
- **Block 6B — sync: DONE (specced + planned + hardened for overnight,
  2026-07-02).** Spec v2 (dual Fable review folded) + plan (18 tasks) on
  `master`; remote run goes on `feat/backend-02-sync`, **strictly after the
  proxy run has merged**. Larissa re-audits the built diff before squash.
- **Block 6C — blobs (S3/MinIO) + deployment docs: NEXT.** Blob transport is
  records-first-deferred (spec §16); deployment documentation is for Chris and
  for third-party operators alike (AGPLv3, deredere towards operators).

---

## Next session

1. **Blob transport (S3/MinIO) spec + deployment documentation (Block 6C)** —
   planned with Chris. Blob transport brings `personaAvatars`, `artefacts`,
   `attachments` (and the binary codec's `Blob` path) into sync per spec §16.
   Deployment docs serve two audiences: Chris's own VPS rollout AND
   third-party operators (AGPLv3 — deredere towards operators, not only their
   users). Feeds `obsidian/DEPLOYMENT.md`.
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
