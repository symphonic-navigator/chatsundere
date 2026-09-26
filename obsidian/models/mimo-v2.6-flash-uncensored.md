# Model Curation Record — MiMo V2.6 Flash Uncensored

> Curated on nano-gpt 2026-09-25 (entries added without live probes — the test
> key had been revoked, `401 Invalid session`) and **re-curated 2026-09-26** with
> live probes and the conversation-suite
> (`packages/llm-unified/curation/run-nano-sept2026-suite.ts`, which resolves the
> adapter from the registry after `registerNanoGpt()` — the exact app wiring).
> See [[../providers/nano-gpt]] for the shared mechanics.

- **Canonical:** `mimo-v2.6-flash-uncensored` · **Family:** `mimo` · **Display:** MiMo V2.6 Flash Uncensored
- **T/R/V:** tools ✅ · reasoning ✅ · vision ❌ (text-only)
- **replayReasoning:** false (soft-CoT — never replays its own thinking)
- **🕊️ Freedom:** free — `freedomOriented: true`: an explicit lower-refusal fine-tune of MiMo V2.6 Flash, curated on Chris's request (2026-09-25); nano-gpt `freedomOrientedDeployment: true`.

Chris asked for it by name alongside [[glm-5.3-flash-uncensored]].

## Offering — nano-gpt — `toggle` with a genuine off

- **slug:** `xiaomi/mimo-v2.6-flash-uncensored` · adapter
  `nanoGptReasoningEffortAdapter`
- **context:** recommended 200 000 / max 1 048 576; output capped at 65 536.
- **text-only:** nano-gpt's `/models` lists `vision: false` for the fine-tune,
  though the base Flash is omnimodal. Why abliteration/fine-tuning would drop
  image input is unexplained — plausibly the uncensored checkpoint was
  published text-only. We follow the measured listing.
- **reasoning control:** `toggle` (`defaultOn: true`). **Corrected** from the
  2026-09-25 `fixed-on`: unlike the base Flash, `reasoning_effort:'none'` is a
  **genuine** off here — 23 completion tokens, 0 reasoning (and
  `reasoning:{enabled:false}` agrees). With no effort set the base slug
  reasons, so an off must be spelled out: `nanoGptReasoningEffortAdapter` now
  sends `reasoning_effort:'none'` for an off intent (unit-tested).
- 🔒 **Privacy:** no — nano-gpt has no ZDR/TEE on this route (`trust: { tee: false, zdr: false }`).
- **suite:** **PASS** core 22/22 (off/on).
