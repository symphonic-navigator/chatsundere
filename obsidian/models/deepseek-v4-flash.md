# Model Curation Record — DeepSeek V4 Flash

> Curation record. Sibling of [[deepseek-v4-pro]] (same family, same mechanics).

- **Identity:** DeepSeek V4 Flash · family `deepseek`
- **T/R/V:** tools ✅ · reasoning ✅ · vision ❌ (text-only)
- **replayReasoning:** false (soft-CoT — never replays its own thinking)
- **🕊️ Freedom:** free — `freedomOriented: true` (Chris, 2026-05-30: DeepSeek
  open-weight) and all three deployments below are `freedomOrientedDeployment: true`.

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

## Offering — wafer

- **slug:** `deepseek-v4-flash` · **adapterId:** `wafer:deepseek-v4-flash`
- **context:** **recommended 200 000 · max 1 000 000** (they differ here — wafer
  exposes a 1 M ceiling, but recommended stays at our DeepSeek-V4 sweet-spot of
  200k per Chris, 2026-05-31).
- **reasoning control:** **`toggle`** (defaultOn). Off = `reasoning_effort: 'none'`
  — clean (3/3 silent in live probes, incl. with tools); `medium` reasons. Effort
  does not modulate → toggle, not steps. `reasoning_content` channel. (wafer
  reports `reasoning_tokens: 0` even when a trace is present — usage-present still
  holds via total tokens.) Shares `waferAdapter`.
- **tool calls:** streaming, concurrent with reasoning.
- 🔒 **Privacy:** **none** — non-ZDR serverless deployment (zdr_supported:false),
  no TEE. Serverless, **not** China-routed (Chris, 2026-05-31). The fast/cheap
  option without a privacy guarantee. 🕊️ free (model + deployment). See
  [[../providers/wafer]].

## Validation (2026-05-30, conversation-suite)

nano-gpt 44/44, novita 22/22 — all green across every reasoning permutation.
**Tool-reluctance watch:** the chatsune-era note flagged V4 Flash producing an
image *prompt* without firing `generate_image`. It did **not** reproduce here —
`tool-call-fired:generate_image` was green on both providers with the core
scenario's prompt. Empirical truth over the documented gotcha; no mitigation
needed at present.

**wafer (2026-05-31):** core green (reasoning off + on, tool fires, memory,
usage) — no vision scenario (text-only). Tool-reluctance did not appear here either.
