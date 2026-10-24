# Model Curation Record — Claude Haiku 5.5

> Curated on nano-gpt 2026-10-24 on a community request, with live probes and
> the conversation-suite (`packages/llm-unified/curation/run-nano-sept2026-suite.ts`,
> registry-resolved adapter) plus the tool-replay suite. See
> [[../providers/nano-gpt]] for the shared mechanics.

- **Canonical:** `claude-haiku-5.5` · **Family:** `claude` · **Display:** Claude Haiku 5.5
- **T/R/V:** tools ✅ · reasoning ✅ · vision ✅
- **replayReasoning:** false — signature replay deferred, as for the family (ADR 0032)
- **🕊️ Freedom:** `null` — deliberately UNKNOWN (**Uncensored?** badge), Chris's call (2026-10-24): censorship state unclear, pending Chatsundere's own freedom eval. nano-gpt routes verbatim.

## Offering — nano-gpt — body flag with `steps` and a genuine off

- **slug:** `anthropic/claude-haiku-5.5` · adapter `claudeEffortAdapter` (Fable 5's shape)
- **no thinking sibling:** `anthropic/claude-haiku-5.5:thinking` answers `model_not_supported`.
- **context:** recommended 200 000 / max 1 000 000 (`/models`: 1 000 000, 128 000 output).
- **reasoning control:** `steps` `['off','low','medium','high']`, `offStep: 'off'`, default `medium` (`FABLE_STEPS`).
  - **Genuine off**, unlike [[claude-opus-5.5]]: `reasoning:{enabled:false}`
    bills 5–7 completion tokens for a forced one-integer answer against 116 with
    reasoning on — and gets the multiplication wrong, so nothing is thought out
    of sight. With no flag at all the model reasons (adaptive default on), so
    the adapter always sends the flag.
  - `reasoning_effort:'none'` is rejected (HTTP 400; ladder low/medium/high/xhigh/max).
  - **effort:** low/medium/high do not separate cleanly in single samples (644 / 1164 / 709 reasoning chars on a Pell equation); the house three are shipped.
  - **adaptive thinking:** low/medium skip the suite's easy bookshop prompt; high reasons there, and on the hard snail-well prompt all three steps stream 590–690 characters through the real adapter.
- **tool calls:** fire reliably, single block, concurrent with reasoning.
- **orphanReplay:** `true` — `orphan-tool-replay` HTTP 200 on every permutation; `tool-replay` gate fired `generate_image` on the tool channel.
- **trust:** no ZDR/TEE. Very cheap: $0.10 / $0.50 per M tokens.

## Validation (live, 2026-10-24)

| Scenario | Result | Notes |
|---|---|---|
| `core` | FAIL only on `reasoning-present` (low/medium) | adaptive thinking; off and high fully green, every tool/usage/memory check green |
| `vision` | **PASS** 4/4 | |
| `tool-replay` / `tool-then-user` / `orphan-tool-replay` | tool fires, HTTP 200 throughout | only adaptive `reasoning-present` red |

## Confidence — `partial`

Same posture as [[claude-sonnet-5.5]] and [[claude-fable-5.1]]: the pipe is
verified, the remaining red check is model choice.
