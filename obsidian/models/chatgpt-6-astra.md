# Model Curation Record — GPT 6 Astra

> Curated on nano-gpt 2026-09-25 (entries added without live probes — the test
> key had been revoked, `401 Invalid session`) and **re-curated 2026-09-26** with
> live probes and the conversation-suite
> (`packages/llm-unified/curation/run-nano-sept2026-suite.ts`, which resolves the
> adapter from the registry after `registerNanoGpt()` — the exact app wiring).
> See [[../providers/nano-gpt]] for the shared mechanics.

- **Canonical:** `chatgpt-6-astra` · **Family:** `chatgpt` · **Display:** GPT 6 Astra
- **T/R/V:** tools ✅ · reasoning ✅ · vision ✅
- **replayReasoning:** false — the reasoning summary is display-only
- **🕊️ Freedom:** CENSORED — `freedomOriented: false`: OpenAI aligns at source; nano-gpt routes verbatim (`freedomOrientedDeployment: true`), so `effectiveFreedom` is *restricted*. Onboarded on explicit user request, like the rest of [[chatgpt]].

## Offering — nano-gpt — `steps` WITHOUT an off

- **slug:** `openai/gpt-6-astra` · adapter `openRouterAdapter`
- **context:** recommended 200 000 / max 1 048 576 (`/models`: 1 050 000;
  output 128 000).
- **reasoning control:** `steps` `['low','medium','high']`, **`offStep: null`**,
  default `medium` (`OPENAI_NO_OFF_STEPS`). **Corrected** from the 2026-09-25
  entry, which reused the family's off step: `reasoning:{enabled:false}` blanks
  the summary but still bills **118 reasoning tokens** (vs 143 with no flag),
  and `reasoning_effort:'none'` is rejected (HTTP 400; ladder
  low/medium/high/xhigh/max). The first GPT here that cannot be switched off —
  the Opus 5 signature. `xhigh`/`max` are published but not offered (house
  three, same call as Opus 5).
- **reasoning summary is sometimes omitted.** OpenAI only streams a summary
  when it chooses to; for brief reasoning at `low`/`medium` it may send none
  while still billing reasoning tokens. The suite's `reasoning-present` went
  red on low (run 1) and low+medium (run 2) on the bookshop problem; the same
  permutations through the real adapter then populated the channel (358–501
  characters, 15–174 reasoning tokens). The pipe is sound; the gap is
  upstream. In the cockpit this means an occasional "thought, but nothing to
  show" turn.
- **trust:** no ZDR/TEE, jurisdiction US. Expensive: $10 / $50 per M tokens.
- **suite:** core FAIL only on `reasoning-present` (the omitted summary above),
  every tool/usage/memory check green; vision **PASS** 4/4.
- Not curated: `openai/gpt-6-astra-pro`.

## Confidence — `partial`

Tools, usage, memory, vision and the reasoning pipe are all verified; the
offering stays `partial` because the reasoning summary is sometimes omitted at low/medium, so the suite's `reasoning-present` is not reliably green (Chris, 2026-09-26). Flip to
`verified` if a future suite scenario can tell model choice from pipe failure.
