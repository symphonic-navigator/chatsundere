# Model Curation Record — DeepSeek V4 Pro

> Curation record. Sibling of [[deepseek-v4-flash]] (same family, same mechanics);
> see [[deepseek-v3.2]] for the chutes-only V3.2.

- **Identity:** DeepSeek V4 Pro · family `deepseek`
- **T/R/V:** tools ✅ · reasoning ✅ · vision ❌ (text-only)
- **replayReasoning:** false (soft-CoT — never replays its own thinking)
- **🕊️ Freedom:** free — `freedomOriented: true` (Chris, 2026-05-30: DeepSeek
  open-weight) and all three deployments below are `freedomOrientedDeployment: true`.

Curated on nano-gpt and novita with hand-written catalogue adapters
(`confidence: 'verified'`). Not offered on chutes (chutes carries V3.2, not V4).

## Offering — nano-gpt

- **slug:** `deepseek/deepseek-v4-pro` · **adapterId:** `nano-gpt:deepseek/deepseek-v4-pro`
- **context:** recommended/max 200 000
- **reasoning control:** model-slug swap (`steps`, `offStep: 'off'`). Bare slug is
  cleanly off (probed); `:thinking` reasons + honours `reasoning_effort`. Thinking
  on the `reasoning` delta channel. Shares `nanoGptSlugSwapAdapter`.
- **tool calls:** single block, concurrent with reasoning. 🔒 no TEE / no ZDR.
- A `TEE/deepseek-v4-pro` (+ `:thinking`) deployment also exists on nano-gpt; not
  curated here (separate offering).

## Offering — novita

- **slug:** `deepseek/deepseek-v4-pro` · **adapterId:** `novita:deepseek/deepseek-v4-pro`
- **context:** recommended/max 200 000
- **reasoning control:** top-level `enable_thinking` boolean (`toggle`, defaultOn).
  `enable_thinking: false` disables cleanly (probed). Thinking on `reasoning_content`.
  Shares `novitaThinkingAdapter`. 🔒 no TEE / no ZDR.

## Offering — wafer

- **slug:** `deepseek-v4-pro` · **adapterId:** `wafer:deepseek-v4-pro`
- **context:** **recommended 200 000 · max 1 000 000** (they differ — wafer exposes
  a 1 M ceiling; recommended stays at our DeepSeek-V4 sweet-spot of 200k per Chris,
  2026-05-31).
- **reasoning control:** **`toggle`** (defaultOn). Off = `reasoning_effort: 'none'`
  — clean (3/3 silent in live probes, incl. with tools); `medium` reasons. Effort
  does not modulate → toggle. `reasoning_content` channel. (wafer reports
  `reasoning_tokens: 0` even when a trace is present.) Shares `waferAdapter`.
- **tool calls:** streaming, concurrent with reasoning.
- 🔒 **Privacy:** **none** — non-ZDR serverless deployment, no TEE. Serverless,
  **not** China-routed (Chris, 2026-05-31). 🕊️ free (model + deployment). See
  [[../providers/wafer]].

## Offering — tensorix

- **slug:** `deepseek/deepseek-v4-pro` · **adapterId:** `tensorix:deepseek/deepseek-v4-pro`
- **context:** recommended/max 163 840 (tensorix input window; contrast wafer's
  1 M ceiling / 200k recommended)
- **reasoning control:** **`toggle`** (defaultOn). Off = `reasoning_effort: 'none'`
  — genuine off (off-leak probe 0/6 with unique prompts); `medium` reasons (4/4
  unique). Effort does not modulate → toggle. **DeepSeek emits the same text on
  both `reasoning` and `reasoning_content`; the adapter prefers `reasoning_content`
  so the trace is not double-counted.** (Tensorix response-caches identical
  prompts, so a repeated suite prompt can read trace-free — a cache artefact, not
  the model; see [[../providers/tensorix]].)
- **tool calls:** streaming, concurrent with reasoning.
- **usage:** OpenAI-standard — `reasoning_tokens` under `completion_tokens_details`.
- 🔒 **Privacy:** **ZDR** (zero data retention, EU-sovereign, always-on per
  policy). No TEE — the privacy upgrade over the non-ZDR wafer offering. See
  [[../providers/tensorix]].
- 🕊️ **Freedom:** free (model + deployment).
- **Validation (2026-05-31, conversation-suite):** core green (reasoning off + on,
  tool fires + valid JSON, memory, usage); text-only, no vision. Rare reasoning
  flukes under rapid back-to-back load resolved on repeat (40/40 isolated).

## Validation (2026-05-30, conversation-suite)

nano-gpt 44/44, novita 22/22 — all green across every reasoning permutation
(no HTTP/stream error, `generate_image` fired with valid JSON, usage normalised,
reasoning present/absent on the correct channel, memory carried). The documented
DeepSeek V4 Flash tool-reluctance did not appear here.

**wafer (2026-05-31):** core green (reasoning off + on, tool fires, memory, usage);
text-only, no vision scenario.
