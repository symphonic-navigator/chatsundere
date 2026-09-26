# Model Curation Record — GLM 5.3 Flash

> Curated on nano-gpt 2026-09-25 (entries added without live probes — the test
> key had been revoked, `401 Invalid session`) and **re-curated 2026-09-26** with
> live probes and the conversation-suite
> (`packages/llm-unified/curation/run-nano-sept2026-suite.ts`, which resolves the
> adapter from the registry after `registerNanoGpt()` — the exact app wiring).
> See [[../providers/nano-gpt]] for the shared mechanics.

- **Canonical:** `glm-5.3-flash` · **Family:** `glm` · **Display:** GLM 5.3 Flash
- **T/R/V:** tools ✅ · reasoning ✅ · vision ✅
- **replayReasoning:** false (soft-CoT — never replays its own thinking)
- **🕊️ Freedom:** free — `freedomOriented: true`, the GLM-family judgement carried forward; nano-gpt `freedomOrientedDeployment: true`.

## Offering — nano-gpt — `steps` without an off

- **slug:** `z-ai/glm-5.3-flash` · adapter `nanoGptReasoningEffortAdapter`
- **context:** recommended 200 000 / max 1 048 576 (`/models`: 1 048 576).
- **reasoning control:** `steps` `['low','high','max']`, `offStep: null`,
  default `max` — the entry from 2026-09-25 was right, now with evidence:
  there is **no `:thinking` sibling** (HTTP 400 `model_not_supported`) and every
  off spelling is refused with `reasoning_required`. With no effort set it
  reasons the longest (~1700 reasoning tokens on a hard prompt), hence `max` as
  the honest default. low/high/max do not separate cleanly in single samples.
- **reasoning channel:** `reasoning` (plus a duplicate `reasoning_details` at
  higher efforts, ignored).
- **vision:** ✅ verified by the vision scenario.
- 🔒 **Privacy:** no — nano-gpt has no ZDR/TEE on this route (`trust: { tee: false, zdr: false }`).
- **suite:** **PASS** core 33/33 (low/high/max) and vision 4/4.
- Also published as `TEE/glm-5.3-flash` — a candidate for a 🔒 offering, not
  curated here.

## Follow-up

The ollama-cloud offering's `think:false` off is suspect for the same reason as
[[glm-5.3]]'s — see there.
