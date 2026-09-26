# Model Curation Record — GPT 5.6 Sol

> Curated on nano-gpt 2026-09-25 (entries added without live probes — the test
> key had been revoked, `401 Invalid session`) and **re-curated 2026-09-26** with
> live probes and the conversation-suite
> (`packages/llm-unified/curation/run-nano-sept2026-suite.ts`, which resolves the
> adapter from the registry after `registerNanoGpt()` — the exact app wiring).
> See [[../providers/nano-gpt]] for the shared mechanics.

- **Canonical:** `chatgpt-5.6-sol` · **Family:** `chatgpt` · **Display:** GPT 5.6 Sol
- **T/R/V:** tools ✅ · reasoning ✅ · vision ✅
- **replayReasoning:** false — the reasoning summary is display-only
- **🕊️ Freedom:** CENSORED — `freedomOriented: false`: OpenAI aligns at source; nano-gpt routes verbatim (`freedomOrientedDeployment: true`), so `effectiveFreedom` is *restricted*. Onboarded on explicit user request, like the rest of [[chatgpt]].

## Offering — nano-gpt — `steps` with a genuine off

- **slug:** `openai/gpt-5.6-sol` · adapter `openRouterAdapter` (unified
  `reasoning` object), like the rest of [[chatgpt]].
- **context:** recommended 200 000 / max 1 048 576 (`/models`: 1 050 000;
  output 128 000).
- **reasoning control:** the family's `OPENAI_STEPS` (off/low/medium/high).
  `reasoning:{enabled:false}` is a **genuine** off (50 completion tokens for a
  179-character answer, 0 reasoning) — confirmed, unlike [[chatgpt-6-astra]].
  The reasoning summary streams on `reasoning`.
- **trust:** no ZDR/TEE, jurisdiction US.
- **suite:** **PASS** core 44/44 and vision 4/4.
- Not curated: `openai/gpt-5.6-sol-pro`.
