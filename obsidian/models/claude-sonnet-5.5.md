# Model Curation Record — Claude Sonnet 5.5

> Curated on nano-gpt 2026-10-24 on a community request, with live probes and
> the conversation-suite (`packages/llm-unified/curation/run-nano-sept2026-suite.ts`,
> which resolves the adapter from the registry after `registerNanoGpt()` — the
> exact app wiring) plus the tool-replay suite. See [[../providers/nano-gpt]]
> for the shared mechanics.

- **Canonical:** `claude-sonnet-5.5` · **Family:** `claude` · **Display:** Claude Sonnet 5.5
- **T/R/V:** tools ✅ · reasoning ✅ · vision ✅
- **replayReasoning:** false — extended-thinking signature replay stays deferred, as for the rest of the family (ADR 0032)
- **🕊️ Freedom:** `null` — deliberately UNKNOWN (**Uncensored?** badge). Chris's call (2026-10-24): the censorship state is unclear, so neither Anthropic's family default (`false`) nor a benchmark-backed `true` is asserted until Chatsundere's own freedom eval lands. nano-gpt routes verbatim (`freedomOrientedDeployment: true`).

## Offering — nano-gpt — slug swap with `steps` and a genuine off

- **slugs:** `anthropic/claude-sonnet-5.5` (off) · `anthropic/claude-sonnet-5.5:thinking` (on) · adapter `claudeAdapter` (slug swap + Anthropic `cache_control`)
- **context:** recommended 200 000 / max 1 000 000 (`/models`: 1 000 000, 128 000 output). `recommended ≠ max` deliberately — the family sweet spot, not the ceiling.
- **reasoning control:** `steps` `['off','low','medium','high']`, `offStep: 'off'`, default `medium`.
  - **The bare slug is a genuine off.** No reasoning channel at all; on a forced
    one-integer answer the model writes its working into the visible content
    instead (73 completion tokens, 0 reasoning chars, two runs) — nothing is
    thought out of sight. A `reasoning:{enabled:false}` body flag is equivalent.
  - **Effort modulates**, unlike the Claude 4 family's clean toggle:
    `reasoning_effort` on the `:thinking` sibling decides whether the adaptive
    thinking engages. On a word puzzle low/medium skipped the trace and high
    streamed 295 characters; on the snail-well problem through the real adapter
    off/low/medium gave 0 and high 505. So a steps control, mirroring
    [[claude-5|Sonnet 5]] on OpenRouter; we ship the house three of nano-gpt's
    five-rung ladder (low…max), as for Opus 5.
  - nano-gpt's description of the bare slug ("skips up-front thinking and can
    reason between tool calls") is not observable on this surface — the bare
    slug emitted no reasoning in any probe, tools included.
- **tool calls:** fire reliably, single block (`streaming: false`), concurrent with reasoning.
- **orphanReplay:** `true` — `orphan-tool-replay` answered HTTP 200 on every permutation; the `tool-replay` gate fired `generate_image` on the tool channel.
- **trust:** no ZDR/TEE. $2 / $10 per M tokens (cache read $0.10, write $2.50 per M).

## Validation (live, 2026-10-24)

| Scenario | Result | Notes |
|---|---|---|
| `core` | FAIL only on `reasoning-present` (low/medium/high) | adaptive thinking skips the easy bookshop prompt; every HTTP/stream/tool/JSON/continuation/memory/usage check green across all four permutations |
| `vision` | **PASS** 4/4 | |
| `tool-replay` / `tool-then-user` / `orphan-tool-replay` | tool fires, HTTP 200 throughout | only `reasoning-present` red, same cause |

## Confidence — `partial`

As for [[claude-fable-5.1]]: tools, usage, memory, vision and the reasoning pipe
are verified (a hard prompt streams reasoning through the same binding), but the
suite's `reasoning-present` stays red by model choice. Flip to `verified` once a
suite scenario can tell adaptive thinking from a pipe fault.
