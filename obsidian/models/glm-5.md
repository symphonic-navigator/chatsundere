# Model Curation Record — GLM 5

> Curation record. See [[../providers/chutes]] for the shared chutes mechanics
> and [[glm-5.1]] for the sibling model (same `family`, no lineage axis per D6).

- **Identity:** GLM 5 · family `glm`
- **T/R/V:** tools ✅ · reasoning ✅ · vision ❌ (text-only)
- **replayReasoning:** false (soft-CoT — never replays its own thinking)
- **🕊️ Freedom:** free — `freedomOriented: true` (Chris, 2026-05-30: z-ai/Zhipu
  open-weight), and every deployment below is `freedomOrientedDeployment: true`.

GLM 5 is offered on three providers with hand-written catalogue adapters
(`confidence: 'verified'`). **The headline quirk: whether reasoning can be turned
off is per-deployment, not per-model.** chutes and novita disable it cleanly;
nano-gpt's GLM 5 deployment reasons regardless, so there it is `fixed-on`.

## Offering — chutes

- **slug:** `zai-org/GLM-5-TEE` · **adapterId:** `chutes:zai-org/GLM-5-TEE`
- **context:** recommended/max 202 752
- **reasoning control:** `reasoning_effort` steps — `low`/`medium`/`high`; **off =
  `chat_template_kwargs: { enable_thinking: false }`** (`offStep: 'off'`) — the
  uniform chutes off switch (not `reasoning_effort: 'none'`; see
  [[../providers/chutes]]). Probed live: off truly off.
- **tool calls:** single block, concurrent with reasoning.
- 🔒 **Privacy:** yes (chutes TEE)

## Offering — novita

- **slug:** `zai-org/glm-5` · **adapterId:** `novita:zai-org/glm-5`
- **context:** recommended/max 200 000
- **reasoning control:** top-level boolean **`enable_thinking`** (toggle,
  `defaultOn: true`). `enable_thinking: false` disables cleanly (probed 3/3
  across runs); thinking streams on `reasoning_content`.
- **tool calls:** single block, concurrent with reasoning.
- 🔒 **Privacy:** no TEE / no ZDR.

## Offering — nano-gpt — `fixed-on` (reasoning cannot be disabled)

- **slug:** `zai-org/glm-5` · **adapterId:** `nano-gpt:zai-org/glm-5`
- **context:** recommended/max 200 000
- **reasoning control:** **`fixed-on`.** nano-gpt steers GLM reasoning by a
  slug-swap (`:thinking`), which works for GLM 5.1 but **not** GLM 5: the bare
  `zai-org/glm-5` slug **still reasons** (probed live 3/3 runs: 120 / 71 / 26
  reasoning deltas with no thinking requested). There is no body-flag fallback on
  nano-gpt, so reasoning genuinely cannot be turned off for this deployment →
  `{ mode: 'fixed-on' }` per the probe-checklist "off only hides / cannot be
  disabled" rule. The cockpit will therefore show reasoning as always-on for
  nano-gpt's GLM 5 (disabled-over-hidden).
- **tool calls:** single block, concurrent with reasoning. Thinking on the
  `reasoning` channel; `reasoning_tokens` reported top-level + nested.
- 🔒 **Privacy:** no TEE / no ZDR.

## Offering — tensorix

- **slug:** `z-ai/glm-5` · **adapterId:** `tensorix:z-ai/glm-5`
- **context:** recommended/max 131 072
- **reasoning control:** **`toggle`** (defaultOn). Off = `reasoning_effort: 'none'`
  — clean; `medium` reasons. Effort does not modulate → toggle. `reasoning_content`
  channel. (Note: unlike nano-gpt's `fixed-on` GLM 5, tensorix suppresses cleanly.)
- **tool calls:** streaming, concurrent with reasoning.
- **usage:** OpenAI-standard — `reasoning_tokens` under `completion_tokens_details`.
- 🔒 **Privacy:** **ZDR** (zero data retention, EU-sovereign, always-on per
  policy). No TEE. See [[../providers/tensorix]].
- **Validation (2026-05-31, conversation-suite):** core green (reasoning off + on,
  tool fires + valid JSON, memory, usage); text-only.

## Offering — openrouter

- **slug:** `z-ai/glm-5` · **adapterId:** `openrouter:z-ai/glm-5`
- **context:** recommended/max 202 752 (OpenRouter reported context).
- **reasoning control:** **`toggle`** (defaultOn). Unified `reasoning: { enabled }`
  — off genuine (0 tokens), on ~304 reasoning tokens on the **`reasoning`**
  channel (OpenRouter normalises GLM's native `reasoning_content` onto
  `reasoning`). Clean off, unlike nano-gpt's `fixed-on` GLM 5. See
  [[../providers/openrouter]].
- **tool calls:** streaming (fragmented args, reassembled), concurrent with reasoning.
- **usage:** OpenAI-standard — `reasoning_tokens` under `completion_tokens_details`.
- 🔒 **Privacy:** **no** — US router/aggregator, not ZDR/TEE, trust per-route.
- 🕊️ **Freedom:** `freedomOrientedDeployment: null` (pending Chris).
- **Validation (2026-05-31):** core 22/22 green; text-only.

## Validation

Full conversation-suite live across every supported reasoning permutation:
chutes 44/44 ✅, novita 22/22 ✅, nano-gpt 11/11 with **one** `memory-echoed`
red on the single fixed-on permutation. That red is **model-output noise, not a
protocol fault**: GLM 5 (the weaker sibling) occasionally answers the recall turn
without the literal token. Proven by direct probes of the same model + history
returning "You are a cat lover." 5/5 — the memory *is* carried through the pipe;
the model merely phrases around it sometimes. Per the suite's design D8 we judge
the pipe, never the intelligence, so this does not block `verified`.

## Notes

A bare `TEE/glm-5` also exists on nano-gpt (no `-thinking` sibling listed); not
curated here. GLM 5 is the older, slightly weaker sibling of [[glm-5.1]]; prefer
5.1 where available.
