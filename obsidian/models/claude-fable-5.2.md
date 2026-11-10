# Model Curation Record — Claude Fable 5.2

> Curated on nano-gpt 2026-11-10, the day it appeared there, with live probes,
> the conversation-suite (`packages/llm-unified/curation/run-nano-sept2026-suite.ts`,
> which resolves the adapter from the registry after `registerNanoGpt()` — the
> exact app wiring) and the tool-replay suite
> (`packages/llm-unified/curation/run-tool-replay-suite.ts`).
> See [[../providers/nano-gpt]] for the shared mechanics.

- **Canonical:** `claude-fable-5.2` · **Family:** `claude` · **Display:** Claude Fable 5.2
- **T/R/V:** tools ✅ · reasoning ✅ · vision ✅
- **replayReasoning:** false — extended-thinking signature replay stays deferred, as for the rest of the family (ADR 0032)
- **🕊️ Freedom:** `null` — deliberately UNKNOWN (**Uncensored?** badge). Chris (2026-11-10) expects it to behave as uncensored, as Anthropic models generally do over the API, but there is no evidence yet either way; pending Chatsundere's own freedom eval it joins [[claude-opus-5]] and the 5.5 generation rather than inheriting the CENSORED badge of [[claude-fable-5]] and [[claude-fable-5.1]]. nano-gpt routes verbatim.

## Field signal — Chris (2026-11-10)

On the live instance the same day, Fable 5.2 worked Chris's Kumbu² notes through
MCP with evident enjoyment: real multi-tool use (`sh` plus the write tools) beyond
the suite's single `generate_image` call. Anecdotal, and nothing to do with the
freedom badge.

## Offering — nano-gpt — `steps` WITHOUT an off

- **slug:** `anthropic/claude-fable-5.2` · adapter `claudeEffortAdapter`
  (body flag `reasoning:{enabled,effort}`).
- **no thinking sibling:** `anthropic/claude-fable-5.2:thinking` answers `model_not_supported`.
- **alias:** nano-gpt's `anthropic/claude-fable-latest` now points here. We
  curate the pinned slug, never the alias, so an upstream bump cannot change
  the model under a user.
- **upstreams:** `/models` lists `google` and `azure` as nano-gpt's backends
  (Vertex / Foundry), not Anthropic directly.
- **context:** recommended 200 000 / max 1 000 000 (`/models`: 1 000 000, 128 000 output).
- **reasoning control:** `steps` `['low','medium','high']`, **`offStep: null`**,
  default `medium` (`FABLE51_STEPS`, shared with [[claude-fable-5.1]]).
  - **An off is a hard error here**, not a hidden one as on Fable 5.1:
    `reasoning:{enabled:false}` and `thinking:{type:'disabled'}` both answer
    **HTTP 400** `"This model requires reasoning and cannot honor an explicit
    reasoning opt-out."` (`code: unsupported_parameter`; the error lists
    `reasoning.enabled=false`, `reasoning_effort=none`, `thinking=false` among
    the rejected forms). The `/models` description says so too: "Adaptive
    thinking is always on, with five effort levels." The adapter's guard
    (`offStep: null` → an off intent is forced on at the default step) is
    therefore load-bearing; a unit test in `builtins.test.ts` pins it.
  - **effort:** nano-gpt advertises low/medium/high/xhigh/max. On a hard
    snail-well prompt completion tokens rose 242 / 292 / 299 / 436 / 947 —
    low and medium/high barely separate, xhigh and max clearly do. The house
    three are shipped, as for the rest of the family.
  - **adaptive thinking:** asked on, the model decides per prompt whether to
    think. `low` skipped the trace even on the snail problem (the working went
    into visible content); medium and high reasoned there (445–481 characters).
    On a trivial sum, medium skipped and max reasoned. The reasoning channel
    carries a summary: ~170 characters for ~50 completion tokens.
- **tool calls:** fire reliably, single block, concurrent with reasoning.
- **orphanReplay:** `true` — `orphan-tool-replay` HTTP 200 on every step;
  the `tool-replay` gate fired `generate_image` on the tool channel at every step.
- **trust:** no ZDR/TEE; Anthropic retains prompts and outputs for 30 days
  (`/models`). Expensive: $10 / $50 per M tokens, as Fable 5.1.

## Validation (live, 2026-11-10)

- **core:** 46/48 — the two red checks are `reasoning-present` at low and
  medium on the easy bookshop prompt (adaptive thinking, above). Tools, tool
  continuation, memory and usage green on all three steps; high fully green.
- **vision:** **PASS** 4/4.
- **tool-replay:** the gate checks green on every step; `reasoning-present` red
  on all three (the model does not think before a trivial replayed call).
  `tool-then-user` and `orphan-tool-replay` **PASS** 12/12 each.

## Confidence — `partial`

Same reason as [[claude-fable-5.1]], [[claude-sonnet-5.5]] and
[[claude-haiku-5.5]]: adaptive thinking leaves the suite's easy-prompt
`reasoning-present` red by model choice, while a hard prompt reasons through
the same request body. Flip to `verified` if a future suite scenario can tell
model choice from pipe failure.
