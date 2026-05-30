# Model Curation Record — GLM 5.1 (TEE)

> Curation record. See [[../providers/chutes]] for the shared provider mechanics.

- **Identity:** GLM 5.1 · family `glm`
- **T/R/V:** tools ✅ · reasoning ✅ (optional, effort buckets) · vision ❌ (text-only)
- **replayReasoning:** false (soft-CoT)

## Offering — chutes

- **slug:** `zai-org/GLM-5.1-TEE` · **adapterId:** `chutes:zai-org/GLM-5.1-TEE`
- **context:** recommended/max 202 752
- **reasoning control:** `reasoning_effort` (low/medium/high), off = omit
- 🔒 **Privacy:** yes (chutes TEE)
- 🕊️ **Freedom:** pending live judgement

## Notes

`family: glm` — GLM 5 also exists on chutes (`zai-org/GLM-5-TEE`) and on nano-gpt.
No lineage axis (GLM 5 / 5.1 as one logical model) per the data-model design (D6);
`family` gives loose grouping only. Live validation: tool turn + reasoning-on.

## Why

GLM 5.1 is a capable, popular general model; the TEE deployment makes it a
privacy-first pick. Strong tool + reasoning support per `/models`
(`supported_features`).
