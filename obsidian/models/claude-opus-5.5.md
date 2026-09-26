# Model Curation Record — Claude Opus 5.5

> Curated on nano-gpt 2026-09-25 (entries added without live probes — the test
> key had been revoked, `401 Invalid session`) and **re-curated 2026-09-26** with
> live probes and the conversation-suite
> (`packages/llm-unified/curation/run-nano-sept2026-suite.ts`, which resolves the
> adapter from the registry after `registerNanoGpt()` — the exact app wiring).
> See [[../providers/nano-gpt]] for the shared mechanics.

- **Canonical:** `claude-opus-5.5` · **Family:** `claude` · **Display:** Claude Opus 5.5
- **T/R/V:** tools ✅ · reasoning ✅ · vision ✅
- **replayReasoning:** false — extended-thinking signature replay stays deferred, as for the rest of the family (ADR 0032)
- **🕊️ Freedom:** `null` — deliberately UNKNOWN (**Uncensored?** badge), as for [[claude-opus-5]]: Lex's SafetyMaxxed benchmark indicates unusually low censorship, pending Chatsundere's own freedom eval (Chris, 2026-09-25). nano-gpt routes verbatim.

The host model of this very re-curation, for what it is worth.

## Offering — nano-gpt — `steps` WITHOUT an off

- **slug:** `anthropic/claude-opus-5.5` · adapter `claudeEffortAdapter`
- **context:** recommended 200 000 / max 1 048 576 (`/models`: 1 000 000).
- **reasoning control:** [[claude-opus-5]]'s `OPUS5_STEPS` (low/medium/high,
  `offStep: null`, default medium) — the 2026-09-25 guess, now confirmed: an
  off blanks the trace but completion tokens stay at 88–101 against 88–107
  reasoning-on for the same 8-character answer ("off only hides").
- **effort:** low/medium/high overlap in single samples, as for Opus 5.
- **trust:** no ZDR/TEE. $4 / $20 per M tokens.
- **suite:** **PASS** core 33/33 (low/medium/high) and vision 4/4.
