# Chatsundere Status

**Last updated:** 2026-05-21 — after QA-fixes-from-Squash-C squash (test-isolation + session.mk lifecycle)

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

### Briefed, awaiting implementation

- UV-relaxation wiring in user-client (3 sites) — small diff per ADR 0022, **next squash** with plan at `superpowers/plans/2026-05-21-uv-relaxation-wiring.md`
- Cross-device identity:
  - `/api/admin/invitations`, `/api/me/pairing-codes`, `/api/join`
  - `pending_codes` DB table (single table with `type` discriminator)
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

1. Execute the UV-relaxation wiring plan at `superpowers/plans/2026-05-21-uv-relaxation-wiring.md` (small frontend-only squash, Larissa courtesy-pass)
2. Brainstorm the API endpoint shapes for cross-device-identity backend with Chris (curl-verification per [[../briefs/phase 0/cross-device-identity]] §Open #3) — blocking item before the cross-device-identity backend implementation
3. Then: cross-device-identity backend + step-up backend (priority order to decide with Chris)

---

## Pointers

- All open todos: [[insights/follow-ups-index]]
- Decisions: `decisions/0001–0027`
- Design briefs: `briefs/phase 0/`
- Session journal: `insights/YYYY-MM-DD-*.md`
- Recent commits: `git log --oneline -20`
