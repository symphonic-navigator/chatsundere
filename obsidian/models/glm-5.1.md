# Model Curation Record — GLM 5.1

> Curation record. See [[../providers/chutes]] for the shared chutes mechanics.

- **Identity:** GLM 5.1 · family `glm`
- **T/R/V:** tools ✅ · reasoning ✅ · vision ❌ (text-only)
- **replayReasoning:** false (soft-CoT — never replays its own thinking)
- **🕊️ Freedom:** free — `freedomOriented: true` (Chris, 2026-05-30: z-ai/Zhipu
  open-weight), and every deployment below is `freedomOrientedDeployment: true`.

GLM 5.1 is offered on three providers, each with a hand-written catalogue
adapter (`confidence: 'verified'`). The reasoning *mechanism* differs per
provider — this is the whole reason the offerings are not on the generic path.

## Offering — chutes

- **slug:** `zai-org/GLM-5.1-TEE` · **adapterId:** `chutes:zai-org/GLM-5.1-TEE`
- **context:** recommended/max 202 752
- **reasoning control:** `reasoning_effort` — `low`/`medium`/`high` select effort;
  **off = `reasoning_effort: "none"`** (steps, `offStep: 'off'`). Omitting the
  field does **not** disable thinking.
- **tool calls:** single block, concurrent with reasoning.
- 🔒 **Privacy:** yes (chutes TEE)

## Offering — nano-gpt

- **slug:** `zai-org/glm-5.1` · **adapterId:** `nano-gpt:zai-org/glm-5.1`
- **context:** recommended/max 200 000
- **reasoning control:** **model-slug swap** (steps, `offStep: 'off'`). Bare
  `zai-org/glm-5.1` reasons **not at all** (clean off); `zai-org/glm-5.1:thinking`
  reasons and honours `reasoning_effort` (low/medium/high). Thinking streams on
  the **`reasoning`** delta channel (not `reasoning_content`).
- **tool calls:** single block, concurrent with reasoning.
- **usage:** `reasoning_tokens` reported both top-level and under
  `completion_tokens_details`; adapter prefers top-level.
- 🔒 **Privacy:** no TEE / no ZDR (bare nano-gpt deployment).
- A `TEE/glm-5.1` (+ `TEE/glm-5.1-thinking`) deployment also exists on nano-gpt;
  not curated here (separate offering, future work).

## Offering — novita

- **slug:** `zai-org/glm-5.1` · **adapterId:** `novita:zai-org/glm-5.1`
- **context:** recommended/max 200 000
- **reasoning control:** **top-level boolean `enable_thinking`** (toggle,
  `defaultOn: true`). Probed empirically: the heuristic `reasoning: {enabled}`
  flag, `chat_template_kwargs.enable_thinking` and `reasoning_effort: "none"`
  **all failed to disable** thinking; only `enable_thinking: false` does. No
  granular effort buckets, hence a toggle, not steps. Thinking streams on
  `reasoning_content`.
- **tool calls:** single block, concurrent with reasoning.
- **usage:** `reasoning_tokens` nested under `completion_tokens_details`.
- 🔒 **Privacy:** no TEE / no ZDR.

## Validation

Full conversation-suite live (`makeLiveBinding`, keys under `keys/`) across every
reasoning permutation: chutes 44/44, nano-gpt 44/44, novita 22/22 — all green
(no HTTP/stream error, tool fires + valid JSON args, usage normalised, reasoning
present/absent on the correct channel per permutation, memory carried through).

## Notes

`family: glm` — GLM 5 also exists on all three providers. No lineage axis
(GLM 5 / 5.1 as one logical model) per the data-model design (D6); `family` gives
loose grouping only. See [[glm-5]].

## Repair history — reasoning "off" was leaking thinking (chutes, 2026-05-30)

Symptom: choosing "off" in the cockpit still produced a CoT trace. The forward
plumbing was correct (cockpit → `{enabled:false}` → adapter), but the
`chutesAdapter` *omitted* `reasoning_effort` for off, assuming "omitted = off".
Probed live: baseline (no field) → reasoning present; `reasoning_effort: "none"`
→ absent. So GLM-family models on chutes reason by default;
**`reasoning_effort: "none"`** is the true off-switch. Fix landed adapter-level
(applies to every chutes offering); re-verified end to end.
