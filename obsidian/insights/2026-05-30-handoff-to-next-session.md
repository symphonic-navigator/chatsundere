# Handoff — to the next Liz (refreshed 2026-05-30, after Slice 2 shipped)

Hello, me. Slice 2 is **done and pushed**; Chris opened fresh context to start a
longer, mostly-automated task: **integrating the existing models** via `/curate`.
Read `STATUS-CLIENT-ONLY.md` for the full state — this is the warm start.

## Where we are (one breath)
The client is **canonical-first** end to end: pick a model → pick an offering
(top-ranked configured one pre-selected), `ReasoningControl` cockpit, offerings
on every provider, `KnownModel`/`ReasoningCapability` gone. Four squash-merged
commits on `master`, **pushed** (`ee61863`): Slice 2 migration, Chutes-in-settings
fix, chutes reasoning-off fix + suite reasoning assertions, vite alias. Chris
**device-verified** it (picker, chutes-TEE pre-select, reasoning off/low/high).
The `/curate` Mode 3 flow proved itself today: a real bug (chutes "off" still
thinking) was live-probed, fixed, and re-verified end to end.

## The next task — "integrate the existing models"
The catalogue today has **chutes** offerings (4, `confidence: 'verified'`,
catalogue adapters) and **nano-gpt / novita / ollama-cloud** offerings (6 each,
`confidence: 'heuristic'`, **generic** adapter path) that were authored
mechanically from the old `knownModels` and are **not live-curated**. The task is
to curate them for real via `/curate` — likely **Mode 4 (batch-check)** across the
model×provider matrix, then Mode 2/3 per model: confirm tool-calls fire, reasoning
on/off behaves, usage normalises, set the freedom/trust judgements (the **human**
owns those), write/refresh Curation Records, lift `heuristic` → `verified`.

This is a longer automated run — **workflows / subagent fan-out fit well** (Mode 4
is designed for it). Confirm scope with Chris first; he co-leads inference.

## Gotchas that will bite you
- **Reasoning-off is per-provider.** chutes needed `reasoning_effort: 'none'`
  (omit ≠ off — see [[../models/glm-5.1]]). The three generic providers route
  reasoning through `applyReasoningToBody` (nano-gpt slug-swap, novita flag,
  ollama `think`) — verify off **actually disables** for each, live. The suite now
  has `permutationsForReasoning(control)` (off→`assertReasoningAbsent`,
  effort→`assertReasoningPresent`) to drive exactly this.
- **Confirm reasoning-off for the other chutes models** too (DeepSeek V3.2, Kimi,
  Gemma) — the `'none'` fix is adapter-level so it should generalise, but only GLM
  5.1 was probed.
- **Run both** `bun test ./src/` and `bun test ./curation/`, and **`pnpm
  typecheck`** is the CI gate (build excludes tests) — see [[feedback_typecheck_is_the_ci_gate]].
- **Keys** live at `keys/.{provider}-test-key`; live verification is **local-only,
  never CI**.
- **Vite alias now serves llm-unified from source** — adapter/catalogue changes are
  live in `pnpm dev` without a rebuild (this caused a confusing stale-adapter
  moment today before the alias landed).
- **Subagents can land in detached HEAD** and orphan commits — verify each commit
  is on the branch. See [[feedback_subagent_detached_head_hazard]].
- **8 pre-existing user-client vitest failures** (`localStorage` jsdom harness in
  cockpit-draft/chat-page/chat-route) are NOT yours — don't chase them.
- Untracked spike leftovers (`models/glm-5.1.yaml`, `packages/llm-unified/fixtures/
  deepseek-v4-pro.fixtures.json`) — orphaned, harmless, optional cleanup.

## Tone
Chris is thrilled and in great flow — today's work genuinely delighted him. NGO,
no delivery pressure, quality over speed. He co-leads inference/client and defers
to you on backend/crypto/adapters; he likes the forking decisions one at a time
and values short reasoning over bare approval. Chat in German; everything in the
repo is British English.

Go well. — Liz
