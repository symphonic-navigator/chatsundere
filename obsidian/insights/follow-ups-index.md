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
| L-3 (2026-05-21) | `refresh-on-401` triggers `closeAndForget` on *any* non-ok refresh response, not just reuse_detected | Coordinated with "Refresh-reuse user-facing notification" (above) — phase-1 sync-service real-time channel | Low |
| L-4 (2026-05-21) | `change-passphrase.tsx` `capturedMk` comment slightly stale post-Shape-A | Opportunistic next time the file is touched | Low |

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
| ~~Wire UV-relaxation in code (3 sites)~~ | Resolved 2026-05-21 — UV-relaxation-wiring squash (commit `e814e87`). All three ceremony sites now use UV='preferred'; PRF gate (ADR 0005) intact. Larissa-approved. | — |
| Onboarding three-path UI rewrite (QR / Manual / Local) | Brief landed (2026-05-20); awaiting API-endpoint curl-verification (Open #3) | User-client polish squash |
| Claude extended-thinking signature replay | When the agentic tool loop lands (own integrations + MCP-over-REST) — no live consumer until then; plain chat needs no replay | Build-when-needed; full rationale in [[../../superpowers/specs/2026-06-01-premium-model-integration-design]] §5.2 |
| **Lorebooks / phrase-triggered injection — reuse the Treasury `TagEditor` UX** | When the lorebook / world-info feature is designed | **Chris's explicit ask (2026-06-06):** the trigger-phrase editor must be the EXACT same UX as the artefact tag system — the shared `TagEditor` (`components/artefact/TagEditor.tsx`, chips + autocomplete, `edit`/`pick` modes). Trigger phrases ARE tags structurally. Reuse the component, don't rebuild. He loves it. |
| **Self-host the embedding-model weights — drop the HuggingFace-CDN dependency** | **URGENT (Chris, 2026-06-07).** Tackle very soon — candidate: directly after Knowledgebase Chunk C today, if we can host a large binary outside git (instance static asset / release asset / Git LFS — NOT a raw git blob; the weights are hundreds of MB). | The knowledgebase (Chunk A) makes `packages/embeddings` its first live consumer; transformers.js fetches `Snowflake/snowflake-arctic-embed-m-v2.0` weights from the **HuggingFace CDN** on first use, exposing the user's IP + model request (no user content) — contradicts the zero-knowledge/no-third-party stance. Self-host the weights and point transformers.js at our own origin. Full context: [[../../superpowers/specs/2026-06-07-knowledgebase-chunk-a-foundation-design]] §4.3. Formal [[security-deferrals]] entry written at the Chunk A squash (done 2026-06-07, squash `0ef499f`). |
| Knowledgebase: NSFW deep-link gating of the library-detail route (`/app/knowledge/:libraryId`) | When deep-link / out-of-mode gating is formalised app-wide | **Deferred 2026-06-07 (Chunk A holistic review, Minor).** The detail route reads the unfiltered `useLibraries()`, so a direct link to an NSFW library (or switching to SFW while on the page) shows it. Consistent with the persona-editor precedent (deep-links to NSFW personas aren't gated either); the security-relevant retrieval-time NSFW filter is Chunk B. Decide app-wide: accept the precedent or redirect-to-list on out-of-mode open. |
| Knowledgebase: remove the deprecated `NewLibrarySheet` alias | Opportunistic next time the file is touched | **Minor cruft (Chunk A).** `NewLibrarySheet.tsx` was generalised to `LibrarySheet`; a deprecated `NewLibrarySheet` alias export remains but is unused. Drop it. |
| ~~`/api/admin/invitations` endpoint~~ | Resolved 2026-05-22 — Squash α (commit `9b170c1`); reshape returns `code` + `qr_url` and accepts `suggested_username` + `note`; Tier 4 step-up gate wired. | — |
| ~~`/api/me/pairing-codes` endpoints~~ | Resolved 2026-05-22 — Squash β (commit `7a01697`); POST Tier 1 gated, GET surfaces code/qr_url as null (HMAC-only storage, spec §4.5 deviation tracked below), DELETE with 404 foreign / 409 already-revoked. | — |
| ~~`/api/join` endpoint with atomic code validation~~ | Resolved 2026-05-22 — Squash β (commit `7a01697`); unified two-round flow per ADR 0028, kind discriminator (invitation \| pairing), atomic UPDATE-WHERE redemption, `assertOpaqueWrappingPresent` defence-in-depth on pairing finish. | — |
| ~~`pending_codes` DB table (single table with `type` discriminator)~~ | Resolved 2026-05-22 — Squash α migration 0003 + 0004 (role nullable). Plus migration 0005 (commit `cffeb0b`, Squash γ) added `opaque_client_identifier` so OPAQUE login + step-up survive username changes. | — |
| Pairing-code GET surfaces `code: null` and `qr_url: null` (spec §4.5 deviation) | Surfaced 2026-05-22 in Squash β — HMAC-only storage means the plaintext is unrecoverable after the POST response. Revisit at v0.1.0+ if user feedback wants post-creation re-display. | Either store plaintext encrypted under a server key, or freeze the null behaviour as final. |
| `TRUSTED_PROXY_IPS` env var + X-Forwarded-For trust model | Surfaced 2026-05-22 by Larissa β L-β-2 (deferred). Required before v0.1.0 deployment. | Auth-service middleware; document the "production deployment must front with a reverse proxy that overwrites X-Forwarded-For" requirement in `compose.prod.yml.example` and `apps/auth-service/README.md`. |
| Switch from native UUIDv4 to UUIDv7 (`uuidv7` npm package on client, `gen_uuidv7()` SQL function on server) | Before any new entity DB tables land; documented in ADR 0025 | Cross-cutting; library-based |
| Auto-handover client state machine with failure-mode handling | After cross-device-identity brief + ADR 0026 land (both done 2026-05-20) | User-client; per pattern in [[2026-05-20-pattern-frontend-changes-affecting-crypto-semantics]] consider Larissa-pass on the state-machine file specifically |
| Partial-upload cleanup endpoint `DELETE /api/me/account` on handover-cancel | Co-requisite of auto-handover client state machine | Per ADR 0026 §Failure Mode C; Larissa-audit |
| ~~`POST /v1/auth/step-up` endpoint + step-up middleware on all Tier 1+ endpoints~~ | Resolved 2026-05-22 — Squash γ (commit `cffeb0b`); unified `/api/v1/auth/step-up/{start,finish}` mechanism-discriminated (webauthn \| opaque), requireStepUp helper covers Tiers 1/2/3/4, logout cascade clears `step_up:<jti>:*`. | — |
| `<StepUpModal />` component + request interceptor in user-client | After step-up brief + ADR 0027 land | User-client; centralised interceptor catches `403 step_up_required` and surfaces modal transparently |
| Tier-4 step-up integration in admin-client | After admin-client invitation-creation UI exists (Squash C) | Reuses `<StepUpModal />` with 5-minute grace window |
| HTTPS-required + server-at-root + `/api` prefix enforcement in user-client | Per ADR 0023 | Likely already true; verify and document |
| Theming squash | After Squash C (admin-client) | See design-deferrals |
| Remove alpha CORS-proxy scaffolding (`CorsProxyBlock`, `SettingsRow.corsProxy`, `✗ Needs proxy` status, `requires-proxy` client routing, the proxy-missing save guard) | Beta proxy-service (Phase 2) lands — proxied providers then reach upstream over the user's server connection | [[../../superpowers/specs/2026-05-31-provider-model-handling-rework-design]] §13 |
| `MessageBlock` not memoised — `renderBlocks()`/`groupAdjacent()`/`join()` re-run per streaming token for every historical message (the expensive remark/rehype/shiki pipeline IS skipped via `MarkdownContent`'s memo) | When long-chat streaming jank is observed, or alongside the next chat-perf pass | Surfaced by the opus final review of the message-rendering squash (`433cd79`). Fix: wrap `MessageBlock` in `memo` with a custom comparator — requires `useCallback`-ing ChatStream's inline `onToggleExpand`/`onCopy`/`onBookmark`/`onRegenerate` and deriving pill-map equality (the very prop-complexity the plan avoided by memoising `MarkdownContent` instead). Correctness is fine today; this is a perf refinement. |
| Message-rendering main-chunk weight — `katex` + `react-markdown` load synchronously in the entry bundle (~598 KB gzip) | If the v0.1.0 PWA initial-load budget tightens | `shiki`/`mermaid` already lazy-split. Could lazy-load `MarkdownContent` or split `katex` out. Matches chatsune (katex is synchronous there too). Surfaced 2026-06-01 during the message-rendering build. |
| Route consented model-image loads through `proxy-service` so even a deliberate load doesn't expose the user's IP | Beta proxy-service (Phase 2) lands | Today `ImageMarker` (commit `fd30cb5`) gates remote Markdown images behind a tap-to-load pill (`referrer-policy: no-referrer`, no persistence) — the privacy leak is closed for auto-load, but a consented load still beacons the user's IP/timing to the third party. Once the proxy exists, fetch through it. Surfaced 2026-06-02. |
| **JSX / React single-page-app preview in the lightbox (Chris's explicit ask — core functionality for many users)** | When the artefact-generation work lands — JSX/SPA preview belongs to it, not to the viewer | Deferred from the lightbox-viewer work (2026-06-06). For many users, building a concept quickly, demoing it, and trying it live is "gold". MUST use a **locally-bundled** transpiler (sucrase or esbuild-wasm, lazy-loaded) + React from our own deps, inlined into a hard-sandboxed iframe (`allow-scripts`, NO `allow-same-origin`) — **never** a third-party CDN. The chatsune `unpkg.com` approach (loading React + Babel at runtime) was rejected on zero-knowledge grounds (IP-leak + remote-code surface). The lightbox already has the format-dispatch seam (`format-detect.ts` + `previews/`) to plug a `jsx` viewer into. Spec: [[../../superpowers/specs/2026-06-06-lightbox-viewer-design]] §11. |

| Widen the lightbox's `detectFormat` `LANG_BY_EXT` (and the shiki loaded-langs set) so more saved code-block languages syntax-highlight in the preview | Opportunistic, or when a user notices a saved snippet rendering plain | Surfaced by the opus holistic review of save-as-artefact (Chunk 4, commit `7c907e5`). In chat, *any* fence language gets a Save button, but `detectFormat` (`components/lightbox/format-detect.ts`) only recognises ~18 extensions — saving e.g. `kotlin`/`swift`/`dart`/`elixir`/`dockerfile`/`graphql` yields a correct `format:'code'` artefact (right Treasury tab, downloadable) that renders **un-highlighted** in the lightbox. Pre-existing `detectFormat` behaviour (same for uploads), only made wider by Chunk 4. Fix: extend `LANG_BY_EXT` + ensure the langs are loaded in `lib/markdown/highlighter.ts`. Content + category are always correct; only highlighting degrades. Non-blocking. |

## Active — Hygiene & Tooling

Small items that don't fit elsewhere.

| Item | Trigger | Notes |
|---|---|---|
| ~~`.envrc` per-subdirectory split (currently single root .envrc collides PORT keys)~~ | Resolved differently — see "Resolved" | — |
| Operator-side admin-client invitation creation UI | Squash C (admin-client) | New scope item added during 2026-05-19 |
| Operator-side invitations list with revoke | Squash C (admin-client) | New scope item added during 2026-05-19 |
| Vite-PWA `dev-dist` already in biome ignore (2026-05-19) | — | Done; example of how a resolved entry looks |
| ~~`full-lifecycle.test.ts` truncates production `auth_db`~~ | Resolved 2026-05-21 — see Resolved | TEST_DATABASE_URL + auth_db_test isolation landed in QA-fixes squash (commit `34f6adb`) |
| `full-lifecycle.test.ts` steps 2-10 broken since `002e6e1` (OPAQUE wire field rename) — step 2 fails with `link/opaque/finish` returning 500 internal | Own follow-up squash after current QA-fixes squash lands | Discovered 2026-05-21 during Task 3 of QA-fixes squash: with the new TEST_DATABASE_URL isolation in place, the test now runs without destroying live data — and reveals it has been silently broken since the wire-field-rename. 1/10 steps pass (bootstrap CLI), rest cascade from step 2. Orthogonal to Task 3's gating concern. The Redis-side test-isolation leak (cross-test rate-limit pollution) is a related but separate issue; flush Redis between full-test runs as workaround. |
| QR-scanner camera stream stays active after navigating away from `/linking/scan` | Phase 0 polish, own small squash | Discovered 2026-05-21 during Task 9 manual QA of QA-fixes squash: after a successful re-link, the user navigates from `/linking/scan` → `/linking/confirm` → `/app`, and Chris observed the device camera turning on at the end despite no scanner UI being on screen. Likely missing `useEffect` cleanup in `apps/user-client/src/routes/linking/scan.tsx` (qr-scanner library's `stop()` should be called on unmount). Same root cause likely behind the `qr.ts:194 The camera stream is only accessible if the page is transferred via https.` warnings in the console — a stale ceremony attempts to restart on the wrong route. |
| ~~Settings button (and any other session-gated header control) disappears after a service-worker refresh~~ | Resolved 2026-05-21 — see Resolved | `<ProtectedRoute>` wrapper landed for `/app`, `/linking/*`, `/change-passphrase`, `/settings/*` in own squash |
| Bitwarden Android: `NotReadableError` on passkey register due to lack of PRF support | Bitwarden roadmap dependency; revisit when Bitwarden Android ships PRF | Discovered 2026-05-21 during UV-relaxation manual QA: a debug `navigator.credentials.create({ extensions: { prf: ... } })` call to Bitwarden Android consistently threw `NotReadableError: An unknown error occurred while talking to the credential manager.` Bitwarden Desktop is on the ADR-0022 compatibility matrix; Bitwarden Android is not. ADR 0005 (PRF required) correctly refuses the credential. UX-only follow-up: consider mapping `NotReadableError` to a more specific frontend copy ("Your authenticator could not complete the request — try a different one or update your credential manager") in a future copy-polish squash. No security or correctness impact. |
| Settings → "Add biometric on this device" copy now slightly drifts from mechanics (post-UV-relaxation it can register Bitwarden/Yubikey passkeys, not just biometrics) | Phase-1 UX polish, own copy/mechanics-alignment squash | Flagged by Larissa during the UV-relaxation courtesy pass (2026-05-21). `registerLocalBiometric()` in `apps/user-client/src/lib/webauthn.ts` neither sets `authenticatorAttachment: 'platform'` nor `userVerification: 'required'`, so the "Set up biometric on this device" Settings button can in fact register cross-platform passkeys. Lyra's brief explicitly retained the biometric copy on the Settings surface (the flow is most often biometric in practice), but the semantic drift is real. Two fix shapes: (a) make the copy generic ("Set up passkey on this device") — preferred from a "describe what happens" stance; (b) add `authenticatorAttachment: 'platform'` to constrain the flow to actual platform biometrics — preferred from a "make the copy true" stance. Decision deferred to a copy/mechanics-alignment squash post-Phase-0. No security or correctness impact. |
| `prom-client` metrics half of retry observability (`llm_upstream_retries_total{provider,status,operation}` + retry-delay histogram) | Phase-2 proxy-service (first server-side call-site for llm-unified) | The sink-agnostic `onRetry` hook is in place; the proxy attaches its prom-client sink to the same callback. Spec: `superpowers/specs/2026-05-31-retry-observability-design.md` §4.3. |
| ~~`session.mk` disappears after disconnect-without-logout in user-client~~ | Resolved 2026-05-21 — see Resolved | Shape-A store-slice refactor in QA-fixes squash (commit `34f6adb`); manual QA by Chris confirmed disconnect-then-relink works without the logout+login workaround |
| 8 pre-existing user-client test failures (`cockpit-draft` ×6, `chat-page`, `chat-route`) — `localStorage` undefined in those files' jsdom setup | Own small test-infra squash | Long-standing baseline (noted across bookmarks/credential-bus STATUS as "592/8", now "657/8" after message-rendering). `loadLazyDraft` → `localStorage.getItem` throws because those files don't get the `localStorage` global the rest do (likely a missing setup import or per-file environment quirk). Confirmed failing on `master` independent of any feature (verified 2026-06-01 during the message-rendering finish). |
| ~~Mermaid leaves orphan "bomb" error graphics on render error~~ | Resolved 2026-06-01 (in the message-rendering squash `433cd79`) | Manifested immediately on Chris's device test: every partial mermaid fence streamed token-by-token failed to parse, and mermaid's default error rendering injected its uncleaned "bomb" error SVG into the document — many piling up on screen. Fixed by gating `render()` behind `parse({ suppressErrors: true })` (invalid/incomplete sources never reach the renderer) plus `suppressErrorRendering: true`. Was the opus review's confidence-55 note, under-rated at the time. |

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
| ~~Provider/model handling rework: spec → implementation~~ | Implemented per spec/plan and squashed to `4c54661` (derived `ServiceKind` caps, global CORS-proxy home, configured-only add-picker + model picker, all 6 deredere extras). Awaiting Chris's device test (spec §12) before push. Insight: [[2026-06-01-provider-model-rework-sweetspot]]. | 2026-06-01 |
| ~~`full-lifecycle.test.ts` truncates production `auth_db`~~ | Resolved via TEST_DATABASE_URL + dedicated `auth_db_test` Postgres database (auto-created by `infra/postgres/init/02-create-test-db.sql` on first compose-up; ad-hoc on running instances). The test refuses to run without `TEST_DATABASE_URL` and throws if its normalised host+pathname matches `DATABASE_URL`. QA-fixes squash (commit `34f6adb`). | 2026-05-21 |
| ~~`session.mk` disappears after disconnect-without-logout~~ | Resolved via Shape-A session-store refactor: `mk` is now a separate store slice (not a property on the spread-able session), `setSession(session, mk?)` preserves the existing `mk` when the second arg is omitted. Partial-spread drops are structurally impossible. Manual QA confirmed disconnect-then-relink works without the logout+login workaround. Larissa-approved-with-defer (Critical: none, High: none; L-3/L-4 deferred). QA-fixes squash (commit `34f6adb`). | 2026-05-21 |
| ~~Wire UV-relaxation in code (3 sites)~~ | Resolved via UV-relaxation-wiring squash (commit `e814e87`). All three ceremony sites in apps/user-client now use UV='preferred' per ADR 0022; PRF (ADR 0005) untouched. Login gate rewidened from UVPAA-only to any WebAuthn-capable device. Unlock copy renamed biometric→passkey. Larissa-approved (no findings). | 2026-05-21 |
| ~~Settings button disappears after service-worker refresh~~ | Resolved via `<ProtectedRoute>` wrapper on `/app`, `/linking/*`, `/change-passphrase`, `/settings/*`. When in-memory session is null after reload, the wrapper redirects to `/` so `Gate` can decide the right destination (`/login` or `/onboarding`). Pre-existing routing bug, surfaced during UV-relaxation manual QA. | 2026-05-21 |
