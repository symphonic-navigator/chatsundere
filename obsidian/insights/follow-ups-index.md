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
| Passkey UV-policy: formalise brief + write ADR 0022 | Next Lyra architecture session | [[2026-05-19-brief-material-passkey-uv]] |
| Cross-device identity: formalise full brief in `obsidian/briefs/phase 0/cross-device-identity.md` | Next Lyra architecture session | [[2026-05-19-brief-material-cross-device-identity]] |
| ADR — server-at-domain-root, HTTPS, `/api` prefix | Alongside cross-device-identity brief | [[2026-05-19-brief-material-cross-device-identity]] |
| ADR — single-server-per-account hard rule | Alongside cross-device-identity brief | [[2026-05-19-brief-material-cross-device-identity]] |
| Pre-disconnect-sync-pull state-machine ADR | Before implementing auto-handover | [[2026-05-19-brief-material-cross-device-identity]] |
| Rate-limiting numbers for pairing-code generation | Auth-service spec extension when implementing | [[2026-05-19-brief-material-cross-device-identity]] |
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
| Wire UV-relaxation in code (3 sites) | After Lyra brief + ADR 0022 land | Trivial diff; user-client only; Larissa courtesy-pass |
| Onboarding three-path UI rewrite (QR / Manual / Local) | After cross-device-identity brief lands | User-client polish squash |
| `/api/admin/invitations` endpoint | After cross-device-identity brief lands | Auth-service; Larissa-audit |
| `/api/me/pairing-codes` endpoints | After cross-device-identity brief lands | Auth-service; Larissa-audit |
| `/api/join` endpoint with atomic code validation | After cross-device-identity brief lands | Auth-service; Larissa-audit |
| `invitations` + `pairing_codes` DB tables | After brief + auth-service work above | Drizzle migration |
| Switch from native UUIDv4 to UUIDv7 (client uuidv7 helper, server gen function) | Before any new entity DB tables land | Cross-cutting; trivial helper |
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
