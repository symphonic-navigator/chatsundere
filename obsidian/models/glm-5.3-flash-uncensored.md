# Model Curation Record — GLM 5.3 Flash Uncensored

> Curated on nano-gpt 2026-09-25 (entries added without live probes — the test
> key had been revoked, `401 Invalid session`) and **re-curated 2026-09-26** with
> live probes and the conversation-suite
> (`packages/llm-unified/curation/run-nano-sept2026-suite.ts`, which resolves the
> adapter from the registry after `registerNanoGpt()` — the exact app wiring).
> See [[../providers/nano-gpt]] for the shared mechanics.

- **Canonical:** `glm-5.3-flash-uncensored` · **Family:** `glm` · **Display:** GLM 5.3 Flash Uncensored
- **T/R/V:** tools ✅ · reasoning ✅ · vision ✅
- **replayReasoning:** false (soft-CoT — never replays its own thinking)
- **🕊️ Freedom:** free — `freedomOriented: true`: an explicit lower-refusal fine-tune of GLM 5.3 Flash, curated on Chris's request (2026-09-25); nano-gpt `freedomOrientedDeployment: true`.

Popular at the time of curation; Chris asked for it by name.

## Offering — nano-gpt — `steps` without an off

- **slug:** `z-ai/glm-5.3-flash-uncensored` · adapter `nanoGptReasoningEffortAdapter`
- **context:** recommended 200 000 / max 1 048 576. nano-gpt caps output at
  32 768 tokens (vs 131 072 for the base Flash).
- **reasoning control:** `steps` `['low','high']`, `offStep: null`, default
  `high`. **Corrected** from the 2026-09-25 `fixed-on`: it refuses every off
  spelling (`reasoning_required`, same as the base model) but effort genuinely
  steers — `low` produced 70 reasoning tokens against ~1100 at `high` on the
  same hard prompt. nano-gpt publishes only `low/high` for this fine-tune; `max`
  is accepted on the wire but not offered, as it is undocumented here.
- **vision:** ✅ verified by the vision scenario (the fine-tune keeps it).
- 🔒 **Privacy:** no — nano-gpt has no ZDR/TEE on this route (`trust: { tee: false, zdr: false }`).
- **suite:** **PASS** core 22/22 (low/high) and vision 4/4.
