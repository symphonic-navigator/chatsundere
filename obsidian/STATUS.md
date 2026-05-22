# Chatsundere Status

**Last updated:** 2026-05-22 — after cross-device-identity API-shapes brainstorm (spec written, plan next)

This file is the single point of orientation. Read it first at the start of
every session; update it at the end of every session. Anything more detailed
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

### Briefed, awaiting implementation

- Cross-device identity (spec landed; plan next):
  - `POST /api/v1/admin/invitations` (reshape existing), `GET`, `DELETE`
  - `POST/GET/DELETE /api/v1/me/pairing-codes`
  - `POST /api/v1/join/{start,finish}` (replaces `/v1/link/opaque/*`)
  - `pending_codes` DB table (rename + extend existing `invitations`)
  - `HMAC_KEY_PENDING_CODES` env var (leak-domain isolation)
  - Path migration `/v1/...` → `/api/v1/...` repo-wide
  - ADR 0023 amendment (relax sub-path hosting) + new ADR for unified join
  - auto-handover client state machine (ADR 0026)
  - `DELETE /api/me/account` partial-upload cleanup
- UUIDv4 → UUIDv7 migration across the entire data model (ADR 0025)
- Step-up authentication (ADR 0027):
  - `POST /v1/auth/step-up` + middleware on Tier 1+ endpoints
  - `<StepUpModal />` + request interceptor in user-client
  - Tier-4 step-up wiring in admin-client invitation creation
- HTTPS-required + server-at-root + `/api` prefix enforcement (ADR 0023)
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

1. Write the implementation plan for the cross-device-identity API-shapes spec via `superpowers:writing-plans` (input: [[../superpowers/specs/2026-05-22-cross-device-identity-api-shapes-design]])
2. Then: execute the plan — likely split across two squashes (DB migration + endpoint reshape; new pairing/join endpoints) with Larissa pre-squash audit on each
3. Step-up backend (ADR 0027) — either before or interleaved with cross-device-identity backend, since pairing-codes requires Tier 1 step-up enforcement and admin invitations requires Tier 4

---

## Pointers

- All open todos: [[insights/follow-ups-index]]
- Decisions: `decisions/0001–0027`
- Design briefs: `briefs/phase 0/`
- Session journal: `insights/YYYY-MM-DD-*.md`
- Recent commits: `git log --oneline -20`
