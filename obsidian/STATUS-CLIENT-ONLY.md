# Chatsundere Status — Client-only

> **Roadmap to beta (2026-05-31):** [[ROADMAP]] / [ADR 0031](decisions/0031-eight-block-roadmap-to-beta.md). Client-only work is **Blocks 1–5 → v0.1.0/v0.2.0**. **As of 2026-06-30 the client side is feature-complete and live in the field at `v0.1.3`** — chat core, memory, artefacts, knowledge base, transfer, screen effects and context pre-seeding all **shipped and pushed** (no withheld deliverables). The single deliberately-deferred client feature is **projects** (post-backend). The project now stands at the **Block 5 → Block 6 boundary: the backend is the active workstream** (proxy + sync, → v0.3.0), tracked in [[STATUS-BACKEND]]. The memory→importer coupling ([[insights/future-feature-couplings]]) is closed.
>
> **Artefact system (Block 2):** Kern + Treasury + attachments + Save-as-artefact shipped. Decision log & remaining chunks: [[ARTEFACTS-FEATURE-STATUS]] — read before touching artefact work.

This file is the lean orientation surface — *read first, update last* (CLAUDE.md §16). The **full shipped history lives in the [[insights/changelog/README|changelog]]**, one chapter per roadmap block. Only the two most recent landings stay here under **Current**; at end-of-session the previous Current entry migrates into its block chapter, so this file never re-bloats.

## Current

**Last updated:** 2026-07-13 — **PRE-GO-LIVE FIX BUNDLE LANDED: six units
squashed to `master` (A→F), NOT pushed — Chris pushes after his device
verification.** Executed subagent-driven (13 TDD tasks + a Laura-driven Unit-A
fix wave, per-task spec+quality review, whole-branch opus review READY TO
SQUASH). The client-side units (B, D, E, F; A spans auth-service + client):
**Unit A** (`84d3f7dd`) — join QR codes now point at the client origin via a
shared `buildJoinQrUrl` helper + optional `APP_PUBLIC_URL`, and a new **public
`/join` chooser route** (two-gold `NavTile`s, seeds the onboarding store like the
`kind_mismatch` handoff → flow root, never `/confirm`; no wipe path);
`parseJoinUrl` accepts both the new client-origin form and the legacy form (paste
now normalises lowercase codes). **Unit B** (`b4a4944b`) — sync robustness:
`setAttention` tamper-alarm guard, empty-account "Synced" status fix, a per-cycle
stage-1 blind-id memo. **Unit C** (`6b143299`) — vector tombstones server-side on
document/library delete (excluded from the user-facing tombstone tally).
**Unit D** (`cf5b3f77`) — recovery error surfaces: onboarding unknown-username
(fatal) / malformed-key (inline) / honest 429, and flow-R "Re-enter recovery key"
back affordance + status disambiguation. **Unit E** (`cd0a3935`) — a typed
`ProxyUnavailableError` (llm-unified) drives a constructive toast + "Open Server
linking" footer button. **Unit F** (`16890861`) — a settings normaliser clears the
orphaned relay secret. **No Dexie bump** anywhere (all touched fields non-indexed).
**Audits:** Larissa CLEAR on Unit A (auth-service) + courtesy CLEAR on B+C
(tamper guard monotone, tombstone keys blind-id-only, memo MK-scoping safe, no new
plaintext); Laura **no hard defects** on A/D/E (softs are Chris-arbitrated taste —
see the fix-bundle report). Gates on `master` post-squash: `pnpm typecheck
--force` **14/14** (0 cached); full user-client vitest **2967 pass / 9
environmental** (8 Node-localStorage + 1 stream-manager parallel-load flake,
isolated 42/42 — confirmed via the localStorage error text, not code); `pnpm
build` **9/9**; llm-unified `bun test` **421/421**; Biome clean. Spec/plan:
[[../superpowers/specs/2026-07-13-pre-golive-fix-bundle-design]],
[[../superpowers/plans/2026-07-13-pre-golive-fix-bundle]]. Branch
`fix/pre-golive-bundle` kept until Chris pushes. **Next:** Chris device-verifies
(spec §9: system-camera + in-app scans of both QR forms → `/join` chooser →
prefilled flow; recovery typo/unknown-username copy; flow-R back; relay-cut
footer; empty-account "Synced"; delete a many-chunk document on device 1 → device
2 removes it with no "items removed" alarm and no hang) + the non-code checklist
(one real xAI/wafer proxy send), then pushes.

**Earlier — 2026-07-12 — ONBOARDING MATRIX REBUILT IN THE DESIGN
LANGUAGE, SQUASHED TO MASTER (`448861f`). NOT pushed (Chris pushes); awaiting
Chris's device-verify.**
The onboarding intent surface (`routes/onboarding/matrix.tsx`) — the first screen
a visitor with no local session sees — was one of the last **pre-makeover**
screens (rigid 2×2 grid, unstyled placeholder cells, no heading/brand/icons).
Rebuilt in the makeover language: a `Welcome` eyebrow over the `Chatsundere ✦`
wordmark (reused `brand-logo-text`/`-twinkle`), then **four standard-height
`NavTile`s vertically centred** on the screen (`justify-center`, no scrolling at
380 px). The two account-backed paths — **I have an invitation** and **Link this
device to my account** — share the **gold** priority overlay (a conscious
**two-gold** deviation; both are the fully-featured outcome — Chris-authored).
**Use a recovery key** is pink; **Just this device** is purple at **full
opacity** — its "lesser" read is carried by **hierarchy** (last position), never
dimming (in this design language opacity means `disabled`). Icons: `Ticket` /
`MonitorSmartphone` (the PC+phone "first-choice combo") / `KeyRound` / `CloudOff`.
**No `NavTile` change** — standard primitive at its normal size. Built
spec→**Laura spec-pass** (**1 HARD** — the local tile's ~0.7 dim reused the
disabled opacity vocabulary — **resolved before build** by dropping the dim; 4
soft, `CloudOff`+two-gold Chris-arbitrated, `Welcome`-eyebrow adopted)→build→
**Laura pre-squash CLEAN**. **Device-review correction folded:** the first cut
stretched tiles to fill the viewport (`flex-grow` 3:3:2:2) → read as oversized
blobs + scrolled; Chris's call gave them normal menu height, centred (the `grow`
prop was removed entirely). Not a Larissa path. Gates (final): `pnpm typecheck`
**0**; full user-client vitest **2931 pass** (clean run, all 546 files); `pnpm
build` **9/9**; Biome clean on changed files. Deviations logged in
[[insights/ux-deferrals]]. Spec:
[[../superpowers/specs/2026-07-12-onboarding-matrix-makeover-design]]. Branch
`feat/onboarding-makeover` kept until Chris pushes. **Next:** Chris
device-verifies (spec §8: fresh client → four standard-height tiles centred, no
scroll at 380 px; gold pair / pink / full-opacity purple; each tile enters its
existing flow), then pushes for the v0.2.0 release.

**Earlier — 2026-07-08 — OPTIONAL PASSWORD ENCRYPTION FOR TRANSFER PACKS
SQUASHED TO MASTER (`b7211524`). NOT pushed (Chris pushes after device-verify).**
Field-user request: encrypt persona/knowledge-library exports under a freely chosen
password. Built as a thin **outer shell** around the existing transfer packs —
`writePersonaPack`/`writeKnowledgePack` untouched; the plaintext gzip-tar is sealed
(`Argon2id → HKDF → AES-256-GCM` + house integrity HMAC, new `packages/crypto/src/export/`
flow) and wrapped in the **same** gzip-tar envelope with a `chatsundere/encrypted`
manifest carrying the KDF params. **Off by default on both surfaces** (one-tap plaintext
path byte-unchanged); a shared `EncryptExportSection` (checkbox → password + confirm +
no-recovery notice) sits in the persona `ExportOverlay` and a new `LibraryExportOverlay`.
Import detects the format, prompts via `DecryptPromptOverlay`, decrypts to the inner
pack, then **recurses into the existing import path** — so id-remap/collision logic is
untouched; wrong password/tamper both surface as a constructive "didn't work, or the
file is damaged" with the typed password preserved (no dead-end). **Backward-compat
(hard):** v0.1.3 plaintext packs import unchanged (encryption metadata lives only on the
encrypted manifest); pinned by test + manual step. Standalone password, never
account-bound (import runs on a device with no account). KDF params **bounded before
derivation** (512 MiB ceiling) so a hostile container can't force a huge allocation.
Built spec→plan→**subagent-driven (8 TDD tasks, per-task spec+quality review)**→
**whole-branch opus review "Ready to merge"**→**Larissa CLEAR TO SQUASH** (crypto path;
no Crit/High — encrypt-then-MAC, AAD binds version+format, no wrong-password/tamper
oracle, zero-knowledge untouched)→**Laura NO HARD DEFECTS** (4 soft, deferred). One
post-audit fix wave folded (KDF ceiling 1GiB→512MiB, broadened wrong-password copy,
+tamper-nonce/salt tests, JSDoc, `useId()`). Gates on master post-squash:
`pnpm typecheck --force` **14/14** (0 cached); crypto `bun test` **8/8** export (207
total); user-client transfer/export/component **508/508**. Spec/plan:
[[../superpowers/specs/2026-07-08-encrypted-export-design]],
[[../superpowers/plans/2026-07-08-encrypted-export]]. Branch `feat/encrypted-export`
kept until Chris pushes. **Deferred follow-ups** (non-blocking): `useEncryptedImport`
hook to dedup the two import hosts; Valibot-validate the encrypted manifest; fold
`algoVersion` into the AAD when a v2 scheme lands; bounded gzip-inflate on the *shared*
pack-import decompressor (pre-existing gzip-bomb surface); remaining Laura soft
(mismatch-reason placement parity across the two export overlays). **Follow-up landed
(`a086db1e`):** a show-password reveal toggle on the import `DecryptPromptOverlay` (the
import has no confirmation field, so a typo is the whole failure — Laura soft, Chris
approved). **Next:** Chris device-verifies (spec §10: encrypted persona+library export →
import on a fresh client; wrong password stays constructive; a real v0.1.3 export imports
with no prompt), then pushes.

**Earlier — 2026-07-06 — PROVIDER ROWS UNIQUE PER TEMPLATE (duplicate-provider fix).**
Landed on master as one squash (`fc8b3f4b`), **awaiting Chris's device-verify + push**
(manual steps in [`superpowers/specs/2026-07-06-provider-key-uniqueness-design.md`](../superpowers/specs/2026-07-06-provider-key-uniqueness-design.md) §10).
Root cause of the "two `nano-gpt` rows on one primary-admin" report (2026-07-06): cross-device
convergence — each device minted its own `uuidv7()` provider id, so the sync engine (which keys
providers by `row.id`) never deduped them. Fix: a provider row's `id` value **is** its
`templateId` (Dexie keyPath unchanged), so identical ids across devices merge under one blindId
automatically; a new `keySlot` field decouples the API-key seal AAD from `id` (no re-seal, no MK
in the migration); a Dexie **v35** data migration dedups (enabled > newest `updatedAt` > id),
rekeys `id`→`templateId`, and **remaps `persona.providerId`** back-references (a CRITICAL the
whole-branch review caught — else every pre-existing persona would break). Built subagent-driven
(4 tasks, per-task + whole-branch review); **Larissa CLEAR** (one MEDIUM cache/DB seal-slot race
fixed via a single `keySlot` source). Also this session: `reset-dev-auth.sh` now wipes `sync_db`
+ MinIO blobs (it stranded orphan accounts before — 3 found live), and those orphans were purged
from the dev store.
> **Follow-up (Minor, non-blocking):** no test pins a genuine `keySlot`-divergence scenario
> (migrated row with `keySlot = legacy-uuid` then an in-place upsert) — add one if the provider
> write path is touched again. Optional: a light Laura UX pass was not run (pure internals — no
> user-reachable flow changed).

> **Status correction (2026-06-30):** every "NOT pushed / awaiting Chris's
> device-verify" note in the entries below is **superseded** — all of this work
> is **device-verified, pushed, and live at `v0.1.3`**. The client side is
> feature-complete (only **projects** deliberately deferred). The active
> workstream is now the **backend** — see [[STATUS-BACKEND]] and
> `BACKEND-ANALYSIS-cors-proxy-and-sync.md`. The detailed entries below are
> retained as accurate landing history pending migration to the changelog.

**Last updated:** 2026-06-30 — **NATIVE CHATSUNDERE TRANSFER (export/import)
COMPLETE, rebased onto master on top of the deployed v0.1.2 line (chat-usability
+ model-debugger). Import now lands in the new persona **hub**
(`routes/app/persona/hub.tsx`, post-makeover); export is wired into the hub's
`Export persona` action. Device-verified, pushed, live at `v0.1.3`.**
The native, **create-new-only** export/import of a persona (its chats +
**memory**) and a knowledge **library**, in Chatsundere's own `.tar.gz` format —
deliberately separate from the Chatsune *bridge* (which stays the Tier-A
stop-gap). Two packs: `chatsundere/persona` (3 export switches — **Memory ON ·
Artefacts ON · Images OFF**, honest-labelled; avatar always travels) and
`chatsundere/knowledge` (library + documents + **adopted vectors**). Import is
**100% deterministic, never merges** (Chris's call — a merge is a
non-deterministic black box that leaves broken personas behind; sync comes with
the backend): every id is freshly minted, every reference (incl. nested
`contentBlocks.pillId` + pill-payload artefact refs + compaction/extraction
cursors) remapped, name-collision is an **explanatory non-blocking** warning.
**Live bindings degrade, never block** (provider→`modelRef`; MCP/library
bindings dropped — cheap to re-add per Chris's "≤2 MCP servers" field data;
mindspace→default). **Secrets never leave the device** (no `ProviderRow`/
`apiKey`/`EncryptedBlob` in any archive — whole-archive scan test). **Library
vectors**: exported (497 B/chunk, tiny) + a `codecVersion`/`modelId`/`dim` stamp
→ **adopt instantly when compatible, auto-re-embed on a model/codec change**
(pure `resolveVectorStrategy`). Import lands a persona in its **hub** (Laura
HARD-1) with a calm **post-import note** (pick a model / bindings don't
transfer). Export is a **transient overlay** off the hub's `Export persona`
action, not a surface (a begin→end operation gets no room). New infra: a browser
**tar writer** (counterpart to the existing `untar`). **No Dexie/schema change.**
Built spec→**Laura spec-pass** (HARD-1 + softs folded)→plan→**subagent-driven**
(12 tasks, per-task spec+quality review). The **opus whole-branch review caught a
CRITICAL** every per-task review missed — `contentBlocks[].pillId` was not
remapped, so **all pills would silently vanish** from imported messages (the
round-trip test only used text+reasoning) — plus 2 Important (pill-payload
artefact refs; image-artefact `thumbBlob` `{}`-poison); **all fixed + locked with
a pill/artefact round-trip regression test**, re-reviewed **merge-ready**. Not a
Larissa path (client-only; no `packages/crypto`/auth/sync/proxy change). Gates
(post-rebase, on the v0.1.2 base): `pnpm typecheck --force` **14/14** (0 cached;
needed a `llm-unified` rebuild — stale `dist/` masked the model-debugger
exports); full user-client vitest at the **8 Node-localStorage/lazy baseline**
(2134 pass). Specs/plans:
[[../superpowers/specs/2026-06-29-chatsundere-transfer-design]],
[[../superpowers/plans/2026-06-29-chatsundere-transfer]]. **Deferred follow-up
minors** (non-blocking, for a later pass): double archive-read on file-pick +
`untar`-all-for-manifest; source-name `unknown`-narrowing duplicated across the
two import hosts; tar-writer comment "space-padded"→"zero-padded"; a couple of
test-ergonomics nits. **Next:** Chris device-verifies (spec §9 + plan "Manual
verification": export Fable images-off → import on fresh client → history +
reasoning + memory + avatar present, model prompts, **pills/tool-calls survive**;
library export → import **adopts instantly, no spinner**; collision warning
non-blocking), then pushes. Then the **emoji shower** (Chris's parallel
spec/worktree) + the deferred chat/persona-editor knowledge sub-surfaces.

**Earlier (2026-06-28) — CHAT USABILITY PASS — BOTH SLICES SQUASHED
TO MASTER (Slice A chrome `b5c16ee`, Slice B cockpit pages `cde9871`). NOT
pushed (Chris pushes); awaiting Chris's device-verify.**
The structural/bedienbarkeit pass on the **chat** (the last + densest makeover
surface). Built spec→**Laura spec-pass** (1 HARD + 8 soft, all folded)→2 plans→
**subagent-driven (12 tasks, per-task spec+quality review)**, then per-slice
**opus whole-branch + Laura pre-squash** before each squash.

**Slice A — chrome (`b5c16ee`).** **(1) Read-only chat topbar** (`routes/root.tsx`,
reading-chat branch only): the thin logo strip becomes a clear **exit** (Lucide
`ArrowLeft` + "Chatsundere" wordmark = one link → Entrance Hall `/app`), the
**persona avatar** (off-centre → `/app/persona/:id`), and a **plain-text chat
title** (right, truncating, non-interactive), all fed by a new **`chatHeader`**
field on `current-chat.store` published by `chat-page`. The chat-chrome predicate
is narrowed to the **exact** chat route via new exported **`isExactChatRoute`**
(Laura HARD) so the Slice-B sub-pages keep standard chrome; non-chat home-logo
destination preserved. **(2) Cockpit icons** → Lucide **Bookmark / Gem / Brain /
BookOpen** (Brain also on the memory page). **(3) Toasts** → top **full-width
banner**, global, off the cockpit; body `pointer-events:none` so the PageBar back
stays tappable. opus caught a real **reduced-motion regression** (a
`.cockpit-reject { animation: none }` killed its `onAnimationEnd` dismiss → fixed
via a motion-free 3s hold keyframe).

**Slice B — cockpit pages (`cde9871`).** The bookmarks / artefacts / knowledge
cockpit buttons become **full chat-scoped pages** (`/app/chat/:chatId/{bookmarks,
artefacts,knowledge}`) mirroring the memory page (PageScaffold, `?`-help, H1,
return-to-chat), **retiring** `TocSheet`/`ArtefactSheet`/`KnowledgeSheet` + their
dead CSS. **Bookmarks** = Pinned + In-this-chat (ToC); tapping a row jumps back
into the chat at that message (push nav, so system Back returns to the list, via
the existing `?focus` mechanism). **Artefacts** = `TreasuryRow` rows → Lightbox
(rename/delete there); persona derived via `useChat→usePersona` (opus caught a
`chatHeader`-cleared "—" regression). **Knowledge** = pure binding-toggle surface
(persona libs locked-on "from persona", others always-save), makeover-styled.
All four cockpit buttons now behave identically and are **disabled-with-reason on
a not-yet-created (lazy) chat** (Laura HARD — dropping the old gate would have let
them navigate to `/app/chat//…` → blank screen). Mental model: **cockpit pages =
"this chat", Entrance-Hall rooms = global**.

Not a Larissa path (client-only). Gates (both slices, on master): repo
`pnpm typecheck --force` **14/14**; full user-client vitest **2106 pass / 0 fail**
(400 files); `pnpm build` green; Biome clean. Spec/plans:
[[../superpowers/specs/2026-06-28-chat-usability-pass-design]],
[[../superpowers/plans/2026-06-28-chat-usability-A-chrome]],
[[../superpowers/plans/2026-06-28-chat-usability-B-cockpit-pages]]. Branches
`feat/chat-usability-chrome` + `feat/chat-usability-pages` kept until Chris
pushes. **Next:** Chris device-verifies (topbar exit/avatar/title; toast banner;
the four cockpit pages incl. lazy-chat disabled state + bookmarks jump-back), then
pushes. Then the chat's **visual fine-tuning** pass (the deliberately-deferred
polish: toast top-offset vs PageBar, persona-label suppression, etc.) + the
remaining deferred sub-surfaces (chat `DocumentPicker`, attach-picker Quick-Sheet).

**Follow-up landed (`f527dc5`):** the read-only topbar's persona avatar now
threads the chat as a `?return=` param, so the persona page's back control
returns straight to the chat (not My Circle) — Chris's wish; `feat/persona-back-to-chat`
kept until push.

**Earlier (2026-06-28) — MODEL DEBUGGER SQUASHED TO MASTER. NOT
pushed (Chris pushes); awaiting Chris's device-verify.**
A self-service diagnostic so non-technical users can capture a copyable, redacted
report when a model stream misbehaves (the trigger: a US iPhone/Safari user whose
Sonnet-4.6-via-nano-gpt stream breaks where Chris can't reproduce it). **Two
surfaces, one shared core.** (A) **`packages/llm-unified`** gains an optional
`StreamDiagnosticsSink` threaded through `streamCompletion`/`transport.ts` — fires
`onRequest`/`onResponse` with secrets **redacted at source** (request-header
**denylist**: `authorization`/`x-api-key`/`api-key`/`x-cors-proxy-api-key`/
`proxy-authorization`; response-header **allowlist**: `content-type`/
`content-encoding`/… so gzip-buffering & friends are visible). Optional → existing
streaming path byte-unchanged when absent. (B) **`lib/model-debug.ts`** (pure):
`createDiagnosticsCollector` (timeline from sink events + chunks, tool-call chunks
logged by name only), `buildEnvironmentSnapshot` (UA/platform/COI/online/TZ),
`formatReport` (sectioned plain text, title branched on kind), and
`runStreamingTest` — runs the **real** streaming path against a fixed
count-1-to-10 prompt with a 5 s stall watchdog (60 s timeout + Stop owned by the
caller's AbortController). (C) **Provider-page surface**: a gated **"Test a model"**
button (My Settings → AI Providers → ‹provider›) opens `ModelDebugOverlay`
(provider-scoped LLM picker → Run → `ModelDebugReport`: warm line, screenshot-clean
`<pre>`, "Copy report" + named clipboard fallback, "paste into your reply" line).
**Laura HARD D6**: disabled-with-**visible**-reason ("Save a key first" / "Set a
CORS proxy first") so a precondition never masquerades as a model failure. (D)
**Chat-failure surface**: the live stream stores a `chat-failure` report
**in-memory** (no Dexie) on failure — report-building runs **after** the
draft-incomplete recovery persistence so it can never block Retry/Discard; aborts
produce nothing. `StreamInterruptedFooter` gains a **quiet** "Show diagnostics"
text-link + **"Copy this before reloading"** perishable nudge (Laura D7), shown
**only when a report exists** (hidden-not-disabled, Laura's §8 ruling); the report's
partial reply is **labelled** as the user's content (Laura D8). Built
spec→Laura-spec-pass (1 HARD gating + softs folded)→plan→**subagent-driven (9
tasks, per-task spec+quality review)**. **opus** whole-branch: **merge-ready** —
traced every secret path, none reach `formatReport`/clipboard/localStorage; 5
cosmetic minors. **Laura** pre-squash: **no hard defects** — all six intents held
(D6 stronger than mandated via the visible reason), distressed-user path
find→run→copy has no dead-end; the convergent "report mis-titled Model Test on a
chat failure" + clipboard-fallback softs **folded**. Not a Larissa path (no
auth/sync/proxy-service, no `packages/crypto`); the `transport.ts` redaction was
flagged for and cleared in code review. Gates: `pnpm typecheck --force` **14/14**;
`pnpm build` **9/9**; full user-client vitest **2095 pass / 0 fail** (clean run —
the known stream-manager parallel-load flake passed this run); llm-unified
`bun test` **390 pass**; Biome clean on changed files. **One regression the gate
run caught & fixed**: `ModelDebugOverlay` computed `offerings.filter` on mount and
crashed 7 existing `SettingsProviderPage` tests on a definition mock with no
offerings → guarded `offerings ?? []`. Spec/plan:
[[../superpowers/specs/2026-06-28-model-debugger-design]],
[[../superpowers/plans/2026-06-28-model-debugger]]. **Next:** Chris device-verifies
(test a model per provider; force a real chat failure → Show diagnostics → copy;
confirm no key in the pasted report), then pushes. Then back to the **chat makeover**
(the last big surface). Branch `feat/model-debugger` kept until Chris pushes.

**Earlier (2026-06-27) — V0.1.0 EARLY-ALPHA SHIPPED & LIVE at
`app.chatsundere.me` 🎉 (squash `7aa46eb`; tag `v0.1.0` on the feature commit;
STATUS `0638076`). Pushed, tagged, deployed, device-confirmed by Chris.**
The first public early alpha ships as a self-contained **frontend Docker image**
to Chris's VPS via Traefik + a scoped Watchtower — superseding the GitHub Pages
`/alpha/` path (`pages.yml` left as-is for the teaser; its `/alpha/` deploy is
now obsolete — a later cleanup). Three pieces. **(A) `apps/user-client/Dockerfile`
+ `nginx.conf` + root `.dockerignore`** — multi-stage, monorepo-aware (build
context = repo root), `pnpm install --ignore-scripts` (the root `prepare` →
`lefthook install` needs git, absent in alpine), build `packages/*`→`dist/`, then
**bake the embedding weights (int8 + q4f16) as a stable cached layer**; nginx
serves **COOP=same-origin + COEP=credentialless natively** → `crossOriginIsolated`
→ **multi-threaded ORT-WASM** with no service-worker hack. Model `REVISION`
pinned to HF commit `95c27414…` + `EXPECTED_SHA256` filled for all six files
(reproducible, integrity-checked). **(B) `.github/workflows/docker.yml` +
`version.txt`→0.1.0 + `infra/compose.alpha.yml`** — GHCR frontend job;
**`:latest` is tag-gated** (`enable=startsWith(ref,'refs/tags/v')`), so a master
push builds a `sha-…`-tagged image but does **not** move `:latest` → **Watchtower
deploys only on a conscious `v*.*.*` tag**, not every merge (deliberate deviation
from chatsune's branch-gated `:latest`). `compose.alpha.yml` is a dedicated,
secret-free, **committed** frontend + watchtower stack (Watchtower
**`scope=chatsundere`**, coexists with Chris's already-scoped secondcircuit
Watchtower); the secret-bearing backend `compose.prod.yml.example` is untouched,
and the new name sidesteps the `.gitignore` rule on `compose.prod.yml`. **(C)
CORS proxy hard-wired** (`CorsProxyBlock.tsx`, new `lib/cors-proxy.ts`,
`settings.ts` load-time coercion) — the URL is fixed to `cors-proxy.tidesson.net`
(overridable via `VITE_PROXY_URL`) and shown read-only; **users supply only the
access key** (Chris's Discord plan: share the proxy, one field not two).
`sealSecret`/MK consumed **verbatim → not a Larissa path**; **no Laura** (pure
simplification of a transitional advanced block, Chris-signed-off). **Verified:**
local `docker build` → run → curl confirms the isolation headers on `/`, SPA
routes, `/model/`, `/assets/`; `index.html` no-store; `application/wasm` on the
**threaded** ORT chunk; model + `/VERSION` served; `docker compose config` valid.
Gates: `pnpm typecheck` **14/14**; `pnpm build` **9/9**; full user-client vitest
**2082 pass / 0 fail**; Biome clean on changed files (pre-existing embeddings
`tokenizer.json` >1 MiB baseline unchanged, gitignored). Plan:
[[../superpowers/plans/2026-06-27-early-alpha-release-v0.1.0]]. **Shipped:** GHCR
package public, `v0.1.0` tagged + pushed, Watchtower pulled, live behind Traefik;
device-confirmed — the embedding model is served from `app.chatsundere.me/model/`
(not HuggingFace; `allowRemoteModels=false`) as a one-time browser-cached load,
embedding runs, the proxy block is key-only. **Process gotcha that bit us
(captured in memory `skip-ci-release-push-gotcha`):** the push ended on the
`[skip ci]` STATUS commit `0638076`, which skipped the whole push's CI — so the
tag was placed on the **feature** commit `7aa46eb` (no `[skip ci]`) to make
`docker.yml` run. For the next release, tag the feature commit, not the master
tip. **Next session:** the **chat makeover** (last + densest surface) + the
deferred attach-picker Quick-Sheet; Discord alpha-tester rollout (Chris shares
the proxy key).

**Earlier (2026-06-27) — MY CIRCLE + THE PERSONA EDITOR REBUILT IN
THE DESIGN LANGUAGE, SQUASHED TO MASTER (`c9a1250`). NOT pushed (Chris
pushes); awaiting Chris's device-verify.** Reviewed merge-ready (opus
whole-branch + Laura pre-squash, no hard defects). Per Chris's call the
squash bundled the parallel v0.1.0 early-alpha release-plan doc; the
`feat/my-circle-persona` checkpoint branch is fully contained in the squash
and safe to delete.
The ninth & tenth makeover surfaces — the pre-chat pair. **My Circle**
(`/app/circle`) goes from the `PersonaCard` grid + FAB to the makeover
**`PageScaffold` + `cs-row` list**: each persona a row (PersonaAvatar +
StreamingOrb leading, persona-colour/font name over tagline, NSFW `Badge` in
adult mode, and — uniquely for this list — a **visible Continue/New-Chat
button kept on every row** as the fast path to chat), the provider-missing
cue now **routing to Settings → AI Providers**, and a **divided
`OverflowMenu`** (New chat · New incognito [disabled] · Continue — separator —
Go to persona · Delete→`ConfirmDialog`). **Delete moved here, off the
editor.** The **persona editor** is split from one long accordion into: a
focused **create step** (`/app/persona/new`, name-only to create) → a
**Persona Hub** (`/app/persona/:id`: action row with **affirmative-only
gold**, always-save identity [avatar/name/tagline/model], an **8-tile
colour-clustered `NavTile` matrix** — pink Instructions/Roleplay · blue
Model-behaviour/Integrations · green Knowledge/Memory · purple
Font&Voice/Mindspace — Chatsune import-merge + disabled Export at the bottom,
**no delete**) → **eight always-save sub-pages** + the **reskinned memory
page** (PageScaffold chrome + the per-persona Remembering toggle folded in,
labelled **persona-global**). New primitive: **`OverflowMenu` separators**.
**Behaviour fix (Laura HARD): the greeting opener now fires only when
`roleplay && greetingEnabled`** — greeting is a roleplay sub-feature; runtime
gate in `chat-page.tsx`, `greetingInstructions` preserved, **no Dexie
migration** (Chris-signed-off). New pure **`lib/persona-hub.ts`** (validity +
tile-meta helpers). Retired `persona-editor.tsx` + `EditorTopbar` /
`EditorSticky` / `AccordionCard` / `PersonaCard` / `MemorySection` +
`.persona-card*` CSS (AvatarField / ContextWindowControl / defaultDraft
extracted to shared files first). **No Dexie/schema change.** Built spec→
**Laura spec-pass** (1 HARD greeting-orphan fixed via the runtime gate;
softs folded: affirmative-only gold + calm incomplete sentence,
persona-global memory label, provider-missing routing, concrete incognito
reason)→plan→**subagent-driven (15 tasks, per-task spec+quality review)**.
**opus** whole-branch: **merge-ready** (0 Critical/Important; 4 Minors logged
as follow-ups: `?return=` not threaded through sub-pages, import-toast dedup,
create cold-deep-link colour, no-op remove-avatar). **Laura** pre-squash:
**no hard defects** (all 7 spec-pass intents held; 3 softs, the `?return=`
papercut logged in [[insights/follow-ups-index]]). Not a Larissa path
(client-only). Gates: `pnpm typecheck --force` **14/14**; full user-client
vitest **2080 pass / 0 fail**; production build green; Biome clean (bar the
pre-existing embeddings `tokenizer.json`). Specs/plans:
[[../superpowers/specs/2026-06-27-my-circle-and-persona-editor-makeover-design]],
[[../superpowers/plans/2026-06-27-my-circle-and-persona-editor]]. **Next:**
land the branch (Chris's call re: the interleaved release-plan commits),
device-verify, then the **chat** makeover (the last + densest surface) + the
deferred attach-picker Quick-Sheet.

**Earlier (2026-06-27) — MY HISTORY REBUILT IN THE DESIGN
LANGUAGE, SQUASHED TO MASTER (`d5721cb`). NOT pushed (Chris pushes);
awaiting Chris's device-verify.**
The eighth makeover surface. `/app/history` goes from the pre-makeover
`EditorTopbar` + bespoke `.history-*`/`.bookmark-*` chrome to the makeover
**`PageScaffold`/`PageBar`** + **`cs-segmented`** tabs + the **`cs-row`** list,
across **both tabs** (Chats and Bookmarks). **Chat rows**: `PersonaAvatar`
leading (the `StreamingOrb` pinned to its corner), a **1px-smaller title**
(`cs-row-title[data-compact]`) in the persona colour over `persona · age`, an
**NSFW `Badge`** gated on **`persona.adultPersona`** (renders in adult mode only —
SFW filters adult personas out upstream), and an **`OverflowMenu`** carrying the
four actions Chris asked for behind `⋯`: **Rename** (inline), **New chat with this
persona**, **Go to persona** (via `?return=` URL-encoded back to the *filtered*
History — Laura SOFT-1), **Delete** (destructive → `ConfirmDialog` with the lazy
`useChatArtefactCount` warning, replacing the old inline tray). Row-body tap still
opens the chat. **Bookmarks**: avatar-led group headers, a **visible remove-star**
+ rename housed in a per-entry `⋯` (Chris's call: star visible, rename in the
menu); the **empty state moved to the route** (distinguishing *no bookmarks yet*
from *no bookmarks match your filter*). Restyled the **persona filter dropdown** to
the `cs-*` tokens; new pure **`historyCountLabel`** (empty / `N chats` / `N of M`)
mirroring Treasury; **Clear-filter** CTAs on the filtered-empty states (Laura
SOFT-5). **`HistoryRowRenameInput`** gained an opt-out **`sanitise`** flag (default
true keeps chat-rename byte-equivalent; bookmarks opt out to preserve full
80-char labels — a regression the quality review caught) + optional `maxLength`.
**`PersonaAvatar`** gained `role="img"` + an `aria-label` on its monogram branch.
Retired `HistoryRowConfirmTray` + the dead `.history-*`/`.bookmark-*` CSS;
**`.toc-entry-*` kept** (owned by the chat ToC `TocSheet`). **No Dexie/schema
change.** Built spec→**Laura spec-pass** (no hard defects; SOFT-1 `?return=` +
SOFT-5 Clear-filter folded as build mandates; SOFT-3 380px crowding a build
watch)→plan→**subagent-driven** (7 tasks, per-task spec+quality review; folded:
restored a streaming-orb test + class-ified the rename cursor, the bookmark
label-sanitise opt-out, Clear-filter test coverage; **a Task-7 over-fix that
reverted the bookmark `⋯` design to satisfy a *pre-existing* stale component test
was caught and reverted** — the approved star+`⋯` design restored, the stale test
updated). **opus** whole-branch review: **merge-ready** (2 advisory minors folded:
`role="img"`, dead `data-role` dropped). **Laura** pre-squash: **no hard defects**
— her SOFT-3 cleared (the title *wraps*, never truncates; the NSFW Badge is
non-interactive so no `⋯` collision); 4 softs deferred, two of them
**Chris-arbitrated ship-as-is** (the generic "Clear filter" copy; the "All"→
persona narrowing on Go-to-persona return), two folded into the **design-language
tap-target sweep** (the shared 32px `⋯` trigger + adjacent star/`⋯` targets — a
cross-surface call, not a My-History fix). Not a Larissa path (client-only).
Gates: `pnpm typecheck --force` **14/14** on master post-squash; full user-client
vitest **2046 pass** (clean run); production build **9/9**; Biome clean.
Specs/plans: [[../superpowers/specs/2026-06-27-my-history-makeover-design]],
[[../superpowers/plans/2026-06-27-my-history]].
**Follow-up landed (`00fe551`):** list-surface chrome now **pins** — a new opt-in
**`stickyHeader`** slot on `PageScaffold` keeps the PageBar + tabs/search/filter/
count fixed as one frosted `.cs-page-chrome` block so **only the list scrolls**
(applied to My History *and* My Treasury; document-scroll preserved for mobile
URL-bar collapse; backward-compatible — every page without `stickyHeader` is
byte-identical). It is a **reusable list-surface primitive** the chat makeover and
future list rooms should adopt. The merged `feat/my-history` + `feat/my-treasury`
checkpoint branches were removed during cleanup (their squashes `d5721cb` /
`7f0ea7a` are on master). **Next:** Chris device-verifies My History + My Treasury
(incl. the only-the-list-scrolls feel), then **My Circle + the persona page**
(the pre-chat pair, next context window), then the **chat** (last + densest) +
the deferred sub-surfaces (chat `DocumentPicker`, persona-editor
`KnowledgeSection`, the attach-picker Quick-Sheet).

**Earlier (2026-06-27) — MY TREASURY REBUILT IN THE DESIGN
LANGUAGE, SQUASHED TO MASTER (`7f0ea7a`). NOT pushed (Chris pushes);
awaiting Chris's device-verify.**
The seventh makeover surface. The Treasury room (`/app/treasury`, the global
view over all chat-owned artefacts) goes from the pre-makeover `EditorTopbar` +
bespoke `.treasury-*` chrome to the makeover **`PageScaffold`/`PageBar`** + the
**`cs-row`** list. All artefact logic (filtering, NSFW gating, URL mirroring, the
multi-select state machine, the lightbox) is **preserved verbatim**; only chrome
+ the type-filter affordance change. **Type filter stayed a segmented control**
(Laura's spec-pass argument, Chris's call — a fixed five-item axis, *not* a
dropdown, reversing his original ask), restyled to `cs-segmented`, `Img`→
`Images`. **Header count** via a new pure `treasuryCountLabel` → `empty` /
`N artefacts` / **`N of M`** when a filter narrows the set (the empty-state
discriminant now keys on the NSFW-visible set too). **Rows** = `cs-row` (leading
glyph/check · title · persona·FORMAT·size·age · **inline favourite star** kept
out of the ⋯); `data-treasury-row` preserved (lightbox zoom origin). Restyled
the **⚙ filter sheet + bulk action bar**; authored a new **treasury `?`-help**.
Retired the orphaned `.treasury-row*`/`.treasury-list` CSS. **No Dexie/schema
change. Lightbox out of scope** (acceptable as-is). Built spec→plan→
**subagent-driven** (7 tasks, per-task spec+quality review; folded review
findings: a transient `<ul>`-wrapping-`<div>` + trailing `stopPropagation` on the
row, a dead `useNavigate` import + the empty-state `rows`→`visibleRows`
discriminant on the route, an ink-fallback token + `cs-seg` cursor). **Laura**
spec-pass (**no hard defects**; the **segmented-control** kept over the
originally-asked dropdown + `Images` + `N of M` folded; 5 softs) **and**
pre-squash (**no hard defects**; her **§14.6 fixed-overlay watch cleared** — she
walked the at-rest ancestor chain: `cs-page-body` carries no transform, the
nav-zoom transform is stripped `onAnimationEnd`, overlays resolve to the viewport
at 380 px, the lightbox portals to `<body>`). **opus** whole-branch review:
**merge-ready** (3 Minors, all intentional/improvements — incl. the enlarged
leading tap-target). Not a Larissa path (client-only; no `packages/crypto`,
auth/sync/proxy change). Gates: `pnpm typecheck --force` **14/14** on master
post-squash; full user-client vitest **2043 pass** (clean run, no baseline
flakes this run); production build **9/9**. Specs/plans:
[[../superpowers/specs/2026-06-27-my-treasury-makeover-design]],
[[../superpowers/plans/2026-06-27-my-treasury]]. Branch `feat/my-treasury` kept
until Chris pushes. **Next:** Chris device-verifies, then the **chat** (densest
surface — comes last) and the deferred sub-surfaces (chat `DocumentPicker`,
persona-editor `KnowledgeSection`, the attach-picker Quick-Sheet).

**Earlier (2026-06-26) — MY KNOWLEDGE REBUILT IN THE DESIGN
LANGUAGE, SQUASHED TO MASTER (`13b867ad`). NOT pushed (Chris pushes);
awaiting Chris's device-verify.**
The sixth makeover surface. The knowledge-base room (`/app/knowledge`) goes
from the pre-makeover sheet/accordion chrome to the makeover **three-level page
tree**: library **list → library detail → document detail** (+ create mode) —
the My Integrations list→detail pattern extended one level deeper. All
knowledge-base logic (chunking, the embedding queue, status tracking, lore
trigger-phrases, NSFW filtering, the Chatsune import) is **ported verbatim**;
only chrome + the add/edit/delete IA change. **No Dexie/schema change.**
**List** (`PageScaffold`): pure-navigation rows, trailing **NSFW badge** (kept
deliberately — safety cue in NSFW mode) + **doc-count badge**, single `+ Add`,
**Import-from-Chatsune in the ⋯**. **Library detail**: **always-save** inline
metadata (name/description/NSFW) — **no dirty-guard here**; the **NSFW toggle is
disabled-with-reason in SFW mode** (the vanish guard — flipping it on in SFW
mode would `useFilteredLibraries`-hide the row, reading as deleted); an **`Add ▾`
menu** (Upload files / New document) with **constructive upload-failure feedback**
(names the offending file), `ModelDownloadBanner`, **delete in the ⋯ →
ConfirmDialog**. **Document detail** (3rd level, `/:libraryId/:documentId` +
`/new`): **one explicit Save + one dirty-guard** for the whole page (Chris's
"one mental model, no astonishment"), **re-embed only when content actually
changes** (content diffed into the patch), `TagEditor` trigger-phrases,
**companion toggle disabled-with-reason without phrases**, **failed-embedding
cause + Retry on the detail page** (not the list row), delete in the ⋯. New
shared **`lib/knowledge-status`** maps; **`OverflowMenu` gained a
backward-compatible `variant="labelled"`** for the visible `Add ▾` (default
icon-⋯ callers byte-identical). Retired the old sheets/badge/menu components
(`LibrarySheet`/`DocumentEditor`/`AddDocumentMenu`/`DocumentStatusBadge`/
`ChatsuneLibraryImport`) + their dead CSS + the old `knowledge-library` route.
**Out of scope (deferred):** the chat `DocumentPicker` (with the chat surface)
and the persona-editor `KnowledgeSection` (with the persona editor); NSFW
deep-link gating of the detail route (existing follow-up). Built
spec→plan→**subagent-driven** (6 tasks, per-task spec+quality review). **Laura**
spec-pass (2 HARD folded: companion-toggle reason + the NSFW-vanish guard;
5 softs incl. the `Add ▾` caret) **and** pre-squash (**1 HARD** the code reviews
missed — `OverflowMenu.triggerLabel` was aria-only, so `Add ▾` rendered as a
bare ⋯ indistinguishable from the delete ⋯ → fixed via the labelled variant;
5 softs folded: dirty-gated Save, save-failure notice, paste→"write a new one"
copy, breadcrumb `…` fallback, companion help). **opus** whole-branch review:
**merge-ready with fixes** (1 Important breadcrumb-name + minors — all folded;
a Task-5 `normalisePhrases` data-layer re-export was reverted, restoring the
verbatim port). Not a Larissa path (client-only; crypto untouched). Gates:
`pnpm typecheck --force` **14/14** (0 cached) on master post-squash; full
user-client vitest **2029 pass / 8 Node-localStorage baseline** (+1 known
stream-manager parallel-load flake, passes 36/36 isolated). Specs/plans:
[[../superpowers/specs/2026-06-26-my-knowledge-makeover-design]],
[[../superpowers/plans/2026-06-26-my-knowledge]]. Branch `feat/my-knowledge`
kept until Chris pushes. **Next:** Chris device-verifies, then the **chat**
(densest surface — comes last) and the deferred chat/persona-editor knowledge
sub-surfaces.

**Earlier (2026-06-25) — MY INTEGRATIONS REBUILT IN THE DESIGN
LANGUAGE, SQUASHED TO MASTER (`c10f4785`). NOT pushed (Chris pushes);
awaiting Chris's device-verify.**
The fifth makeover surface. `/app/integrations` (MCP servers) goes from the
pre-makeover `EditorSticky`+`AccordionCard` list + bottom-sheet `McpServerSheet`
overlay to the makeover **list → detail page tree**, mirroring AI Providers. The
MCP logic (probe, local-network `allowDirect` routing, key-sealing, tool
curation) is **ported verbatim**; only chrome + the add/edit/delete IA change.
**List** (`PageScaffold`): egress note kept 1:1, **pure-navigation rows** with a
read-only **`Default: On/Off`** badge (the per-row inline toggle moved into the
detail page — Chris's call for a quieter list), empty state, `+ Add` → `/new`.
**Detail** (`IntegrationServerPage`, `/new` + `/:serverId`): an **outer shell**
loads the row + guards the unknown-id case, an **inner form** seeds its fields
from the loaded row — a deliberate split that **closes the My-Account async-seed
blank-form class**. Explicit **Test + Save** (the makeover's sealed-key/probe
exception), delete via `ConfirmDialog`, calm unknown-`serverId` notice. **New
shared opt-in dirty-guard** on `PageScaffold`/`PageBar` (passive **`● Unsaved`**
badge + **discard-confirm** when leaving via back/crumbs with unsaved changes),
**adopted here and retrofitted to the AI Providers detail page**;
backward-compatible (every page without `dirty` is byte-identical). Authored the
`integrations` `?`-help; retired `McpServerSheet` + `McpServersSection`. **No
Dexie/schema change.** Built spec→plan→**subagent-driven** (6 tasks, per-task
spec+quality review). **Laura** spec-pass **and** pre-squash: **no hard
defects** (SOFT-1 named-badge-axis + SOFT-4 authored-help folded; **SOFT-3
promoted to the dirty-guard feature**; SOFT-2 deferred w/ Chris sign-off). Two
pre-squash softs are **Chris-arbitrated copy calls** still open: the generic
discard-body wording (correct for shared chrome) + the add-crumb "Add server"
vs the "Add MCP server" button label. **opus** whole-branch review:
**merge-ready** (4 advisory Minors, all intentional/pre-existing — incl. a
cosmetic double-`useHelp` in the detail outer/inner). Not a Larissa path
(client-only; crypto consumed via verbatim port, no `packages/crypto` change).
Gates: `pnpm typecheck --force` **14/14** (0 cached) on master post-squash; full
user-client vitest **2022 pass / 8 Node-localStorage baseline**; production
build clean. Specs/plans:
[[../superpowers/specs/2026-06-25-my-integrations-makeover-design]],
[[../superpowers/plans/2026-06-25-my-integrations]]. Branch
`feat/my-integrations` kept until Chris pushes. **Next:** Chris device-verifies,
then the next makeover sub-pages (the chat is the densest surface — comes last).

**Earlier (2026-06-25) — MCP LOCAL-NETWORK ROUTING SQUASHED TO MASTER
(`5441b95f`). NOT pushed (Chris pushes); awaiting Chris's device-verify.**
A per-server, opt-in **"Local network (must support CORS)"** toggle (off by
default) lets the client connect to a self-hosted LAN MCP server **directly**
instead of via the global CORS proxy. The transport already supported `direct`
vs `proxy`; this adds the deliberate, safe-default user control. A new
`allowDirect` **intent** field on `McpServerRow` is kept separate from the
test-**outcome** `routing` field; `buildCandidates` gates the probe order on
intent (**off → proxy-only**, empty when no proxy; **on → direct-first then
proxy**). The **send-time path** (`resolve-active`/`build-mcp-context`/
`mcp-tools`/`mcp-client`) is untouched — it consumes only the resolved
`routing`, so intent never leaks past probe time (opus review verified this
separation is load-bearing: a server can't route direct unless a test under
`allowDirect=true` set it). **Dexie v30** migration backfills `allowDirect` from
`routing === 'direct'` (existing direct-resolved servers keep working); the
backfill is covered by a plant-v29-rows upgrade test. The sheet toggle **resets
the server to untested** on flip with a calm "Routing changed — re-test"
cue; a **constructive error** names both ways forward when proxy-less +
direct-off, and the list status reads **"Needs proxy or Local network"** rather
than a bare "Not tested". Built spec→plan→**subagent-driven** (3 tasks +
backfill-test, per-task spec+quality review). **Laura** pre-squash: **no hard
defects**; all **4 UX softs folded** (unified Connected-phrasing, re-test cue,
list two-paths status, plain-English CORS tooltip). Client-only (**not a Larissa
path**). Gates: `pnpm typecheck --force` **14/14** (0 cached) on master
post-squash; full user-client vitest **2007 pass / 8 Node-localStorage
baseline**. Specs/plans:
[[../superpowers/specs/2026-06-25-mcp-local-network-routing-design]],
[[../superpowers/plans/2026-06-25-mcp-local-network-routing]]. **Next:** Chris
device-verifies the toggle (LAN-direct + proxy fallback + migration), then the
next makeover sub-pages.

**Earlier (2026-06-25) — MY SETTINGS (+ PICKER COMPONENTS) SQUASHED TO
MASTER (`ad873413`), device-verified by Chris ("funktioniert SUPER!!"). NOT
pushed (Chris pushes).**
The fourth makeover surface. One squash bundling the reusable **picker family**
(built showcase-first) and the **My Settings** rebuild that consumes it.
**Picker primitives** (`components/ui/`): `PickerOverlay` (zoom-from-trigger
shell with focus-trap + dirty discard-guard), `PickerField` (generic value-
preview trigger), and three content pickers rehoused into the shell —
`MindspacePickerOverlay` (staged Save), `ModelPickerOverlay` (two-step
model→provider, no-Save auto-close, call-site-locked `vision` filter),
`WebPickerOverlay` (search/fetch + expert depth, first-class "Off"). Plus
`ModelSlotPicker` (PickerField + ModelPickerOverlay + optional clear, resolves
the friendly model name) and `InlineEditTextarea` (always-save multi-line).
**My Settings** (`/app/settings`): the old 9-card accordion + SaveBar replaced
by a `PageScaffold` **3×2 nav-matrix** — 🩷 You · AI Providers, 🔵 Web Access ·
Voice, 🟣 Images · "Ask an Expert" — over six sub-pages plus a **per-provider
page** that retires the `ProviderSheet` overlay (its seal/probe/remove logic
ported **verbatim**, byte-confirmed, with the regression tests carried over).
**Always-save** throughout (blur persists; the provider key-probe is the lone
explicit-action exception); **disabled-over-hidden** flips the old hidden Web
sections into a disabled-with-reason tile naming AI Providers. Labels are
Chris-tuned ("AI Providers" not "Upstream"; quoted **"Ask an Expert"**; "Web
Access"; "Reading/Creating images"). Picker fields show the **real current
selection** (web summary incl. both-off → "Off"; resolved model names). Removed
the now-dead `WebInterfacingSection` + `ExpertWebSection`. **No Dexie/schema
change.** Built spec→2 plans→**subagent-driven** (5 picker + 12 settings tasks,
per-task spec+quality review). The **opus whole-branch review** caught one
**Important** (the per-provider page dropped the `ProviderSheet` seal/probe
regression net → ported 4 behavioural tests pinning `probeProvider`'s proxy
args). **Laura** spec-pass (folded SOFT-1 identity-seam, SOFT-4 blur-flush,
SOFT-6 name-the-destination) **and** pre-squash pass (no hard defects; the two
folded softs — duplicate Mindspace label, constructive unknown-provider notice
— landed). Not a Larissa path (client-only; crypto consumed via verbatim port,
no `packages/crypto` change). Gates: `pnpm typecheck --force` **14/14** on
master post-squash; full user-client vitest **2000 pass / 8 Node-localStorage
baseline**; production build clean. Specs/plans:
[[../superpowers/specs/2026-06-23-picker-components-design]],
[[../superpowers/specs/2026-06-25-my-settings-design]],
[[../superpowers/plans/2026-06-23-picker-components]],
[[../superpowers/plans/2026-06-25-my-settings]]. **Deferred (design-language
pass):** picker static-vs-live Save asymmetry (SOFT-5) + Mindspace live-preview;
PageBar/`.cs-btn`/overlay a11y follow-ons (spec §15). Branch
`feat/picker-components` kept until Chris pushes. **Next:** a tiny function
(fresh context), then the next "small" sub-pages of the makeover.

**Earlier (2026-06-22) — MY ACCOUNT & PAGE BAR SQUASHED TO MASTER
(`355f9bfa`), device-verified by Chris ("großartig, alles da!"). NOT pushed
(Chris pushes).**
The second makeover surface after the Entrance Hall. Introduces the reusable
**Page Bar** (`PageBar`/`PageScaffold`): a sticky breadcrumb + `?`-help chrome
row beneath the brand bar that **never scrolls**, with the **always-save model**
replacing Save & Back (blur/Enter persists via `InlineEditRow`, `Saved ✓` live
region, a validation guard for the username). Plus two more primitives: the
**`ReadingOverlay`** (zoom-in Markdown reader — used for help, the bundled
AGPL-3.0 text, the privacy notice, and the generated third-party list; zooms from
its trigger incl. the `?` button) and a **`NavTile` `onActivate`** path for
overlay/external-link tiles. **My Account** (`/app/account`) is rebuilt as a
dashboard (inline-edit username & display-name — empty display-name shows the
username — + read-only biometrics/server/version badges) and a **2×3 nav-palette
matrix** leading to six sub-pages: **Biometric** (add/list/rename/remove +
last-one lockout), **Recovery Key** (mk-gated regenerate, typed "regenerate"
confirm), **Server linking**, **About** (matrix opening reading overlays for
Licence/Privacy/Third-party, external Source Code, **DEV-only** Developer tools),
**Change passphrase** (reskinned), and **Logout** (sign out + type-username
delete with a **gold-protected** "No" via a new `ConfirmTyped.protectCancel`).
Per-page help docs ship (the My Account one explains the sub-pages); the obsolete
`account-sections/*` accordion modules are deleted. Built spec→2 plans
(primitives + page tree)→**subagent-driven** (11 tasks, per-task spec+quality
review). The **opus whole-branch review** caught **two** cross-cutting bugs no
per-task review saw — a **display-name data-loss path** (the field rendered empty
for existing users and a blur wiped the saved name; async `useSettings` +
once-seeded `useState` — fixed with a focus-guarded re-sync + regression test)
and a **broken gold token** on the delete "No" (non-existent `--gold` →
fixed to the real `--color-gold-*` gradient). **Laura** pre-squash: **no hard
defects**; all 3 softs folded (`?` zoom-from-button, DEV-only devtools *route*,
softer recovery disabled-copy). Not a Larissa path (client-only). Gates:
`pnpm typecheck --force` **14/14** (verified on master post-squash); full
user-client vitest **1975 pass / 8 Node-localStorage baseline**; ui-shared 39.
Specs/plans: [[../superpowers/specs/2026-06-22-my-account-and-page-bar-design]],
[[../superpowers/plans/2026-06-22-my-account-page-bar-primitives]],
[[../superpowers/plans/2026-06-22-my-account-tree]]. **Deferred (non-blocking,
for the a11y/design pass):** PageBar crumb tap-target <44px + no `:focus-visible`
ring (system a11y baseline); ReadingOverlay/ConfirmDialog no focus-trap
(`ConfirmTyped` *does* trap natively — the delete flow is fine); biometrics badge
hidden-while-loading + "Configured (N)" label; biometric lockout-dialog-body
untested; About copyright test couples to live copy. **Next:** **My Settings** as
the next makeover slice (tomorrow, fresh context). Branch `feat/my-account-page-bar`
kept until Chris pushes.

**Earlier (2026-06-22) — MAIN MENU REBUILD SQUASHED TO MASTER
(`7bb552f7`), device-verified by Chris ("voll geil … das hat so schön
cineastisch, ich mag das echt"). NOT pushed.**
The first real surface of the UI/UX makeover — the Entrance Hall (`/app`) rebuilt
in the design language. (1) the **`NavTile`** navigation-plane primitive (the 8th
in `components/ui/`) — thin `data-*` component, styling in `index.css`, reuses the
canonical `--color-nav-*` tokens; icon optional. (2) the Entrance Hall in the fixed
**ascension** order (Crown → 🩷Relate → 🟢Treasure → 🔵Nourish → 🟣Root), gold
**Continue** card (with ✦ sparkle), eight Lucide-iconed room tiles, **My Projects
visible-but-disabled** ("coming after the alpha"), calm empty-metas. (3) **first-run
Setup-Hints** — two hard blockers (provider + persona; the Global Unlocker is
deliberately NOT a step), the gold Setup card takes the Crown over Continue, lists
only the missing steps as real focusable buttons. (4) the **bidirectional
Unified-Experience zoom**: a tapped tile plays the gold 2× blink (navigation delayed
`NAV_BLINK_MS=260` so it is seen; reduced-motion = instant), the destination grows
out of the tile, and **back collapses it into the same tile**. Mechanism is **central
& origin-path-based** (`NavTransitionOutlet` + `nav-transition` store + `useNavZoom`
hook): it tracks each tile's origin path, so "raus" works whether back is a PUSH
(`navigate('/app')`) or a POP, and every later destination inherits it — the **shared
topbar and the destination room screens are untouched** (scope-fenced). Built
spec→plan→**subagent-driven** (4 tasks, per-task spec+quality review). Review loop +
**opus whole-branch review** caught and fixed: a transform-origin on the wrong
element, a duplicate `--nav-*` token set, a NavTile tab-order gap, and a **CRITICAL-ish
I1** (the exit-overlay re-mounting *any* leaving screen app-wide → scoped to genuine
tile origins). **Chris device-test then found two more** (no exit-zoom on back =
PUSH-not-POP; blink never visible = navigate unmounted the tile first) — both fixed
via the origin-path rework. **Laura** pre-squash: **no hard defects**; 2 soft folded in
(Setup steps now zoom; Continue ✦), 1 soft (SetupCard hover-glow) closed as a
non-issue (the rule already suppresses it; removing would *introduce* it — Laura
mis-read the cascade). Not a Larissa path (client-only). Gates: `pnpm typecheck
--force` **14/14**; full user-client vitest **1932 pass / 8 Node-localStorage
baseline** (+ new nav-tile/outlet/store/hook/setup/entrance suites). Specs/plans:
[[../superpowers/specs/2026-06-22-main-menu-design]],
[[../superpowers/plans/2026-06-22-main-menu]]. **Next:** **My Account** as the next
makeover slice (small surface, "practising" the next step) — fresh context after
Chris's `/clear`.

**Earlier (2026-06-21) — DESIGN-LANGUAGE FOUNDATIONS SQUASHED TO MASTER
(`982ea9f5`), device-verified by Chris ("das ist wirklich schön! das wird den
Leuten gefallen"). NOT pushed.**
First slice of the **UI/UX makeover** (the big block). Establishes the reusable
foundation every later surface inherits: (1) **three colour planes** (navigation /
action / persona) + **gold = priority overlay** (1 per screen, now a load-bearing
`--color-gold` token via `color-mix`) + **red reserved** for destructive; nav palette
pink/green/blue/purple in a fixed **root→crown ascension** order. (2) the
**"Unified Experience" motion language** — origin-aware zoom (enter ~0.30s savours /
exit ~0.17s vanishes), tile-only gold blink, CSS-only with `@media
(prefers-reduced-motion)` fallback (Chris decision: CSS-media is the mechanism for
CSS-only motion; the JS `respectsReducedMotion()` helper stays for JS-driven motion).
(3) **seven primitives** in a new `apps/user-client/src/components/ui/` library:
**Button** (3 tones + gold overlay, "gold protects never invites" — destructive never
gold), **Badge** (read-only: tells), **Pill** (interactive: acts), **OverflowMenu**
(⋯; disabled items stay focusable via `aria-disabled` + announced reason — closes the
2026-06-12 a11y deferral class), **ListRow** (Leading/Body/Trailing slots), **ListScaffold**
(fixed back control + only-list-scrolls + fixed footer + empty-state contract),
**ConfirmDialog** (uniform layout A, gold-protects role-swap, origin zoom). Plus an
internal **showcase route `/app/ui-showcase`** (live successor to the prototype HTML)
and a `ui/index.ts` barrel. Built spec→plan→**subagent-driven** (11 tasks, per-task
spec+quality review; review loop caught a Critical Pill ×-as-nested-button, an Important
OverflowMenu accessible-name pollution, a count-span/test mismatch, and a `.click()`→
`fireEvent` test bug — all fixed). **Laura spec-pass** folded in (2 HARD: back-control
contract §3.4 + overflow a11y; 4 SOFT). **opus whole-branch review:** merge-ready after
2 Chris decisions (both now applied) + the fix-before-merge ButtonProps JSDoc (restored).
Not a Larissa path (client-only); no Laura pre-squash needed (the showcase is internal,
no user-reachable flow wired yet). Gates: `pnpm typecheck --force` **14/14**; Biome clean;
full user-client vitest **1914 pass / 8 Node-localStorage baseline** (+~28 new ui tests).
Specs/plans: [[../superpowers/specs/2026-06-21-design-language-foundations-design]],
[[../superpowers/plans/2026-06-21-design-language-foundations]]. **Deferred minors**
(logged in the SDD ledger; non-blocking): `.cs-btn` still needs `:hover`/`:focus-visible`
(**must land before the first real surface consumes Button** — a11y); transform-origin
untested in JSDOM (device-verify spec §11). The showcase route was moved **out of
`ProtectedRoute`** (no session needed — presentational only) so it is reachable directly
at `/app/ui-showcase` throughout the makeover. **Next:** the **main-menu rebuild** (next
plan) consumes these primitives — Chris brief-leads; before the first real surface ships,
add `.cs-btn` `:hover`/`:focus-visible` states (the one tracked a11y follow-on).

**Earlier (2026-06-21) — COMPACT-AND-CONTINUE SQUASHED TO MASTER
(`5b49125`), device-verified by Chris ("ganz wunderbar"). NOT pushed.**
Upgrades context-overflow handling from *silent message-dropping* to a
user-controlled conversation summary that keeps the last N messages verbatim —
the *dere* fix for the three long-chat pains (context fills / model dumbs down /
cost). Three trigger layers share one mechanism: a **tappable context-fill gauge
+ once-per-chat 80% toast** (manual), a **90% background safety valve**, and a
synchronous **block-and-compact failsafe** with message-preserving recovery and a
live-motion overlay. Raw messages are **never deleted** (Reading Mode stays whole;
memory extraction undisturbed); compaction only changes the *sent* context — the
six-section summary (ported 1:1 from chatsune) is injected into the
`memoryContext` slot as `<conversation_compact>` and history is sliced to the
tail. Checkpoints live in a new **Dexie v29** table; timeline markers open a
read-only briefing drawer. Built spec→plan→**subagent-driven** (12 tasks, per-task
spec+quality review). The review loop caught real bugs before device: a plan-bug in
the tail tests (corrected to chatsune semantics), a **CRITICAL** tool-loop
`usedTokens` double-count (valve would have fired at ~45%), three per-chat-lock
gaps across the trigger paths, and Laura's **HARD** (the block-compact overlay was
set in the store but rendered nowhere → fixed). **opus** whole-branch review
*merge-ready*; **Laura** pre-squash 1 HARD (fixed) + 2 SOFT deferred
([[insights/ux-deferrals]]: no "Send anyway" on block failure; marker inline-expand
kept per Chris's inline-over-hidden preference). Not a Larissa path (client-only).
Gates: `pnpm typecheck --force` **14/14**; full user-client vitest at the **8
Node-localStorage baseline** (1882 pass; + new compaction suite). Specs/plans:
[[../superpowers/specs/2026-06-21-compact-and-continue-design]],
[[../superpowers/plans/2026-06-21-compact-and-continue]]. **Next:** UI/UX makeover
(Chris has the concept ready) — see Next session. Projects feature is REMOVED from
the alpha scope (deferred to after the backend — needs Chris's project-oriented-memory
mental model + new IA). Live voice is DONE.

**Earlier (2026-06-21) — MEMORY IMPROVEMENTS SQUASHED TO MASTER (`c16be11c`).
`write_memory_entry` "Remembered" pill (with the remembered text) and the
greeting-in-system-prompt echo are DEVICE-CONFIRMED by Chris ("GENIAL" — the
combination gives RP/ERP users a "forever continuation" feeling). The other three
(thresholds firing sooner, extraction-guidance skew, Circle-LRU excluding openers)
are behaviour you only see over multiple sessions — still to confirm in use.**
Five changes from Chris's ghostwriter, built spec→plan→**subagent-driven** (6 tasks,
per-task spec+quality review; **opus** whole-branch review *merge-ready*; **Laura**
pre-squash **no hard defects**, her one pressed soft finding — the friendly
`Remembered` pill label — **built**): (1) the two pre-push TUNING follow-ups are now
**DONE** — auto-commit `15→10` / dream `20→12` thresholds, and `memoryInstructions`
now steers extraction as well as consolidation; (2) **`write_memory_entry` tool** —
a persona can actively save a durable fact mid-chat; lands **uncommitted** (normal
Memory-Page triage), exact-duplicate-guarded, offered only when `useMemory` is on,
shown in-stream as a `Remembered` pill (content in the expandable detail); (3) **My
Circle sorted by last interaction** (real send), never by last-opened — new
`PersonaRow.lastInteractionAt` via **Dexie v28** + backfill, the auto-opener never
bumps it, sort scoped to the Circle only; (4) **opener echoed into the chat system
prompt** (Band-2 `openerEcho` segment + `resolveOpenerContext`) so the model has
continuity with the greeting it spoke, while openers stay out of wire history.
Gates: `pnpm typecheck --force` **14/14**; full user-client vitest at the **8
Node-localStorage baseline** (1853 pass; +new tool/circle/opener/pill/extraction
tests). Specs/plans: [[../superpowers/specs/2026-06-21-memory-improvements-design]],
[[../superpowers/plans/2026-06-21-memory-improvements]]. **Device-verification
checklist** lives in the spec §Manual verification (thresholds fire sooner;
extraction-guidance skews; active-recall pill → pending entry → commit/delete;
memory-off offers no tool; Circle LRU excludes openers; greeting continuity).
**Next:** Chris device-verifies, then pushes the master backlog → first alpha.

**Earlier (2026-06-21) — MEMORY SHIPPED TO MASTER + DEVICE-VERIFIED ("we
have memory!"). Engine+UI+import squash `2eebfd24`; dedicated MEMORY PAGE squash
`e3a19c73`. NOT pushed.**
Chris device-verified end-to-end: a real consolidated body was produced (identity /
projects / values), and per-persona isolation confirmed (a fresh persona starts
clean). The memory **page** (`/app/persona/:id/memory`) replaced the clipped,
unstyled cockpit `MemorySheet` overlay — one functional surface reached by pure
navigation from the ◌ button (`?chat=`) and a persona-editor "Manage memory" link;
pending/committed entry triage (commit/edit/delete-with-undo) + body view/edit +
versions/restore; Learn/Consolidate gated to the chat path. Built spec→plan→
**subagent-driven** (7 tasks), opus whole-branch review *merge-ready*, **Laura
spec-pass + pre-squash both cleared** (1 HARD back-affordance fixed; 2 SOFT deferred
to the design-language pass: toast "Set aside" vs "Delete" button copy; header
"<persona> · Memory" ordering). Minimal functional CSS only — **design-language pass
deferred ~1–2 weeks, informed by real use** (Chris: this UI/UX is "exactly what we
need for this phase"). Specs/plans: [[../superpowers/specs/2026-06-21-memory-page-design]],
[[../superpowers/plans/2026-06-21-memory-page]].

**Pre-push audit (2026-06-21, ultrathink) — all four cross-checks PASSED**, two
follow-up TUNING items **(both now DONE in `c16be11c`, see Current above)**, both
authored by Chris in his ghostwriter:
1. **Lower the auto-consolidation thresholds** — `DREAM_THRESHOLD=20` committed (and
   `AUTO_COMMIT_THRESHOLD=15`) is too high for real felt behaviour; auto-dreaming
   effectively never fires in normal sessions (manual "Consolidate now" works).
   `config.ts`, marked "Tunable after device testing".
2. **Feed `persona.memoryInstructions` to EXTRACTION too** — currently the user's
   "what to remember" guidance shapes only consolidation (`buildConsolidationPrompt`),
   not extraction (`buildExtractionPrompt`, `pipeline.ts:97-101`).
   (Confirmed sound: system-prompt sent as `system` role via adapter path for both
   stages; injection capped `MEMORY_INJECTION_MAX_TOKENS=6000` + body `=3000`;
   committed **and** pending journal entries injected as `<journal>` like chatsune.)
Then: small UI tweaks Chris noted, → fast track to first alpha.

**Superseded (2026-06-20 framing) — memory was "built on branch, not merged":** that
is now done; the unified squash + the page both landed on master.
Client-side volume-triggered long-term memory — a faithful TS/Dexie port of
chatsune's `extraction → uncommitted → committed → dreaming → body` pipeline, all
run in the **background after each send** (no server cron), guarded by a per-persona
mutex, reusing the persona's **own** offering via `runOneShotCompletion` (no utility
model — [[project_conversation_model_for_user_memory]]). Whole-block prose retrieval
into `buildPrompt`'s `memoryContext` slot. **Dexie v27** (`memoryJournal` +
`memoryBody`). **UI (Plan 2):** a Cockpit memory button (always-rendered; badge =
uncommitted count; active-state when body version > `lastViewedMemoryBodyVersion` —
Laura HARD 1), a review overlay (`MemorySheet`: commit / reject-with-undo-toast /
edit; "learn now"/"consolidate now" disabled-with-reason + named-cause+Retry — Laura
HARD 2/3; one-shot first-run note), and a persona-editor Memory section (toggle,
instructions, editable body + version rollback, committed view). Background writes
refresh the UI via explicit `invalidateQueries` (no `useLiveQuery` in this project).
Built spec→plan→**subagent-driven** (Plan 1: 11 tasks; Plan 2: 8 tasks; fresh
implementer + spec/quality reviewer per task; **opus** whole-branch review per plan —
both *merge-ready, no Critical/Important*). Gates: `pnpm typecheck --force` **14/14**;
full user-client vitest **1822 pass / 8 Node-localStorage baseline**, pristine.
Deferred Minors (device-tuning: dedup/stripper precision per spec §9; cosmetic:
`getCurrentBody` index/`.at(0)`; first-run double-toast race accepted-with-comment).
**Memory is default-ON.** Engine+UI+import all landed (unified squash `2eebfd24`) and
the dedicated page followed (`e3a19c73`). Specs/plans:
[[../superpowers/specs/2026-06-20-memory-design]],
[[../superpowers/plans/2026-06-20-memory-engine]],
[[../superpowers/plans/2026-06-20-memory-ui]],
[[../superpowers/specs/2026-06-21-memory-page-design]]. **Next session (new context):**
the two tuning follow-ups above + small UI tweaks Chris noted → first alpha.

**Earlier (2026-06-18) — CHATSUNE IMPORT LANDED** (single squash
`81cf6f1` on master + follow-up fixes (see Post-landing), **NOT pushed**,
**device-confirmed by Chris**). Lets users migrate from chatsune. A persona-export importer in the
persona editor (new persona *and* merge-into-existing) maps
name/tagline/system_prompt/nsfw and converts the avatar crop, then merges chats
**additively** with **per-persona idempotency** — dedup by chatsune `original_id`
via the new non-indexed `ChatRow.importedFrom` (no Dexie bump). Chats are **Tier
A**: user/persona text + CoT reasoning only; dropped content (tool-calls, images,
attachments, artefacts, KB injections) becomes a per-message text hint. NSFW
upgrades **monotonically** (false→true only, independent of the overwrite choice).
A separate Libraries-view importer always creates a **new** library (the export
carries no stable ids) and re-embeds documents locally. **Memory import is
deferred** behind a three-anchor reminder: a `memoryCount` tripwire + `FUTURE:`
comment in the parser, a user-facing "keep this file, re-import once memory lands"
note, and the new [[insights/future-feature-couplings]] register (+ this file's
memory-gap cross-link). Reuses the chatsune export *format*, not its code
(Python/Mongo vs TS/Dexie). Built spec→plan→**subagent-driven** (13 tasks,
per-task review). **Final whole-branch review (opus):** one Important (chat-list
invalidation after import) + two Minor, all fixed. **Laura** pre-squash: **no hard
defects**; **all six soft findings folded in** (import control moved above the
Avatar sub-heading with a "Coming from Chatsune?" framing; an Apply→Save "N chats
ready — Save to bring them in" cue; avatar-failure recovery hint; "Import library
from Chatsune" label; NSFW upgrade foretold in the preview; concrete memory-note
wording). Not a Larissa path (client-only). Gates: `pnpm typecheck --force`
**14/14**; full user-client vitest at the **8 Node-localStorage baseline** (all new
lib/data/component tests green). **Dexie unchanged (v26).** Specs/plans:
[[../superpowers/specs/2026-06-18-chatsune-import-design]],
[[../superpowers/plans/2026-06-18-chatsune-import]].

**Post-landing (2026-06-18, device-confirmed) — import works; embedding-speed
saga fixed across five commits:** (1) `f63be23` count dropped **images from the
`events` timeline** (newer chatsune docs store images there, not `image_refs` —
tool-calls already worked via the legacy field); (2) `f7d70ef` + `4ec58ae`
per-document **embedding-duration log** + resolved-**backend log** (model load
moved out of the per-doc timer via a queue `prepare` hook); (3) `d6e60fc`
**per-device dtype + reject software/no-f16 WebGPU** — the device was resolving
to **SwiftShader** (CPU software renderer) running int8 (~7.3 s/chunk!); now real
WebGPU→**q4f16**, software/no-f16→WASM int8 (`fetch-model.mjs` pulls q4f16 too);
(4) `a1fdd8a` **Stufe A** — COOP `same-origin` + COEP `credentialless` in
`vite.config` dev/preview → `crossOriginIsolated` → **4-thread WASM** (~870 ms/chunk
on Chris's SwiftShader box; **~8.4× total** vs the start). **Stufe B (prod
cross-origin isolation) PARKED** — low ROI (fallback-path only; real-GPU users get
q4f16; alpha not deployed), logged in [[insights/follow-ups-index]] for the
alpha-deploy milestone. **Next session:** Chris pushes the master backlog; pick up
another roadmap topic.

**Earlier (2026-06-17) — TTS AUDIO + INNER MONOLOGUE LANDED** (single
squash `a875cf9` on master, **NOT pushed**, **device-confirmed by Chris** — "ich
bin super glücklich!"; reverb device-tuned with him to 1.6 s / 60-40 dry-wet,
280 Hz high-pass). One cohesive audio unit in three movements: (1) a user-selectable
Butterworth **high-pass cleanup** on all read-aloud (My Settings → Voice: Auto /
Off / 50 / 100 Hz; Auto follows a per-offering `defaultHighpassHz` in
`TtsOfferingMeta`, xAI=50 because it is bass-heavy), threaded via a new
filter-profile param on `AudioSink.play`. (2) the **inner-monologue easter egg** — a
manual "read this thought aloud" button on an open `ReasoningPill`, vocalised with a
deliberately *otherworldly* treatment (280 Hz high-pass + a **procedurally-synthesised**
reverb tail — decaying noise → `ConvolverNode`, no shipped asset; Chris chose the
ethereal "alternative-substrate entity" character over warm/human), in its own
isolated `AudioSink`, never auto/live-read, mutually exclusive with read-aloud (both
directions), disabled-with-remedy-tooltip when unavailable/streaming/live. (3)
**voice-UI integration** so it stops feeling like a foreign body — `AudioSink.isAudible`
drives the spectrum's "computing" wave whenever playback is active-but-not-yet-sounding
(also fixes read-aloud's flat initial-synthesis field), and `chat-page` composes an
*effective source* feeding the single spectrum + single toolbar from whichever
playback is active; `VoiceTransport` gains a reduced `mode='monologue'` (no Skip,
"thinking aloud…" note, "Stop" not "Exit"). Built spec→plan→**subagent-driven**
implementation (per-task review + final whole-branch audit). **Laura** spec-passes on
both specs (no hard defects; SOFT findings folded — "Stop" label, plain-language
filter labels, calm retirement, "thinking aloud…" copy). **opus** whole-branch
reviews found + fixed: an `AudioSink` chain-disconnect leak, the symmetric
mutual-exclusion guard, a `SpectrumAnalyser` rAF-restart regression (isAudible now
read via a stable ref), and a self-reverting monologue Pause during synthesis. Not a
Larissa path (client-only). Gates: `pnpm typecheck --force` **14/14**; new
pure-function + RTL tests green (`voice-filter`, `monologue-text`, `monologue-reverb`,
`voice-transport`, llm-unified registry); full user-client vitest at the **8
Node-localStorage baseline** (1725 pass). **Dexie v26** for the new setting.
Specs/plans: [[../superpowers/specs/2026-06-17-tts-highpass-and-inner-monologue-design]],
[[../superpowers/specs/2026-06-17-monologue-voice-ui-integration-design]] (+ matching
plans). **Next:** Chris pushes the master backlog on his word; deferred per-spec —
optional shimmer/detune on the monologue, a presence/voice-band boost (needs field
data).

## Changelog — by block

Progressive discovery: open a chapter only when digging into that area's history. Full index: [[insights/changelog/README]].

- **[[insights/changelog/early-phases|Early phases (Phase 1–4)]]** — late-May standalone-mode foundation: backbone, settings, persona editor, chat backbone, CoT display, polish iterations.
- **[[insights/changelog/block-1-chat-core|Block 1 · Chat core]]** — branching, bookmarks, rich rendering, credential bus, system-prompt builder, model-picker, persona settings, model instructions, chat polish.
- **[[insights/changelog/block-1-curation|Block 1 · Curation]]** — provider/model onboardings (chutes, wafer, novita, GLM, DeepSeek, Kimi, Grok, Claude/Fable) + the `/curate` skill & catalogue tooling.
- **[[insights/changelog/block-2-tools-artefacts|Block 2 · Tools & artefacts]]** — artefacts, lightbox, tool-execution spine, web interfacing, MCP client, `ask_expert`, substitute-vision.
- **[[insights/changelog/block-4-voice-tti|Block 4 · Voice & TTI]]** — TTS, live voice, audio toolbar, spectrum, read-aloud, dictation/STT, voice-expression language, roleplay, TTI image generation.
- **[[insights/changelog/block-5-knowledge-base|Block 5 · Knowledge base]]** — knowledgebase chunks A/B/C, lorebooks, embeddings engine & int4 codec.
- **[[insights/changelog/process-and-tooling|Process & tooling]]** — Laura UX auditor, subagent improvements, roadmap lock, status-tracking split, early design specs & wireframes.

## Scope

### In scope here

- Local chat experience (UI, message rendering, session shape)
- LLM provider integration as far as the client owns it (model
  selection, prompt routing, per-provider auth)
- Local storage of chat sessions / conversation context
- User-facing UX patterns (pill handling, expressive feedback,
  organic variation, omakase defaults)
- Data model for future tool support (stored only, no execution)
- Neurodivergent-accessibility behaviour and review surfaces

### Deliberately out of scope (deferred)

- Tools execution (data model lives here; no execution surface)
- Knowledge bases / libraries
- Integrations (homelab, sidecar)
- Voice (Block 4 — Chris's expressive-voice concept lands later)
- Cloud sync ([[STATUS-BACKEND]] territory)

---

## Briefed, awaiting implementation

- **Phase 5 — Bookmarks tab + Setup-Hints** (gated on Lyra's wireframe
  + invited-alpha-tester feedback). The simple-history surface now
  covers list/search/rename/delete; Bookmarks is the second tab; Setup-
  Hints needs separate design once we see how invited testers actually
  encounter the empty provider/persona state.
- **Date-group headers in My History** (`Today / Yesterday / Earlier`)
  — prototyped during simple-history Task 13 and dropped per LOC budget.
  Phase 5 candidate when we have more room.

## Open design questions / blockers

- Lyra's wireframe for My History — still in flight; Settings,
  Circle, Persona-Editor have landed (2026-05-23 update of
  `chatsundere-prototype.html`).
- Final 7-Mindspace palette + 2–3 finalised textures — Lyra-led.
- Provider endpoint exact base-URLs and probe paths (nano-gpt, Novita,
  Ollama Cloud) — verified live during Phase 1 implementation.
- "Wider encryption-at-rest" (messages, personas, settings) — Chris
  flagged this is a bigger-group conversation, not a Block 1 decision.
- ADR "Tool Display Position" — drafted during Phase 3 implementation.

---

## Doing now

*(between sessions — curation phase)*

Phase 4 alpha-prep landed across 15 sequential commits on master
(`76c333e → 9eb83b4`) plus follow-ups `88b7067` / `7536037`, and is
**pushed to `origin/master` unsquashed**. The originally-planned
squash + `v0.0.1` tag + Pages-source flip was **never executed** —
work continued straight into provider/model curation instead. Decided
with Chris on 2026-05-31: the squash is **abandoned** (the commits are
pushed and buried under 60+ later commits; a rewrite has no value), and
the **alpha release ceremony (v0.0.1 tag + Pages flip + alpha deploy at
`teaser.chatsundere.me/alpha/`) is deferred into the forthcoming
4-week roadmap** (alpha-tester invitations live there). The alpha is
therefore **not yet deployed**.

Since alpha-prep, the active work has been **curation**: 6 providers
onboarded/curated (chutes, nano-gpt, novita, wafer, tensorix, …) with
the conversation-suite as the verification harness. Latest: Tensorix
(5 EU-sovereign ZDR offerings) — see the Last-updated header above.

**Retry observability — done** (commit `7402231`, 2026-05-31). Added a
sink-agnostic `onRetry` hook + pure `formatRetryEvent` to
`packages/llm-unified/src/retry.ts` (stays dependency-free) and a new
`withStreamingRetry` helper that consolidates the two hand-rolled
streaming loops. Structured `console` sinks wired at all three
call-sites (stream-completion, one-shot/title-gen, suite binding) —
transient 5xx/429s are no longer invisible at the retry layer.
**Bonus:** the refactor killed a latent `ERR_BODY_ALREADY_USED` bug that
existed in stream-completion AND one-shot (Request built once then
reused on retry; both retry paths were silently broken — masked by tests
whose mocks never read the body; binding was the only site fixed, in
`3c0642d`). one-shot also gained a 30s overall timeout. Subagent-driven
TDD across 8 tasks, each spec+quality-reviewed; 192 tests green,
typecheck clean. prom-client metrics half deferred to the Phase-2 proxy
([[insights/follow-ups-index]]). Per [[insights/2026-05-31-retry-helper-brief]]
+ spec `superpowers/specs/2026-05-31-retry-observability-design.md`.

Next: **roadmap discussion** with Chris (clear 4-week picture in hand:
ship a chat client people already enjoy — not every feature, but
something that delights and doesn't annoy).

---

## Next session

**⏰ FIRST THING — REMIND CHRIS (his explicit request): TEST the native transfer
(import/export) end-to-end. "Großes Testen".** The feature is now rebased onto
master on top of the deployed **v0.1.2** line, NOT pushed yet — Chris's push also
brings `origin/master` up to the deploy tags (the branch ref had lagged 17
commits behind `v0.1.2`). Run the device checklist (Current entry / spec §9):
export Fable (images off) → import on a fresh client → history + reasoning +
**memory + avatar present, pills/tool-calls survive**, model prompts, post-import
note (import now lands in the persona **hub**); re-import → explanatory collision
warning → "Create anyway" makes a second Fable; library export → import **adopts
instantly, no embedding spinner**. The **emoji-shower** + **context-pre-seeding**
specs/plans also rebased onto master (implementation still pending).

**→ UI/UX makeover — essentially complete.** All surfaces have landed on master
via the design-language pass and the deployed v0.1.x line: design language,
**main menu**, **My Account**, **My Settings (+ pickers)**, **My Integrations**,
**My Knowledge**, **My Treasury**, **My History**, **My Circle + the persona
editor** (now a `hub` + per-NavTile sub-pages, `c9a12506`), and the **chat
usability pass** (cockpit pages + topbar rebuild, `v0.1.2`). **Remaining makeover
work:** the deferred sub-surfaces (chat `DocumentPicker`, persona-editor
`KnowledgeSection`, the attach-picker Quick-Sheet) — fold each in with its parent.

**Pending makeover-wide follow-ons** (fold in when a relevant surface is
touched): the **design-language pass** deferrals — picker static-vs-live-Save
row-affordance grammar (SOFT-5) + Mindspace live-preview; PageBar crumb
tap-target <44px + `:focus-visible` rings; a shared focus-trap adoption for
ReadingOverlay/ConfirmDialog (the picker focus-trap is the extractable helper);
the `.cs-btn` `:hover`/`:focus-visible` a11y states; a **tap-target sweep** —
bump the shared `.cs-overflow-trigger` (`⋯`) from 32px to a 40–44px hit area and
space adjacent small glyph targets (e.g. the bookmark star + `⋯`) — flagged by
Laura at the My History pre-squash as a cross-surface call. **Cleanup unblocked:** the
old web-select-codec consolidation is now moot (the duplicating sections were
removed). **Start fresh after Chris's `/clear`.**

*Out of alpha scope:* **Projects feature REMOVED** (deferred to after the backend
— needs Chris's project-oriented-memory mental model + new IA; it is a navigation
primitive that would be built on the about-to-change IA). **Live voice: DONE.**

**Older pre-roadmap items (likely stale — verify before acting):**

1. **Retry observability** — the only concrete pre-roadmap
   implementation item. Wire an `onRetry`/logging seam into
   `packages/llm-unified/src/retry.ts` and its three call-sites
   (`stream-completion`, `one-shot-completion`, suite `binding`) so
   transient 5xx/429s stop failing silently (today's Tensorix
   timeouts were invisible at the retry layer). Logging half is doable
   immediately; metrics half + loop consolidation hang on the
   client-sink design question. Full brief:
   [[insights/2026-05-31-retry-helper-brief]].
2. **Roadmap discussion** — Chris has a clear 4-week picture: ship a
   chat client people already enjoy (not every feature, but something
   that delights and doesn't annoy). Sequence the items below against
   that goal.

**Deferred into the 4-week roadmap (was the abandoned alpha ceremony):**

- **Alpha release** — `v0.0.1` tag, one-time Pages-source flip
  ("Deploy from a branch" → "GitHub Actions" at
  `github.com/symphonic-navigator/chatsundere/settings/pages`), verify
  the deploy at `teaser.chatsundere.me/alpha/`, then invite the first
  testers ("ausgewählt, technisch sehr affine User" who don't need
  Setup-Hints). Re-sequence as a roadmap milestone.
- **Manual smoke of alpha-prep** — spec §7 items 1-10 on a real
  device (retry under transient 5xx, retry-on-abort cleanup, affordance
  breathing + scroll-to-end + pin glow, per-card streaming orb,
  reduced-motion respect). Fold into the alpha milestone.
- **Phase 5 (Bookmarks + Setup-Hints)** — gated on Lyra's wireframe +
  first-tester feedback. Date-group headers (dropped in Task 13) revisit
  here.

**Known follow-ups (non-blocking):**

- Cockpit-draft localStorage tests (8 failures) — pre-existing jsdom
  cascade; investigate test-env setup separately.
- Migrate four sibling `filter(b => b.type === 'text').map+join`
  duplicates in `chat-page.tsx`, `data/send-message.ts`,
  `state/stream-manager.store.ts` to call `flattenAnswerText` from
  `lib/content-blocks.ts` so the helper is the single source of
  truth across the codebase.
- Port the dormant `extras.thinking` reference in
  `packages/llm-unified/src/one-shot-completion.ts` to consume the
  new `ReasoningIntent` shape via `applyReasoningToBody` — currently
  dead via the only caller (title-generator), but a divergence from
  `stream-completion.ts` that future one-shot callers would trip
  over.
- Stream-manager-store test-env setTimeout leak (deletes handles
  200 ms after a successful stream test ends, sometimes wiping a
  handle that a later test created with the same chat-id) — fix
  with `vi.useFakeTimers()` or a teardown-aware delete.
- `MINDSPACE_FALLBACK` in `ChatStream.tsx` is currently
  `{} as ResolvedMindspace` — load-bearing because `ReasoningPill`
  currently `void`s the prop. Will NPE if a future consumer reads
  `mindspace.accent` etc. without the store populated first.
- ~~Port chatsune's `_retry.py` to a TS retry helper for
  `stream-completion`~~ **Done** — `packages/llm-unified/src/retry.ts`
  is the full port (low-level `shouldRetryStatus`/`computeRetryDelay`/
  `parseRetryAfter` + high-level `withRetry<T>`), wired into
  `stream-completion`, `one-shot-completion` (background path, e.g.
  title-gen), and the suite `binding`. **What remains** (not the port):
  make retries *observable* (the helper logs/counts nothing — chatsune's
  did; CLAUDE.md §6), consolidate the two inline loops, and lock the
  "background calls go through `withRetry`/`runOneShotCompletion`, never
  bare `fetch`" convention so memory-extraction etc. inherit it. Brief:
  [[insights/2026-05-31-retry-helper-brief]].

---

## Pointers

- Full shipped history (per-block changelog): [[insights/changelog/README]]
- Server-coupled work: [[STATUS-BACKEND]]
- Block 1 design spec: [`superpowers/specs/2026-05-23-client-block-1-design.md`](../superpowers/specs/2026-05-23-client-block-1-design.md)
- UX concept (Chris + Lyra): [`UX-CONCEPT.md`](../UX-CONCEPT.md)
- Visual ground truth (interactive wireframe): [`chatsundere-prototype.html`](../chatsundere-prototype.html)
- All open todos: [[insights/follow-ups-index]]
- Decisions: `decisions/0001–0028` (plus Block-1 Decisions 17–28 in
  the Block-1 design spec linked above — these are the Phase-2
  brainstorm decisions; promoted ADRs may follow)
- Design briefs: `briefs/phase 0/`
- Session journal: `insights/YYYY-MM-DD-*.md`
- Recent commits: `git log --oneline -20`
