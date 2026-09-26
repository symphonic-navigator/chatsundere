# Model Curation Record — Claude Fable 5.1

> Curated on nano-gpt 2026-09-25 (entries added without live probes — the test
> key had been revoked, `401 Invalid session`) and **re-curated 2026-09-26** with
> live probes and the conversation-suite
> (`packages/llm-unified/curation/run-nano-sept2026-suite.ts`, which resolves the
> adapter from the registry after `registerNanoGpt()` — the exact app wiring).
> See [[../providers/nano-gpt]] for the shared mechanics.

- **Canonical:** `claude-fable-5.1` · **Family:** `claude` · **Display:** Claude Fable 5.1
- **T/R/V:** tools ✅ · reasoning ✅ · vision ✅
- **replayReasoning:** false — extended-thinking signature replay stays deferred, as for the rest of the family (ADR 0032)
- **🕊️ Freedom:** CENSORED — `freedomOriented: false`, the family classification inherited from [[claude-fable-5]] until a model-specific eval says otherwise; nano-gpt routes verbatim.

## Offering — nano-gpt — `steps` WITHOUT an off

- **slug:** `anthropic/claude-fable-5.1` · adapter `claudeEffortAdapter`
  (body flag `reasoning:{enabled,effort}`, no `:thinking` sibling).
- **context:** recommended 200 000 / max 1 048 576 (`/models`: 1 000 000).
- **reasoning control:** `steps` `['low','medium','high']`, **`offStep: null`**,
  default `medium` (`FABLE51_STEPS`). **Corrected** from the 2026-09-25 entry,
  which copied [[claude-fable-5]]'s genuine off. Fable 5.1 does not keep it:
  `reasoning:{enabled:false}` and `thinking:{type:'disabled'}` blank the trace
  while `completion_tokens` stay at **64** for an 8-character answer —
  identical to the reasoning-on runs. The [[claude-opus-5]] signature.
- **adaptive thinking.** Asked on, Fable 5.1 decides per prompt whether to
  think at all: the suite's easy bookshop problem produced **no** trace at any
  effort (and no hidden thinking either — ~150 completion tokens for a
  ~220-character answer), and `low` skipped it even on the hard snail problem,
  while `medium` there streamed 597 characters of reasoning through the real
  adapter. So the suite's `reasoning-present` is red on all three steps by
  model choice, not by a pipe fault — verified by pushing a hard prompt through
  the same binding. Users will see thinking only when the question warrants it.
- **effort:** low/medium/high do not separate in single samples (as for Opus 5).
- **trust:** no ZDR/TEE. Expensive: $10 / $50 per M tokens.
- **suite:** core FAIL only on `reasoning-present` (adaptive thinking above),
  every tool/usage/memory check green; vision **PASS** 4/4.

## Confidence — `partial`

Tools, usage, memory, vision and the reasoning pipe are all verified; the
offering stays `partial` because adaptive thinking leaves the suite's `reasoning-present` red on easy prompts (Chris, 2026-09-26). Flip to
`verified` if a future suite scenario can tell model choice from pipe failure.
