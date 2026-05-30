# Model Curation Record — GLM 5.1 (TEE)

> Curation record. See [[../providers/chutes]] for the shared provider mechanics.

- **Identity:** GLM 5.1 · family `glm`
- **T/R/V:** tools ✅ · reasoning ✅ (optional, effort buckets) · vision ❌ (text-only)
- **replayReasoning:** false (soft-CoT)

## Offering — chutes

- **slug:** `zai-org/GLM-5.1-TEE` · **adapterId:** `chutes:zai-org/GLM-5.1-TEE`
- **context:** recommended/max 202 752
- **reasoning control:** `reasoning_effort` — `low`/`medium`/`high` select effort;
  **off = `reasoning_effort: "none"`** (steps with `offStep: 'off'`). Omitting the
  field does **not** disable thinking.
- 🔒 **Privacy:** yes (chutes TEE)
- 🕊️ **Freedom:** pending live judgement

## Notes

`family: glm` — GLM 5 also exists on chutes (`zai-org/GLM-5-TEE`) and on nano-gpt.
No lineage axis (GLM 5 / 5.1 as one logical model) per the data-model design (D6);
`family` gives loose grouping only. Live validation: tool turn + reasoning-on.

## Repair — reasoning "off" was leaking thinking (2026-05-30)

Symptom: choosing "off" in the cockpit still produced a CoT trace. The forward
plumbing was correct (cockpit → `{enabled:false}` → adapter), but the
`chutesAdapter` *omitted* `reasoning_effort` for off, assuming "omitted = off".

Probed live against `zai-org/GLM-5.1-TEE` (`keys/.chutes-test-key`, non-streaming,
"What is 17+25?"):

| request | `reasoning_content` | `reasoning_tokens` |
|---|---|---|
| baseline (no `reasoning_effort`) | **present** | > 0 |
| `reasoning_effort: "none"` | **absent** | 0 |
| `chat_template_kwargs: {enable_thinking:false}` | absent | 0 |
| `reasoning_effort: "low"` (control) | present | > 0 |

So GLM-family models on chutes reason by default; **`reasoning_effort: "none"`** is
the true off-switch. Fix: `chutesAdapter.buildRequest` now sends
`reasoning_effort: 'none'` when reasoning is disabled (was: omit), and the
adapter's recorded `profile.reasoning.offStep` is `'off'` (was `null`),
matching the offering. The fix is adapter-level, so it applies to every chutes
offering; end-to-end re-verified through `makeLiveBinding` (off → reasoning
absent, on/medium → reasoning present). Per-model off-confirmation for the other
chutes models (DeepSeek V3.2, Kimi K2.6, Gemma) is a cheap follow-up.

## Why

GLM 5.1 is a capable, popular general model; the TEE deployment makes it a
privacy-first pick. Strong tool + reasoning support per `/models`
(`supported_features`).
