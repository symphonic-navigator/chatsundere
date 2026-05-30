# Model Curation Record — DeepSeek V4 Pro

> Curation record. Sibling of [[deepseek-v4-flash]] (same family, same mechanics);
> see [[deepseek-v3.2]] for the chutes-only V3.2.

- **Identity:** DeepSeek V4 Pro · family `deepseek`
- **T/R/V:** tools ✅ · reasoning ✅ · vision ❌ (text-only)
- **replayReasoning:** false (soft-CoT — never replays its own thinking)
- **🕊️ Freedom:** free — `freedomOriented: true` (Chris, 2026-05-30: DeepSeek
  open-weight) and both deployments below are `freedomOrientedDeployment: true`.

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

## Validation (2026-05-30, conversation-suite)

nano-gpt 44/44, novita 22/22 — all green across every reasoning permutation
(no HTTP/stream error, `generate_image` fired with valid JSON, usage normalised,
reasoning present/absent on the correct channel, memory carried). The documented
DeepSeek V4 Flash tool-reluctance did not appear here.
