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
  echoed back through the protocol into the reply.

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
