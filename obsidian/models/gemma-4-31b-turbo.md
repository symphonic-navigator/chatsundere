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
- **reasoning control:** symmetric `chat_template_kwargs` toggle — on =
  `{ enable_thinking: true }`, off = `{ enable_thinking: false }` (see
  [[../providers/chutes]]). `reasoning_effort` is **not** the on-switch and does
  not modulate the trace; reasoning is a `toggle`.
- ✅ **Visible reasoning channel.** Streams `reasoning_content` (with
  `reasoning_tokens`) whenever `enable_thinking: true` is set — re-probed live
  2026-05-31 (463–614 reasoning chars). The earlier "hidden reasoning / no
  `reasoning_content`" record (2026-05-30) was an artefact of the **wrong
  on-switch** (`reasoning_effort` alone); under it chutes Gemma-turbo emits zero
  `reasoning_content` *and* zero `reasoning_tokens`. See
  [[../insights/2026-05-31-chutes-reasoning-on-switch]].
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

## Offering — openrouter

- **slug:** `google/gemma-4-31b-it` · **adapterId:** `openrouter:google/gemma-4-31b-it`
  (canonicalRef `gemma-4-31b` — the instruction-tuned variant; OpenRouter has no
  `-turbo` slug).
- **context:** recommended/max 262 144 (OpenRouter reported context).
- **reasoning control:** **`toggle`** (defaultOn). OpenRouter's unified
  `reasoning: { enabled }` — off genuine (0 tokens), on ~153 reasoning tokens on
  the **`reasoning`** channel. See [[../providers/openrouter]].
- **vision:** ✅ — image-input pipe carries through (suite vision green).
- **tool calls:** streaming (fragmented args, reassembled), concurrent with reasoning.
- **usage:** OpenAI-standard — `reasoning_tokens` under `completion_tokens_details`.
- 🔒 **Privacy:** **no** — US router/aggregator, not ZDR/TEE, trust per-route.
- 🕊️ **Freedom:** `freedomOrientedDeployment: null` (pending Chris).
- **Validation (2026-05-31):** core 22/22 + vision 4/4 green. The first vision run
  hit a transient HTTP 429 (rate limit); the retry was green — not a vision fault.

## Tool-reluctance watch (did not reproduce)

The chatsune-era note flagged Gemma producing an image *prompt* without firing
`generate_image`. Across all three providers it **fired** `generate_image` with
valid JSON on the core scenario prompt — `tool-call-fired:generate_image` green.
Empirical truth over the documented gotcha; no mitigation needed at present.

## Validation (conversation-suite)

- **Core:** nano-gpt + novita all green (tools, reasoning on/off, usage, memory).
  **chutes** now all green too (2026-05-31): with the on-switch fix
  (`enable_thinking: true`) `reasoning-present` passes; tools, usage, memory and
  reasoning-off green. (The 2026-05-30 "chutes 41/44" run predated the fix — the
  three reds were the wrong-on-switch artefact, not a missing channel.)
- **Vision:** Gemma names the clothing colour "green" on the Sylvir test image on
  **all three** providers — vision pipe verified everywhere. (The earlier
  128x128 solid-red image was retired on 2026-05-31; see [[mimo-v2.5-omni]].)
