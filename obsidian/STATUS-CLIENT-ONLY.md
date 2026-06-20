# Chatsundere Status — Client-only

> **Roadmap to beta (2026-05-31):** [[ROADMAP]] / [ADR 0031](decisions/0031-eight-block-roadmap-to-beta.md). Client-only work is **Blocks 1–5 → v0.1.0/v0.2.0**. Block 1 (chat core) ~80% shipped; **memory** (chatsune port) is now **in flight** — the **engine (Plan 1) is built + reviewed on branch `feature/memory-engine`, NOT merged**; Plan 2 (UI) + Plan 3 (chatsune-memory import) build on the same branch before a single unified squash to master. The memory→importer coupling ([[insights/future-feature-couplings]]) is closed by Plan 3.
>
> **Artefact system (Block 2):** Kern + Treasury + attachments + Save-as-artefact shipped. Decision log & remaining chunks: [[ARTEFACTS-FEATURE-STATUS]] — read before touching artefact work.

This file is the lean orientation surface — *read first, update last* (CLAUDE.md §16). The **full shipped history lives in the [[insights/changelog/README|changelog]]**, one chapter per roadmap block. Only the two most recent landings stay here under **Current**; at end-of-session the previous Current entry migrates into its block chapter, so this file never re-bloats.

## Current

**Last updated:** 2026-06-20 — **MEMORY ENGINE + UI (Plans 1 & 2 of 3) BUILT +
REVIEWED on branch `feature/memory-engine`, NOT merged, NOT device-verified yet.**
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
**Memory is default-ON.** Remaining before the **single unified squash to master**
(engine+UI+import = one feature unit): **Plan 3 (chatsune-memory import** — extend
`persona-parse.ts` + `importChatsuneMemory`, closes [[insights/future-feature-couplings]]),
then a **Laura pre-squash pass** on the built flow, then squash. Specs/plans:
[[../superpowers/specs/2026-06-20-memory-design]],
[[../superpowers/plans/2026-06-20-memory-engine]],
[[../superpowers/plans/2026-06-20-memory-ui]] (Plan 3 TBW). **Next:** Chris
device-verifies the UI (spec §9 + Plan-2 manual verification); then Plan 3 → Laura →
unified squash. Branch + ledger (`.git/sdd/progress.md`) carry the per-task state.

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
