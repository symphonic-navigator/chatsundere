# Follow-Ups Index

A single scannable view of every deferred item across the project, so
nothing falls off the radar between sessions. **This file is an index,
not the canonical source.** Each entry links to the authoritative
discussion / brief / deferral entry where the full context lives.

Update protocol: when a new deferral is created anywhere in the repo,
add a row here. When a deferral is resolved (committed code, ADR
written, brief landed), strike the row through with `~~text~~` and
move it to the "Resolved" section at the bottom. Don't delete — the
history of what we deferred and how it resolved is itself useful.

---

## Active — Security (Larissa-tracked)

Canonical source: [[security-deferrals]]

| ID | Item | Trigger | Severity |
|---|---|---|---|
| H-1 / M-1 | Recovery wrap accepted without server-side integrity attestation | Phase 1 sync-service brief | Medium (re-classified) |
| M-3 | `changePassphraseLinkedOnline` atomicity edge case lacks crash regression test | Sync-service staging logic in Phase 1 | Low |
| M-7 | WebAuthn local-verify test does not exercise a real signed assertion | Squash D device-test scripts | Low |
| L-1 | `decodeRecoveryKey` uses non-constant-time string operations | Before v0.1.0 (if ever, low risk) | Low |
| L-B3 | Per-username login rate-limit counts successful logins | Before v0.1.0 | Low |
| L-B4 | `XDG_RUNTIME_DIR` for bootstrap CLI documentation | Before v0.1.0 in compose.prod.yml.example | Low |
| — | Refresh-reuse user-facing notification | Phase 1 sync-service real-time channel | — |
| — | Raw MK in login-flow returns — tighten MK custody | Dedicated "Tighten crypto MK custody" squash before v0.1.0 | — |
| — | `passkey-management.ts` belongs in `packages/crypto` not user-client | Before v0.1.0 (own small squash, Larissa-audited) | — |

## Active — Design (Lyra-brief candidates)

Canonical sources: brief-material files in this directory.

| Item | Trigger | Origin |
|---|---|---|
| Passive auth-state visibility on profile/settings: formalise as part of a future Settings/Profile UX brief | Phase 1+ UX work | [[2026-05-20-pattern-passive-auth-state-on-profile]] |
| API endpoint shape curl-verification — five new endpoints in cross-device-identity brief | Chris exercises proposed request/response bodies with curl before Liz writes tests against them | [[../briefs/phase 0/cross-device-identity]] §Open items #3 |
| Conflict resolution on concurrent sync edits ("welcher change hat recht") | Phase 1 sync-service brief | [[2026-05-19-brief-material-cross-device-identity]] §Open Items |
| Q7 — Username-rename flow design | Phase 1 sync-service brief | [[2026-05-19-brief-material-cross-device-identity]] |
| Conditional UI (`mediation: 'conditional'`) for passkey autocomplete | Future UX-polish squash, post-Phase-0 | [[2026-05-19-brief-material-passkey-uv]] |
| Cyberpunk theming pivot — dedicated theming squash | After admin-client (Squash C) | [[2026-05-19-open-design-questions]] §3 |
| Theming mood-board curation | Chris to add 3–5 reference images before the theming squash | [[2026-05-19-open-design-questions]] §3 |
| Operator-override of TTL defaults for invitation codes | Phase 1 or later | [[2026-05-19-brief-material-cross-device-identity]] |
| Multi-account per origin in user-client | Phase 1+ (currently single-account-per-origin) | discussion 2026-05-19 |

## Active — Implementation (Liz-tracked)

Items that have been decided but not yet implemented in code.

| Item | Trigger | Notes |
|---|---|---|
| Wire UV-relaxation in code (3 sites) | Brief + ADR 0022 have landed (2026-05-20) | Trivial diff; user-client only; Larissa courtesy-pass per [[2026-05-20-pattern-frontend-changes-affecting-crypto-semantics]] |
| Onboarding three-path UI rewrite (QR / Manual / Local) | Brief landed (2026-05-20); awaiting API-endpoint curl-verification (Open #3) | User-client polish squash |
| `/api/admin/invitations` endpoint | Brief + ADRs 0023–0026 landed (2026-05-20); awaiting curl-verification | Auth-service; Larissa-audit; uses `HMAC_KEY_PENDING_CODES` env var (separate from refresh-token key) |
| `/api/me/pairing-codes` endpoints | As above | Auth-service; Larissa-audit; **gated by step-up** (formal step-up brief pending; inline minimum spec in cross-device-identity brief §Step-up section) |
| `/api/join` endpoint with atomic code validation | As above | Auth-service; Larissa-audit |
| `pending_codes` DB table (single table with `type` discriminator) | As above | Drizzle migration |
| Switch from native UUIDv4 to UUIDv7 (`uuidv7` npm package on client, `gen_uuidv7()` SQL function on server) | Before any new entity DB tables land; documented in ADR 0025 | Cross-cutting; library-based |
| Auto-handover client state machine with failure-mode handling | After cross-device-identity brief + ADR 0026 land (both done 2026-05-20) | User-client; per pattern in [[2026-05-20-pattern-frontend-changes-affecting-crypto-semantics]] consider Larissa-pass on the state-machine file specifically |
| Partial-upload cleanup endpoint `DELETE /api/me/account` on handover-cancel | Co-requisite of auto-handover client state machine | Per ADR 0026 §Failure Mode C; Larissa-audit |
| `POST /v1/auth/step-up` endpoint + step-up middleware on all Tier 1+ endpoints | After step-up brief + ADR 0027 land (both done 2026-05-20) | Auth-service; Larissa-audit; Redis keyspace `step_up:` |
| `<StepUpModal />` component + request interceptor in user-client | After step-up brief + ADR 0027 land | User-client; centralised interceptor catches `403 step_up_required` and surfaces modal transparently |
| Tier-4 step-up integration in admin-client | After admin-client invitation-creation UI exists (Squash C) | Reuses `<StepUpModal />` with 5-minute grace window |
| HTTPS-required + server-at-root + `/api` prefix enforcement in user-client | Per ADR 0023 | Likely already true; verify and document |
| Theming squash | After Squash C (admin-client) | See design-deferrals |

## Active — Hygiene & Tooling

Small items that don't fit elsewhere.

| Item | Trigger | Notes |
|---|---|---|
| ~~`.envrc` per-subdirectory split (currently single root .envrc collides PORT keys)~~ | Resolved differently — see "Resolved" | — |
| Operator-side admin-client invitation creation UI | Squash C (admin-client) | New scope item added during 2026-05-19 |
| Operator-side invitations list with revoke | Squash C (admin-client) | New scope item added during 2026-05-19 |
| Vite-PWA `dev-dist` already in biome ignore (2026-05-19) | — | Done; example of how a resolved entry looks |

---

## Resolved

When an entry above is fully resolved, move it down here with a brief
note. This is a deliberate audit trail — "what we deferred and how it
landed" — not garbage to be cleaned.

| Item | Resolved how | Date |
|---|---|---|
| ~~Vite-PWA `dev-dist` files lint-noisy in biome~~ | Added `dev-dist` to `biome.json` ignore list during Squash D pre-squash cleanup | 2026-05-19 |
| ~~Add-biometric button hardcoded `disabled` in Settings → Auth methods~~ | Wired up to `registerLocalBiometric` during Squash D follow-up | 2026-05-19 |
| ~~PRF salt mismatch between registration and unlock~~ | Both sites now use `PRF_INPUT_SALT`; fixed in Squash D follow-up | 2026-05-19 |
| ~~Wrong public-key format stored (SPKI instead of COSE)~~ | Extract COSE from authenticatorData in `webauthn.ts`; fixed in Squash D follow-up | 2026-05-19 |
| ~~Missing Sign-out button in Settings → Account~~ | Added in Squash D follow-up | 2026-05-19 |
| ~~Horizontal overflow on narrow viewports from BreathingOrb absolute positioning~~ | Added `overflow-hidden` to section + `overflow-x-hidden` to root layout in Squash D follow-up | 2026-05-19 |
| ~~Regenerate-recovery-key button silent disabled on biometric session~~ | Inline hint added below button explaining the limitation | 2026-05-19 |
| ~~Decision: passkey UV-relaxation Q1–Q4~~ | All four decided; awaiting Lyra formal brief + ADR | 2026-05-19 |
| ~~Decision: cross-device identity Q1–Q6 plus merge strategy~~ | All decided; awaiting Lyra formal brief | 2026-05-19 |
| ~~`.envrc` global PORT/DATABASE_URL collision (proxy-service overrode auth-service)~~ | Removed app-level `dotenv_if_exists` from root `.envrc`. Each runtime (Vite for frontends, Bun for backends) auto-loads its own `apps/<app>/.env` from cwd. Subdirectory `.envrc` files unnecessary. Discovered 2026-05-20 during Squash C QA when DATABASE_URL pointed to `proxy_db` for auth-service bootstrap. | 2026-05-20 |
| ~~Passkey UV-policy: formalise brief + write ADR 0022~~ | Brief `obsidian/briefs/phase 0/passkey-uv-policy.md` + [[ADR 0022]] landed. Sibling insights [[2026-05-20-pattern-frontend-changes-affecting-crypto-semantics]] and [[2026-05-20-pattern-passive-auth-state-on-profile]] captured related design principles for later. | 2026-05-20 |
| ~~Cross-device identity: formalise full brief~~ | Brief `obsidian/briefs/phase 0/cross-device-identity.md` landed with all seven Q1–Q6 sub-decisions plus the emergent merge-strategy decision. One [OPEN] remains (#3, API curl-verification — Chris-tracked); item moved to Active — Design. | 2026-05-20 |
| ~~ADR — server-at-domain-root, HTTPS, `/api` prefix~~ | [[ADR 0023]] landed. | 2026-05-20 |
| ~~ADR — single-server-per-account hard rule~~ | [[ADR 0024]] landed. | 2026-05-20 |
| ~~ADR — UUIDv7 across the entire data model~~ | [[ADR 0025]] landed (was implicit in originating material, elevated to its own ADR during brief formalisation). Library choice: `uuidv7` npm package. | 2026-05-20 |
| ~~Pre-disconnect-sync-pull state-machine ADR~~ | [[ADR 0026]] landed, with re-ordered step sequence that eliminates the no-active-server transient by deferring the Y-logout to the final step. | 2026-05-20 |
| ~~Rate-limiting numbers for pairing-code generation~~ | Decided in cross-device-identity brief §Rate limits: 10 active codes/user, 50 generations/24h, 10 join-attempts/min/IP, 100/h/IP. | 2026-05-20 |
| ~~Step-up authentication for sensitive operations: formalise brief + ADR~~ | Brief `obsidian/briefs/phase 0/step-up-auth.md` + [[ADR 0027]] landed. Tiers 0–4, mechanisms A (UV='required' WebAuthn) / B (OPAQUE re-prompt) / C (grace window), Redis-backed state, single `POST /v1/auth/step-up` endpoint. Inline minimums in cross-device-identity brief remain authoritative for that brief's standalone implementation and are equivalent to formal tiers. | 2026-05-20 |
