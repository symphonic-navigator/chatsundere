# Agentic Adapter Synthesis — Spike Design

- **Date:** 2026-05-29
- **Status:** Draft (spike)
- **Author:** Liz (Claude Code), brief-led with Chris
- **Package:** `packages/llm-unified` (LGPL-3.0-only)
- **Related:** existing hand-written provider layer (`providers/nano-gpt.ts`,
  `_nano-gpt-pairs.ts`, `streaming.ts`, `transport.ts`), CLAUDE.md §13
  ("Empirical truth over docs")

---

## 1. Context & Motivation

Chatsundere must talk to many upstream providers, each exposing many models
with idiosyncratic wire shapes and behavioural quirks that provider metadata
does not capture:

- Some models stream tool calls incrementally; others return them as a single
  block (the Ollama case).
- Reasoning control varies wildly: `true/false`, `reasoning_effort` with at
  least four distinct semantics (`none/low/medium/high`, `off/normal/xhigh`,
  `max`, token budgets), slug-swapping (`model` vs `model:thinking`), and
  cases where an effort value that contradicts an on/off flag returns HTTP 400.
- "Reasoning off" sometimes means *no reasoning* and sometimes means *hidden
  reasoning*. We refuse the latter as a toggle — a model that only hides its
  thinking is, for us, **always reasoning** (`ReasoningCapability.kind:
  'always_on'`, `types.ts:21`).
- Some legacy models cannot do tool calls and reasoning in the same request.

Provider metadata *usually* gives us context window and base capabilities
(reasoning / tools / vision). It never gives us the behavioural detail above.

**The previous approach — encoding every quirk as hand-maintained static data
— failed.** It drifts, is never complete, and never covers the long tail. The
existing package is exactly that approach: `knownModels` tables
(`nano-gpt.ts:18`), a hand-coded reasoning switch (`_reasoning-body.ts`), and a
provisional slug map that admits it is unverified (`_nano-gpt-pairs.ts:19`).
Concrete evidence that hand-written generic code is insufficient: the generic
SSE parser at `streaming.ts:112` silently drops **streamed** (fragmented)
tool-call arguments, handling only the block case.

**New approach.** When a user adds a not-yet-analysed model, an *analyzer
model* we trust empirically probes the target, then writes a per-model adapter
(JavaScript code plus a declarative profile) that mediates between our
canonical internal API and the chaotic outside world. The adapter is trusted
not because the analyzer asserts correctness, but because it **reproduces real
captured behaviour** under replay validation.

This is the "Chatsundere partly writes itself" idea, made safe and verifiable.

## 2. Goal of Today's Spike

Build the full **agentic synthesis loop** end-to-end as a Bun harness, driven by
a real analyzer model, validated against golden fixtures captured from a real
target model. Prove that an analyzer we trust (GLM-5.1) can produce a *correct*
adapter from documentation plus empirical probe evidence — and that our
validation harness catches it when the adapter is wrong.

This is the **only** scope for today's session (one scope per session).

## 3. Scope Box

**In scope today:**

- The canonical `ModelAdapter` contract (refined from existing types).
- The five-stage synthesis loop: probe → capture → generate → validate →
  self-repair, with a conservative fallback.
- A hand-ported nano-gpt adapter in the new code+profile shape, as a
  known-good baseline to compare the generated adapter against.
- One generated adapter for the real target model, validated against captured
  golden fixtures.
- A Bun harness that runs the whole loop against live nano-gpt.

**Out of scope today (named explicitly):**

- The production isolation boundary (sandboxed iframe in the PWA). Today we use
  a Bun Worker as a *functional stand-in*, not a security boundary.
- UI for reasoning/effort controls (the profile *describes* it; we do not build
  it).
- Adapter sharing, signing, or a seed catalogue.
- Persistence of generated adapters.
- Fixing the `streaming.ts:112` streamed-tool-call bug (hand-written path).
- A second divergent target (Ollama-local, novita). Added once the loop stands.

## 4. The Canonical Adapter Contract

An adapter is a **pure transformation** plus a **declarative profile**:

```ts
interface ModelAdapter {
  // canonical request → upstream wire body
  buildRequest(req: CanonicalRequest): WireRequest;

  // one raw SSE chunk → canonical events, threading parser state
  parseChunk(raw: unknown, state: ParseState): {
    events: StreamChunk[];
    state: ParseState;
  };

  // declarative facts that drive UI and engine behaviour
  readonly profile: ModelProfile;
}
```

Reuse, do not reinvent:

- `StreamChunk` (`types.ts:67`) is already the canonical `parseChunk` output
  (`token` / `reasoning` / `tool-call` / `finish` / `error`).
- `ReasoningIntent` (`types.ts:79`) is the canonical reasoning input.
- `ModelProfile` extends `ReasoningCapability` (`types.ts:20`) with:
  ```ts
  interface ModelProfile {
    reasoning: ReasoningCapability;          // kind, effort buckets, replay, defaultOn
    toolCalls: {
      supported: boolean;
      streaming: boolean;                    // incremental deltas vs single block
      concurrentWithReasoning: boolean;      // both in one request?
    };
    vision: boolean;
    contextWindow: number;
    confidence: 'verified' | 'partial' | 'heuristic';
  }
  ```

`CanonicalRequest` / `WireRequest` / `ParseState` are introduced by this spike
(`adapter-contract.ts`). `ParseState` carries cross-chunk accumulation (e.g.
reassembling fragmented tool-call arguments) so `parseChunk` stays pure.

**Purity is load-bearing.** `buildRequest` and `parseChunk` perform no I/O, touch
no storage, hold no keys. All network I/O is the host's job. A pure,
network-less, storage-less function has no exfiltration channel: the only value
it returns is a wire request bound for the user's own chosen upstream, which
already sees the plaintext legitimately. This is what makes running
analyzer-generated code defensible — and, later, what makes sharing adapters
between instances safe.

Multi-step providers (e.g. create-session-then-stream) are expressed as a host-
driven state machine in a later iteration; not needed for the nano-gpt target.

## 5. The Synthesis Loop

1. **Probe.** The host sends deterministic synthetic prompts to the target via
   live nano-gpt (trusted host code, not generated, non-sensitive prompts).
2. **Capture.** Raw SSE responses are stored verbatim as **golden fixtures** —
   empirical truth, the ground against which everything is validated.
3. **Generate.** The analyzer (`zai-org/glm-5.1:thinking`) receives: provider
   documentation, the captured probe evidence, the `ModelAdapter` contract, and
   the validation-harness spec. It returns an adapter module (code + profile).
4. **Validate.** The host loads the generated module in isolation and replays
   the golden fixtures through it: captured raw chunks → `parseChunk` must yield
   sensible canonical events; canonical requests → `buildRequest` must match the
   wire shape the probes proved the provider accepts.
5. **Self-repair.** On validation failure, the host returns a structured diff of
   expected-vs-actual to the analyzer and iterates (≤ N rounds, e.g. 3). On
   convergence: accept, tag `confidence: 'verified'`. On non-convergence: fall
   back (§7), tag `confidence: 'heuristic'`.

### Probe Suite for the spike target

The probes are designed around the open empirical questions for
`deepseek/deepseek-v4-pro` on nano-gpt:

- **Slug vs flag:** Does `:thinking` vs the bare slug control reasoning
  (confirming/refuting `_nano-gpt-pairs.ts:28`), or is there also a body flag?
- **Effort acceptance:** Does nano-gpt honour `reasoning_effort` for this model
  at all? Which values? Is there a `max` mode (HF claims one)?
- **Off-is-off vs hidden:** Sending `:thinking` with an explicit "do not think"
  signal — in which format (`effort: off`, `effort: none`, `reasoning: false`)
  — does reasoning actually stop, or is it merely hidden? If hidden →
  `kind: 'always_on'`.
- **Tool-call streaming:** Are tool-call arguments delivered incrementally or as
  a block?
- **Reasoning + tools concurrency:** Can both appear in one response?
- **Contradiction handling:** Does a flag/effort contradiction return HTTP 400?

Each probe records the request sent and the raw response (status + body /
stream), so fixtures capture both directions.

## 6. Execution & Safety Model

- **Today (spike):** generated code runs in a **Bun Worker**. The host posts
  `{cmd, payload}` messages; the Worker imports the generated module and calls
  the pure functions. The Worker is a *functional* isolation stand-in — it lets
  us run untrusted-shaped code without it touching the host's scope — but it is
  explicitly **not** the production security boundary. A watchdog terminates the
  Worker on timeout (infinite-loop / resource-abuse containment).
- **Production (future, not today):** sandboxed `<iframe sandbox="allow-scripts">`
  without `allow-same-origin`, communicating via `postMessage`, with no network,
  storage, cookies, or key access. The purity contract (§4) is what makes this
  airtight.

The analyzer never executes generated code; the host does, only after capture.

## 7. Fallback Ladder

1. Model already analysed (cached adapter) → use it. (No cache today; noted.)
2. Analyzer available + validation passes → accept, `confidence: 'verified'`.
3. Validation partially passes after N self-repair rounds → accept verified
   fields, default the rest conservatively, `confidence: 'partial'`.
4. No analyzer available, or non-convergence → hand-written generic
   OpenAI-compatible adapter + safest defaults (hidden→`always_on`,
   tool-calls→assume non-streaming, reasoning+tools→assume not concurrent),
   `confidence: 'heuristic'`. "Best effort, mehr geht halt nicht."

Conservative defaults always choose the option least likely to break a request,
even at the cost of disabling a feature. Per UX principle *disabled over
hidden*: an unverified capability is greyed out with a reason, never silently
offered.

## 8. Concrete Configuration for the Spike

- **Provider:** nano-gpt (`https://nano-gpt.com/api/v1`,
  `shape: 'openai-chat-completions'`).
- **Analyzer model:** `zai-org/glm-5.1:thinking` (strong, stable, fast
  inference, reachable via nano-gpt).
- **Target model:** `deepseek/deepseek-v4-pro:thinking` and
  `deepseek/deepseek-v4-pro` (the two slugs — itself a probe subject).
- **API key:** nano-gpt key supplied via environment (`.env`, never committed),
  reusing the existing `transport.ts` `buildRequest` for host I/O.

## 9. Proposed File Layout

```
packages/llm-unified/src/
├── adapter-contract.ts        # ModelAdapter, CanonicalRequest, WireRequest,
│                              #   ParseState, ModelProfile
├── synthesis/
│   ├── probe-suite.ts         # deterministic probe definitions
│   ├── capture.ts             # run probes via host I/O, persist fixtures
│   ├── analyzer.ts            # build the GLM prompt, call nano-gpt, extract module
│   ├── sandbox-host.ts        # Bun Worker lifecycle + postMessage bridge + watchdog
│   ├── validate.ts            # replay fixtures through a loaded adapter
│   └── loop.ts                # orchestrate the five stages + self-repair
├── adapters/
│   └── nano-gpt-deepseek.baseline.ts   # hand-ported known-good reference
└── fixtures/                  # captured golden SSE evidence (git-tracked)
```

A thin CLI entry (e.g. `bun run synthesise`) drives the loop for a given
provider+model and prints the validation verdict.

## 10. Open Questions & Risks

- **Analyzer reliability.** Can GLM-5.1 produce correct `parseChunk` logic for
  fragmented tool-call reassembly on the first or second pass? Unknown — this is
  the load-bearing question the spike answers.
- **Fixture realism.** Probes must exercise tool calls and reasoning genuinely
  enough that the captured fixtures are representative. Weak probes → adapters
  that pass validation but fail in production.
- **Worker ≠ boundary.** We must not let the spike's convenience harden into a
  false sense of safety; the production iframe boundary is tracked as a separate
  follow-up.
- **Larissa.** `llm-unified` is outside her mandatory mandate, but the execution
  model is squarely her territory once we ship the iframe boundary. Flag for
  review before any generated code runs in the PWA.

## 11. Manual Verification (Chris runs these)

1. `bun run synthesise nano-gpt deepseek/deepseek-v4-pro` completes and prints a
   `confidence: 'verified'` verdict.
2. The captured fixtures under `fixtures/` show the real reasoning/effort and
   tool-call behaviour, and the printed `ModelProfile` matches what the fixtures
   demonstrate (cross-checked by eye — the trust gate).
3. The generated adapter's `parseChunk` reconstructs a streamed tool call from
   fragmented deltas correctly (the thing `streaming.ts:112` gets wrong).
4. Forcing a validation failure (e.g. corrupting a fixture expectation) triggers
   the self-repair loop and, on non-convergence, the heuristic fallback.
