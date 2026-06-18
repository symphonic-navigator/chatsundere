# Chatsundere Status — Client-only

> **Roadmap to beta (2026-05-31):** [[ROADMAP]] / [ADR 0031](decisions/0031-eight-block-roadmap-to-beta.md). Client-only work is **Blocks 1–5 → v0.1.0/v0.2.0**. Block 1 (chat core) ~80% shipped; **memory** (chatsune port) is the notable gap.
>
> **Artefact system (Block 2):** Kern + Treasury + attachments + Save-as-artefact shipped. Decision log & remaining chunks: [[ARTEFACTS-FEATURE-STATUS]] — read before touching artefact work.

This file is the lean orientation surface — *read first, update last* (CLAUDE.md §16). The **full shipped history lives in the [[insights/changelog/README|changelog]]**, one chapter per roadmap block. Only the two most recent landings stay here under **Current**; at end-of-session the previous Current entry migrates into its block chapter, so this file never re-bloats.

## Current

**Last updated:** 2026-06-17 — **TTS AUDIO + INNER MONOLOGUE LANDED** (single
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

**Earlier (2026-06-17) — LIVE VOICE LANDED** (squashed on master, **NOT
pushed**, **device-confirmed by Chris** — "funktioniert! ganz wunderbar!", after
extended testing). Spec 3 realised: continuous-VAD turn-taking voice mode built on
the audio-toolbar slot frame, no infrastructure rebuild. The `liveVoiceMachine`
floor chart (`idle → listening → userSpeaking → transcribing → personaThinking →
personaSpeaking`, plus `held`/`sttFailed`) owns the mic lifecycle and the floor;
`useLiveVoice` wires capture/STT/playback; `LiveVoiceBar` is the big-button
surface. **This session's work on top of the built base:** (1) **fixed the
stale-read bug** — the persona floor is now driven by the *streaming* reply (the
auto-read driver, unlocked for live voice via `forceStreamingRead`), so
`personaThinking` awaits the first audio and `personaSpeaking` reads it as it
streams; previously it read the *previous* turn's reply on re-entry. Barge during
thinking now aborts the in-flight generation (`abortPreserve`), Exit lets it
finish (spec §4). (2) **transcribing indicator** → three animated rising dots (was
a text label). (3) **spectrum wave during the thinking pause** — the synthetic
`waiting` wave now also covers `personaThinking` (transport idle), so the
generation gap reads as presence. (4) **toolbar layout-stability** — the two left
slots (Hold/Resume + Skip) always render, `disabled`-not-hidden (§11), so the bar
no longer jumps on `transcribing`. **Laura: no hard defects** (pre-squash pass);
four soft notes surfaced to Chris (Skip-while-held §4 divergence, thinking/speaking
visual sameness → design-language, pinned-auto-Hold cause unstated, speech-pause→
transcribing grace to verify on device). Not a Larissa path (client-only). Gates:
`pnpm typecheck --force` **14/14**; live-voice-machine **22/22** + LiveVoiceBar
**7/7**; full user-client vitest baseline unchanged (8 Node-localStorage). Also
this session: **GLM 5.2 curation** merged from its worktree (two preserved commits,
`packages/llm-unified` only, no Dexie; llm-unified **380 pass**), and two dev
cleanups (ui-shared resolved from source in Vite to stop the `dist/index.js`
load-error during builds; mindspace `animation`-shorthand React warning fixed).
Spec/plan: [[../superpowers/specs/2026-06-14-live-voice-design]],
[[../superpowers/plans/2026-06-14-live-voice]]. **Next:** Chris pushes the master
backlog on his word; live-voice soft-note decisions (esp. Skip-while-held) pending.

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
