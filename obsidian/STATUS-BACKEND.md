# Chatsundere Status — Backend

**Last updated:** 2026-05-23 — Status tracking split off: this file now
covers server-coupled work (auth, sync, proxy, admin, plus the server-
gated parts of the user-client). Client-only / standalone-mode work has
moved to [[STATUS-CLIENT-ONLY]]. Prior entry: 2026-05-22 — Squash β
(cross-device-identity endpoints) landed at commit `7a01697`; ADR 0023
amended + ADR 0028 added; Larissa β-approved after H1+M1+L1 fixes
(per-IP rate limits, kind_mismatch pre-consume, kind_mismatch message
scrub).

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

*(between sessions)*

---

## Next session

1. **Client-side cross-device identity** — user-client onboarding
   overhaul (three paths: QR / manual / local) targeting the new
   `/api/v1/join/{start,finish}` surface. Replaces the now-broken
   `linkOpaqueStart`/`linkOpaqueFinish` wiring in
   `apps/user-client/src/lib/server-client.ts`. Includes the
   admin-client invitation-form fields for `suggested_username`
   and `note`. Inline execution preferred per
   [[insights/2026-05-22-subagent-vs-inline-trade-off]].
2. **Client-side step-up** — `<StepUpModal />` + 401 interceptor in
   user-client that catches `step_up_required` /
   `webauthn_uv_required` and runs the unified step-up flow.
   Admin-client wire-up for Tier 4 admin-invitations POST.
3. **First end-to-end test** — Chris's first full-system test once
   the user-client onboarding lands. Backend surface should be
   ready; auth-service Larissa-approved across three squashes.

---

## Pointers

- **Roadmap to beta (locked 2026-05-31):** [[ROADMAP]] / [ADR 0031](decisions/0031-eight-block-roadmap-to-beta.md). This backend block is **Block 6 → v0.3.0**; deliberately dormant until then.
- Client-only / standalone-mode work: [[STATUS-CLIENT-ONLY]]
- All open todos: [[insights/follow-ups-index]]
- Decisions: `decisions/0001–0028`
- Design briefs: `briefs/phase 0/`
- Session journal: `insights/YYYY-MM-DD-*.md`
- Recent commits: `git log --oneline -20`
