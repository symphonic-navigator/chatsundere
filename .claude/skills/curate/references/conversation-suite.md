# The conversation-suite — deterministic verification harness

The replacement for byte-level fixture replay. A curated, versioned, multi-turn
conversation scenario that exercises every inference capability Chatsundere
supports — tool calls (including `generate_image`), feeding tool results back,
reasoning, memory injection/echo, multi-step round-trips. It **grows with the
inference-runner's capabilities** (CLAUDE.md §10): every capability the runner
gains gets a turn here.

## Where it lives

`packages/llm-unified/curation/conversation-suite/` — a versioned repo artefact,
**never** in CI (it needs provider keys). Files:

- `types.ts` — `TurnOutcome`, `Assertion`, `AssertionResult`, `AssertionStatus`.
- `scenario.ts` — `ScenarioTurn`, `ReasoningPermutation`, `ConversationScenario`.
- `scenarios/core.ts` — `coreScenario`, the core capability scenario.
- `assertions.ts` — the deterministic checks (below).
- `runner.ts` — `RunnerBinding`, `assembleOutcome`, `runSuite`.
- `report.ts` — `renderSuiteReport` and the `SuiteRun` / `PermutationRun` /
  `TurnRun` result shapes.
- `index.ts` re-exports all of the above plus `coreScenario`.

## How to run it live

Construct a `RunnerBinding` (`runner.ts`) and call `runSuite`:

1. **`offeringRef`** — the offering you are validating (e.g. `nano-gpt:glm-6`).
2. **`runTurn(messages, reasoning)`** — execute one turn. Implement it with
   `streamCompletion` (`src/stream-completion.ts`) plus the offering's adapter
   and the provider's key from `keys/.{provider}-test-key`. Collect the emitted
   `StreamChunk[]`, capture the HTTP status, and call
   `assembleOutcome(httpStatus, chunks)` to build the `TurnOutcome`
   (it folds chunks into `text`, `reasoning`, `toolCalls`, `usage`,
   `finishReason`).
3. **`toolResultFor(toolName, argumentsJson)`** — synthesise the tool-result
   `WireMessage` fed back after a tool call, so the conversation can continue.

Then:

```ts
// Imported by relative path within the repo — the suite lives outside src/ and
// is not a published package subpath (the package only exports `.`).
import { coreScenario, runSuite, renderSuiteReport } from './index.js';

const run = await runSuite(coreScenario, permutations, binding);
console.log(renderSuiteReport(run)); // deterministic Markdown: PASS / FAIL per assertion
```

`renderSuiteReport` produces a Markdown report — overall PASS/FAIL plus every
assertion's verdict per permutation per turn. No LLM, no judgement.

## The permutation matrix

Run **every reasoning permutation the offering supports** (design D3): reasoning
**on** and **off**, plus **each effort level** where the model is steerable (a
`{ mode: 'steps' }` `ReasoningControl` → one permutation per step). Build the
`ReasoningPermutation[]` from the offering's `profile.reasoning` so the full
surface is seen, not just the default path. A `reasoning-off` permutation should
assert `assertReasoningAbsent`; `reasoning-on` permutations assert
`assertReasoningPresent`.

## The deterministic assertions (`assertions.ts`)

All checks are pure functions over a `TurnOutcome` — mechanical/protocol only:

- `assertNoHttpError` — status is 2xx (catches the MiMo/chutes `generate_image`
  HTTP 400).
- `assertNoStreamError` — no `error`-type chunk was emitted mid-stream (catches
  malformed SSE from a provider that opens with 200 then errors part-way).
- `assertToolCallFired(toolName)` — the named tool **actually fired** (not: the
  model merely talked about it). This is what catches the DSv4-Flash-style
  failure where the model produced the prompt but never called the tool.
- `assertToolArgsValidJson(toolName)` — the tool's `argumentsJson` parses.
- `assertUsagePresent` — normalised `usage` surfaced with `totalTokens > 0`.
- `assertReasoningPresent` / `assertReasoningAbsent` — reasoning on the correct
  channel for the permutation.
- `assertMemoryEchoed(token)` — a memory token injected via a system message is
  echoed back through the protocol into the reply. The token must appear in no
  other turn (the core scenario uses "bassoon"; the old "cat" was echo-able from
  the calico-cat image request).
- `assertNotToolShaped` — `continuation-not-tool-shaped`: after a tool result the
  reply is not a tool call written out as text (ReAct `action`/`action_input`,
  `name`+`arguments`, `tool_calls` JSON, or leaked native markup such as
  `<|tool_call>`). A call re-emitted as text instead of through the tool channel
  is a pipe failure, not a judgement of the answer.

## The tool round trip is checked end to end

The core scenario's `tool-result-continuation` turn sends nothing new: the
history already ends in the synthesised tool result, so the turn asks for the
model's reply **to** that result. It is marked `requiresToolResult`; when the
previous turn fired no tool, the runner does not send it and records one failing
`tool-result-available` result instead. Before 2026-09-26 no turn observed this
reply, and a broken round trip (Gemma 4 via vLLM answering tool results with
ReAct JSON, caused by its chat template) passed every assertion. See
[`obsidian/insights/2026-09-26-suite-missed-broken-tool-continuation.md`](../../../../obsidian/insights/2026-09-26-suite-missed-broken-tool-continuation.md).

## Replayed tool history is checked too

The client replays earlier tool rounds structurally (`assistant(tool_calls)` +
`tool`, 9-character provider-neutral ids, results capped at 2000 characters;
spec `superpowers/specs/2026-10-08-tool-history-replay-design.md`). Before
that, history dropped every tool exchange and models learnt to describe images
instead of calling `generate_image` (Mistral Large 4, 2026-10-07).
`scenarios/tool-replay.ts` holds two scenarios, run by
`curation/run-tool-replay-suite.ts`:

- **`tool-replay` (gate):** a replayed `generate_image` round, then a direct
  instruction to call it again; the call must arrive on the tool channel.
- **`orphan-tool-replay` (informational):** the same history with no `tools`
  in the request. PASS ⇒ `toolCalls.orphanReplay: true` for that offering;
  HTTP 400 ⇒ keep `false`. Both outcomes are valid.

They live outside `core` because the orphan probe needs a binding without
tools and must not count against `core`'s pass/fail.

## The rule: validate the pipe, never the intelligence

Validation is **purely technical/protocol** (design D8). The suite judges whether
the bytes flow correctly — tool fires, schema valid, no 400, `usage` normalised,
reasoning on the right channel, memory carried through. It **never** judges the
model's intelligence or output quality. The canonical illustration: a cat-lover
memory injected, and the model suggests "go and look at 3 tigers" — the memory
*worked mechanically* (it was carried through the protocol and echoed); the model
is merely dumb. That is a weights problem, not a communication problem, and
explicitly not what we judge. This aligns with the anti-censorship stance: we
judge the pipe, never the content.

## How to grow it

When the inference-runner gains a capability, add a `ScenarioTurn` to
`scenarios/core.ts` with **deterministic** assertions for it (and a new pure
`Assertion` in `assertions.ts` if needed). The suite definition is data
(prompts + capability assertions); running it is agent-driven; verdicts stay
mechanical.
