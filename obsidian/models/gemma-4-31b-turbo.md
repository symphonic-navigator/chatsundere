# Model Curation Record — Gemma 4 31B

> Curation record. See [[../providers/chutes]] for the shared chutes mechanics.
> File named `gemma-4-31b-turbo` historically; the canonical id is `gemma-4-31b`.

- **Identity:** Gemma 4 31B · family `gemma`
- **T/R/V:** tools ✅ · reasoning ✅ · vision ✅ (input image; output text-only)
- **replayReasoning:** false (soft-CoT)
- **🕊️ Freedom:** free — `freedomOriented: true` (Chris, 2026-05-30: Google
  open-weight) and every deployment below is `freedomOrientedDeployment: true`.

Offered on chutes, nano-gpt and novita, each with a hand-written catalogue adapter
(`confidence: 'verified'`).

## Offering — chutes

- **slug:** `google/gemma-4-31B-turbo-TEE` · **adapterId:** `chutes:google/gemma-4-31B-turbo-TEE`
- **context:** recommended/max 131 072
- **reasoning control:** `reasoning_effort` (low/medium/high) to enable; off =
  `chat_template_kwargs: { enable_thinking: false }` (the uniform chutes off
  switch — see [[../providers/chutes]]).
- ⚠️ **Hidden reasoning:** chutes Gemma emits `reasoning_tokens` (counted) but **no
  `reasoning_content` text**, even on a hard prompt at `effort: high` (probed
  2026-05-30) — so the suite's `reasoning-present` assertion fails for the chutes
  offering. Reasoning works (token-counted) but is not surfaced. Follow-up: decide
  whether the chutes Gemma `reasoning` should be modelled as visible at all. The
  nano-gpt and novita Gemma offerings DO surface reasoning normally.
- 🔒 **Privacy:** yes (chutes TEE)
- **FP4 quant** — an FP4-quantised deployment (recorded for honesty; conjecture:
  squeezed onto spare H100 capacity). Despite FP4 reportedly very good (Chris).

## Offering — nano-gpt

- **slug:** `google/gemma-4-31b-it` · **adapterId:** `nano-gpt:google/gemma-4-31b-it`
- **context:** recommended/max 262 144
- **reasoning control:** model-slug swap (`steps`, `offStep: 'off'`); bare cleanly
  off, `:thinking` + `reasoning_effort` on the `reasoning` channel. 🔒 no TEE / no ZDR.

## Offering — novita

- **slug:** `google/gemma-4-31b-it` · **adapterId:** `novita:google/gemma-4-31b-it`
- **context:** recommended/max 262 144
- **reasoning control:** `enable_thinking` boolean (`toggle`); off via
  `enable_thinking: false`. `reasoning_content` channel. **novita streams Gemma's
  tool calls FRAGMENTED** (88 SSE deltas in one probe) — the adapter's fragment
  buffer reassembles them; the generic path would have dropped the arguments.
  🔒 no TEE / no ZDR.

## Tool-reluctance watch (did not reproduce)

The chatsune-era note flagged Gemma producing an image *prompt* without firing
`generate_image`. Across all three providers it **fired** `generate_image` with
valid JSON on the core scenario prompt — `tool-call-fired:generate_image` green.
Empirical truth over the documented gotcha; no mitigation needed at present.

## Validation (2026-05-30, conversation-suite)

- **Core:** nano-gpt 44/44, novita 22/22 — all green (tools, reasoning on/off,
  usage, memory). **chutes 41/44** — the only reds are `reasoning-present` (the
  hidden-reasoning characteristic above: chutes Gemma surfaces no `reasoning_content`
  text); tools, usage, memory and reasoning-off are green.
- **Vision:** Gemma describes the 128x128 test image as "red" on **all three**
  providers — vision pipe verified everywhere.
