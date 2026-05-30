# Model Curation Record — DeepSeek V4 Flash

> Curation record. Sibling of [[deepseek-v4-pro]] (same family, same mechanics).

- **Identity:** DeepSeek V4 Flash · family `deepseek`
- **T/R/V:** tools ✅ · reasoning ✅ · vision ❌ (text-only)
- **replayReasoning:** false (soft-CoT — never replays its own thinking)
- **🕊️ Freedom:** free — `freedomOriented: true` (Chris, 2026-05-30: DeepSeek
  open-weight) and both deployments below are `freedomOrientedDeployment: true`.

Curated on nano-gpt and novita with hand-written catalogue adapters
(`confidence: 'verified'`). The faster, lighter sibling of [[deepseek-v4-pro]].

## Offering — nano-gpt

- **slug:** `deepseek/deepseek-v4-flash` · **adapterId:** `nano-gpt:deepseek/deepseek-v4-flash`
- **context:** recommended/max 200 000
- **reasoning control:** model-slug swap (`steps`, `offStep: 'off'`). Bare slug
  cleanly off; `:thinking` reasons + honours `reasoning_effort` on the `reasoning`
  channel. Shares `nanoGptSlugSwapAdapter`. 🔒 no TEE / no ZDR.

## Offering — novita

- **slug:** `deepseek/deepseek-v4-flash` · **adapterId:** `novita:deepseek/deepseek-v4-flash`
- **context:** recommended/max 200 000
- **reasoning control:** `enable_thinking` boolean (`toggle`, defaultOn); off via
  `enable_thinking: false` (probed). `reasoning_content` channel. Shares
  `novitaThinkingAdapter`. 🔒 no TEE / no ZDR.

## Validation (2026-05-30, conversation-suite)

nano-gpt 44/44, novita 22/22 — all green across every reasoning permutation.
**Tool-reluctance watch:** the chatsune-era note flagged V4 Flash producing an
image *prompt* without firing `generate_image`. It did **not** reproduce here —
`tool-call-fired:generate_image` was green on both providers with the core
scenario's prompt. Empirical truth over the documented gotcha; no mitigation
needed at present.
