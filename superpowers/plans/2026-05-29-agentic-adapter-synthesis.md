# Agentic Adapter Synthesis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an end-to-end agentic loop in `packages/llm-unified` where a trusted analyzer model (GLM-5.1) empirically probes a target model (DeepSeek V4 Pro via nano-gpt), then writes a per-model adapter (code + profile) that is accepted only after it reproduces real captured behaviour under replay validation.

**Architecture:** Adapters are pure transformations (`buildRequest` + `parseChunk`) plus a declarative `ModelProfile`. The host owns all I/O. The loop is: probe → capture raw SSE fixtures → analyzer generates an adapter module → load it in a Bun Worker (isolation stand-in) → validate against fixtures (structural facts + equivalence to a hand-ported baseline adapter) → self-repair ≤3 rounds → accept (`verified`) or conservative fallback (`heuristic`).

**Tech Stack:** TypeScript (strict), Bun (runtime + test runner + Worker), existing `llm-unified` helpers (`transport.buildRequest`, `runOneShotCompletion`), nano-gpt OpenAI-compatible API.

**Spec:** `superpowers/specs/2026-05-29-agentic-adapter-synthesis-design.md`

**Conventions:** British English everywhere. Commit frequently with free-form imperative messages (no Conventional Commits prefix). Co-author tag `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. Squash into one feature commit at the end. Tests: `bun test` from `packages/llm-unified`. Typecheck: `pnpm --filter @chatsundere/llm-unified typecheck`.

---

## Task 1: Canonical adapter contract

**Files:**
- Create: `packages/llm-unified/src/adapter-contract.ts`
- Test: `packages/llm-unified/src/adapter-contract.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// adapter-contract.test.ts
import { describe, expect, it } from 'bun:test';
import { conservativeProfile } from './adapter-contract.js';

describe('conservativeProfile', () => {
  it('defaults unknown capabilities to the safest, least-breaking choice', () => {
    const p = conservativeProfile({ contextWindow: 200_000, toolsSupported: true });
    expect(p.confidence).toBe('heuristic');
    expect(p.toolCalls.streaming).toBe(false); // assume block — never break a request
    expect(p.toolCalls.concurrentWithReasoning).toBe(false); // assume legacy limitation
    expect(p.reasoning.kind).toBe('always_on'); // hidden-reasoning safe default
    expect(p.vision).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/adapter-contract.test.ts`
Expected: FAIL — `conservativeProfile` is not exported / module missing.

- [ ] **Step 3: Write the contract and helper**

```ts
// adapter-contract.ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { ReasoningCapability, ReasoningIntent, StreamChunk, WireMessage } from './types.js';

/** A single tool the model may call, in the canonical (provider-neutral) form. */
export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

/** What the engine wants, before any per-model wire translation. */
export interface CanonicalRequest {
  messages: WireMessage[];
  reasoning: ReasoningIntent;
  tools?: ToolDef[];
}

/** The upstream-bound request an adapter produces: a model slug plus a JSON body. */
export interface WireRequest {
  model: string;
  body: Record<string, unknown>;
}

/**
 * Parser state threaded across `parseChunk` calls. MUST be a plain
 * JSON-serialisable object — it crosses the Worker/postMessage boundary.
 * Adapters use it to reassemble fragmented streamed tool calls.
 */
export type ParseState = Record<string, unknown>;

/** Declarative facts that drive UI and engine behaviour. */
export interface ModelProfile {
  reasoning: ReasoningCapability;
  toolCalls: {
    supported: boolean;
    streaming: boolean;
    concurrentWithReasoning: boolean;
  };
  vision: boolean;
  contextWindow: number;
  confidence: 'verified' | 'partial' | 'heuristic';
}

/** The pure transformation contract every adapter implements. */
export interface ModelAdapter {
  buildRequest(req: CanonicalRequest): WireRequest;
  parseChunk(raw: unknown, state: ParseState): { events: StreamChunk[]; state: ParseState };
  readonly profile: ModelProfile;
}

/**
 * Build a `ModelProfile` for the fallback case: every unverified capability
 * takes the safest, least-breaking value. Per UX *disabled over hidden*, an
 * unverified capability is later greyed out rather than offered.
 */
export function conservativeProfile(base: {
  contextWindow: number;
  toolsSupported: boolean;
}): ModelProfile {
  return {
    reasoning: { kind: 'always_on', defaultOn: true, replayReasoning: true },
    toolCalls: {
      supported: base.toolsSupported,
      streaming: false,
      concurrentWithReasoning: false,
    },
    vision: false,
    contextWindow: base.contextWindow,
    confidence: 'heuristic',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/adapter-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/adapter-contract.ts packages/llm-unified/src/adapter-contract.test.ts
git commit -m "Add canonical adapter contract and conservative fallback profile"
```

---

## Task 2: SSE framing host helper

The host frames the raw SSE byte/text stream into JSON delta objects. Model-specific *interpretation* of those objects is the adapter's job (`parseChunk`); framing is provider-generic and stays host-side.

**Files:**
- Create: `packages/llm-unified/src/synthesis/sse-framing.ts`
- Test: `packages/llm-unified/src/synthesis/sse-framing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// sse-framing.test.ts
import { describe, expect, it } from 'bun:test';
import { frameSse } from './sse-framing.js';

describe('frameSse', () => {
  it('extracts JSON payloads, skipping comments, blanks and [DONE]', () => {
    const raw = [
      ': keep-alive comment',
      'data: {"choices":[{"delta":{"content":"hi"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":" there"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    const out = frameSse(raw);
    expect(out).toEqual([
      { choices: [{ delta: { content: 'hi' } }] },
      { choices: [{ delta: { content: ' there' } }] },
    ]);
  });

  it('throws on a malformed JSON payload so capture flaws surface loudly', () => {
    expect(() => frameSse('data: {not json}\n\n')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/synthesis/sse-framing.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// sse-framing.ts
// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Frame a raw OpenAI-compatible SSE response body into its JSON delta
 * payloads. Comments (`:`-prefixed), blank lines and the `[DONE]` terminator
 * are dropped. Unlike the live parser this operates on a complete captured
 * string (fixtures are captured whole), so there is no split-chunk handling.
 * Malformed payloads throw — a corrupt fixture must fail loudly, not silently
 * vanish.
 */
export function frameSse(raw: string): unknown[] {
  const out: unknown[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trimEnd();
    if (trimmed === '' || trimmed.startsWith(':')) continue;
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trimStart();
    if (data === '[DONE]') continue;
    out.push(JSON.parse(data));
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/synthesis/sse-framing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/synthesis/sse-framing.ts packages/llm-unified/src/synthesis/sse-framing.test.ts
git commit -m "Add SSE framing host helper for fixture replay"
```

---

## Task 3: Hand-ported baseline adapter (the known-good oracle)

This adapter is both a deliverable and the validation oracle. Its `parseChunk` correctly reassembles fragmented streamed tool calls — the case `streaming.ts:112` gets wrong.

**Files:**
- Create: `packages/llm-unified/src/adapters/nano-gpt-deepseek.baseline.ts`
- Test: `packages/llm-unified/src/adapters/nano-gpt-deepseek.baseline.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// nano-gpt-deepseek.baseline.test.ts
import { describe, expect, it } from 'bun:test';
import type { ParseState } from '../adapter-contract.js';
import { deepseekBaselineAdapter as a } from './nano-gpt-deepseek.baseline.js';

describe('baseline buildRequest', () => {
  it('swaps to the :thinking slug when reasoning is enabled', () => {
    const wire = a.buildRequest({
      messages: [{ role: 'user', content: 'hi' }],
      reasoning: { enabled: true, effort: 'high' },
    });
    expect(wire.model).toBe('deepseek/deepseek-v4-pro:thinking');
    expect(wire.body.reasoning_effort).toBe('high');
    expect(wire.body.stream).toBe(true);
  });

  it('uses the bare slug and omits effort when reasoning is disabled', () => {
    const wire = a.buildRequest({
      messages: [{ role: 'user', content: 'hi' }],
      reasoning: { enabled: false },
    });
    expect(wire.model).toBe('deepseek/deepseek-v4-pro');
    expect(wire.body.reasoning_effort).toBeUndefined();
  });
});

describe('baseline parseChunk reassembles a fragmented streamed tool call', () => {
  it('emits one complete tool-call after arguments arrive across deltas', () => {
    const deltas: unknown[] = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Wien"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ];
    let state: ParseState = {};
    const events = [];
    for (const d of deltas) {
      const r = a.parseChunk(d, state);
      state = r.state;
      events.push(...r.events);
    }
    const toolCall = events.find((e) => e.type === 'tool-call');
    expect(toolCall).toEqual({
      type: 'tool-call',
      toolCallId: 'call_1',
      name: 'get_weather',
      argumentsJson: '{"city":"Wien"}',
    });
    expect(events.at(-1)).toEqual({ type: 'finish', reason: 'tool_calls' });
  });

  it('emits reasoning before content within a delta', () => {
    const r = a.parseChunk(
      { choices: [{ delta: { reasoning: 'let me think', content: 'answer' } }] },
      {},
    );
    expect(r.events).toEqual([
      { type: 'reasoning', text: 'let me think' },
      { type: 'token', text: 'answer' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/adapters/nano-gpt-deepseek.baseline.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// nano-gpt-deepseek.baseline.ts
// SPDX-License-Identifier: LGPL-3.0-only
import type {
  CanonicalRequest,
  ModelAdapter,
  ModelProfile,
  ParseState,
  WireRequest,
} from '../adapter-contract.js';
import type { StreamChunk } from '../types.js';

const PROFILE: ModelProfile = {
  reasoning: {
    kind: 'optional',
    effort: { buckets: ['low', 'medium', 'high'], defaultBucket: 'medium' },
    defaultOn: true,
    replayReasoning: false,
  },
  toolCalls: { supported: true, streaming: true, concurrentWithReasoning: true },
  vision: false,
  contextWindow: 200_000,
  confidence: 'verified',
};

/** Accumulator for one fragmented tool call, keyed by its stream index. */
interface PendingToolCall {
  id: string;
  name: string;
  args: string;
}

function getPending(state: ParseState): Record<string, PendingToolCall> {
  if (!state.toolCalls) state.toolCalls = {};
  return state.toolCalls as Record<string, PendingToolCall>;
}

interface Delta {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'unknown';

function normaliseFinish(reason: string): FinishReason {
  switch (reason) {
    case 'stop':
    case 'length':
    case 'tool_calls':
    case 'content_filter':
      return reason;
    default:
      return 'unknown';
  }
}

export const deepseekBaselineAdapter: ModelAdapter = {
  profile: PROFILE,

  buildRequest(req: CanonicalRequest): WireRequest {
    const thinking = req.reasoning.enabled;
    const model = thinking ? 'deepseek/deepseek-v4-pro:thinking' : 'deepseek/deepseek-v4-pro';
    const body: Record<string, unknown> = {
      model,
      messages: req.messages,
      stream: true,
    };
    if (thinking && req.reasoning.effort) body.reasoning_effort = req.reasoning.effort;
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    return { model, body };
  },

  parseChunk(raw: unknown, state: ParseState): { events: StreamChunk[]; state: ParseState } {
    const choice = (raw as Delta).choices?.[0];
    const events: StreamChunk[] = [];
    if (!choice) return { events, state };

    const reasoning = (choice.delta?.reasoning ?? '') + (choice.delta?.reasoning_content ?? '');
    if (reasoning) events.push({ type: 'reasoning', text: reasoning });
    if (choice.delta?.content) events.push({ type: 'token', text: choice.delta.content });

    const pending = getPending(state);
    for (const tc of choice.delta?.tool_calls ?? []) {
      const key = String(tc.index ?? 0);
      const acc = pending[key] ?? { id: '', name: '', args: '' };
      if (tc.id) acc.id = tc.id;
      if (tc.function?.name) acc.name = tc.function.name;
      if (typeof tc.function?.arguments === 'string') acc.args += tc.function.arguments;
      pending[key] = acc;
    }

    if (choice.finish_reason) {
      // On finish, flush every accumulated tool call as a complete chunk.
      for (const acc of Object.values(pending)) {
        if (acc.id && acc.name) {
          events.push({
            type: 'tool-call',
            toolCallId: acc.id,
            name: acc.name,
            argumentsJson: acc.args,
          });
        }
      }
      state.toolCalls = {};
      events.push({ type: 'finish', reason: normaliseFinish(choice.finish_reason) });
    }
    return { events, state };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/adapters/nano-gpt-deepseek.baseline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/adapters/nano-gpt-deepseek.baseline.ts packages/llm-unified/src/adapters/nano-gpt-deepseek.baseline.test.ts
git commit -m "Add hand-ported DeepSeek baseline adapter with streamed tool-call reassembly"
```

---

## Task 4: Observed-profile derivation (the empirical heart)

Turn captured fixtures into observed capability facts — Chris's four questions, decided by evidence not guesswork.

**Files:**
- Create: `packages/llm-unified/src/synthesis/fixture-types.ts`
- Create: `packages/llm-unified/src/synthesis/derive-profile.ts`
- Test: `packages/llm-unified/src/synthesis/derive-profile.test.ts`

- [ ] **Step 1: Define fixture types (no test — pure types)**

```ts
// fixture-types.ts
// SPDX-License-Identifier: LGPL-3.0-only

/** The dimension a probe is designed to reveal. */
export type ProbeDimension =
  | 'reasoning-on'
  | 'reasoning-off'
  | 'effort-high'
  | 'effort-max'
  | 'tool-call'
  | 'reasoning-and-tools'
  | 'contradiction';

/** One probe: the dimension under test and the exact raw body to POST. */
export interface Probe {
  id: string;
  dimension: ProbeDimension;
  body: Record<string, unknown>;
}

/** What came back when a probe was run live. */
export interface CapturedFixture {
  probeId: string;
  dimension: ProbeDimension;
  requestBody: Record<string, unknown>;
  status: number;
  /** Raw response body verbatim — SSE text for 2xx streams, JSON/text for errors. */
  rawResponse: string;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// derive-profile.test.ts
import { describe, expect, it } from 'bun:test';
import { deriveObservedProfile } from './derive-profile.js';
import type { CapturedFixture } from './fixture-types.js';

function sse(...deltas: object[]): string {
  return `${deltas.map((d) => `data: ${JSON.stringify(d)}`).join('\n\n')}\n\ndata: [DONE]\n\n`;
}

describe('deriveObservedProfile', () => {
  it('flags always_on when reasoning-off still emits reasoning', () => {
    const fixtures: CapturedFixture[] = [
      {
        probeId: 'off', dimension: 'reasoning-off', requestBody: {}, status: 200,
        rawResponse: sse({ choices: [{ delta: { reasoning: 'still thinking' } }] }),
      },
    ];
    expect(deriveObservedProfile(fixtures).reasoningKind).toBe('always_on');
  });

  it('reports streaming tool calls when arguments arrive across >1 delta', () => {
    const fixtures: CapturedFixture[] = [
      {
        probeId: 'tc', dimension: 'tool-call', requestBody: {}, status: 200,
        rawResponse: sse(
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'f', arguments: '{"a":' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] } }] },
        ),
      },
    ];
    const p = deriveObservedProfile(fixtures);
    expect(p.toolCallsStreaming).toBe(true);
    expect(p.toolCallsSupported).toBe(true);
  });

  it('detects concurrency when one response has both reasoning and a tool call', () => {
    const fixtures: CapturedFixture[] = [
      {
        probeId: 'rt', dimension: 'reasoning-and-tools', requestBody: {}, status: 200,
        rawResponse: sse(
          { choices: [{ delta: { reasoning: 'hmm' } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'f', arguments: '{}' } }] } }] },
        ),
      },
    ];
    expect(deriveObservedProfile(fixtures).concurrentWithReasoning).toBe(true);
  });

  it('records effort-max acceptance from the status code', () => {
    const fixtures: CapturedFixture[] = [
      { probeId: 'max', dimension: 'effort-max', requestBody: {}, status: 400, rawResponse: '{"error":"unknown effort"}' },
    ];
    expect(deriveObservedProfile(fixtures).effortMaxAccepted).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/synthesis/derive-profile.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement**

```ts
// derive-profile.ts
// SPDX-License-Identifier: LGPL-3.0-only
import { frameSse } from './sse-framing.js';
import type { CapturedFixture, ProbeDimension } from './fixture-types.js';

export interface ObservedFacts {
  reasoningKind: 'no_reasoning' | 'optional' | 'always_on';
  toolCallsSupported: boolean;
  toolCallsStreaming: boolean;
  concurrentWithReasoning: boolean;
  effortMaxAccepted: boolean;
}

function deltasOf(fixtures: CapturedFixture[], dim: ProbeDimension): unknown[][] {
  return fixtures
    .filter((f) => f.dimension === dim && f.status === 200)
    .map((f) => frameSse(f.rawResponse));
}

function hasReasoning(deltas: unknown[]): boolean {
  return deltas.some((d) => {
    const delta = (d as { choices?: Array<{ delta?: { reasoning?: unknown; reasoning_content?: unknown } }> }).choices?.[0]?.delta;
    return Boolean(delta?.reasoning || delta?.reasoning_content);
  });
}

function toolCallArgDeltaCount(deltas: unknown[]): number {
  let count = 0;
  for (const d of deltas) {
    const tcs = (d as { choices?: Array<{ delta?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }> }).choices?.[0]?.delta?.tool_calls;
    for (const tc of tcs ?? []) if (typeof tc.function?.arguments === 'string') count += 1;
  }
  return count;
}

/**
 * Reduce captured fixtures to observed capability facts. Empirical truth:
 *  - reasoning-off that still emits reasoning ⇒ always_on (we refuse the
 *    "hidden reasoning" toggle; for us the model is simply always reasoning).
 *  - tool-call arguments spread across >1 delta ⇒ streaming tool calls.
 *  - a single response carrying both reasoning and a tool call ⇒ concurrency.
 *  - effort-max acceptance is read from the probe's HTTP status.
 */
export function deriveObservedProfile(fixtures: CapturedFixture[]): ObservedFacts {
  const offEmitsReasoning = deltasOf(fixtures, 'reasoning-off').some(hasReasoning);
  const onEmitsReasoning = deltasOf(fixtures, 'reasoning-on').some(hasReasoning);

  let reasoningKind: ObservedFacts['reasoningKind'] = 'no_reasoning';
  if (offEmitsReasoning) reasoningKind = 'always_on';
  else if (onEmitsReasoning) reasoningKind = 'optional';

  const toolDeltas = deltasOf(fixtures, 'tool-call');
  const toolCallsSupported = toolDeltas.some((d) => toolCallArgDeltaCount(d) > 0);
  const toolCallsStreaming = toolDeltas.some((d) => toolCallArgDeltaCount(d) > 1);

  const concurrentWithReasoning = deltasOf(fixtures, 'reasoning-and-tools').some(
    (d) => hasReasoning(d) && toolCallArgDeltaCount(d) > 0,
  );

  const effortMaxAccepted = fixtures
    .filter((f) => f.dimension === 'effort-max')
    .every((f) => f.status >= 200 && f.status < 300);

  return {
    reasoningKind,
    toolCallsSupported,
    toolCallsStreaming,
    concurrentWithReasoning,
    effortMaxAccepted: effortMaxAccepted && fixtures.some((f) => f.dimension === 'effort-max'),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/synthesis/derive-profile.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/llm-unified/src/synthesis/fixture-types.ts packages/llm-unified/src/synthesis/derive-profile.ts packages/llm-unified/src/synthesis/derive-profile.test.ts
git commit -m "Add observed-profile derivation from captured fixtures"
```

---

## Task 5: Probe suite

**Files:**
- Create: `packages/llm-unified/src/synthesis/probe-suite.ts`
- Test: `packages/llm-unified/src/synthesis/probe-suite.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// probe-suite.test.ts
import { describe, expect, it } from 'bun:test';
import { buildProbeSuite } from './probe-suite.js';

describe('buildProbeSuite', () => {
  it('covers every behavioural dimension for the target', () => {
    const probes = buildProbeSuite({
      thinkingSlug: 'deepseek/deepseek-v4-pro:thinking',
      bareSlug: 'deepseek/deepseek-v4-pro',
    });
    const dims = new Set(probes.map((p) => p.dimension));
    expect(dims).toEqual(
      new Set(['reasoning-on', 'reasoning-off', 'effort-high', 'effort-max', 'tool-call', 'reasoning-and-tools', 'contradiction']),
    );
  });

  it('sends the bare slug with reasoning:false for the reasoning-off probe', () => {
    const probes = buildProbeSuite({ thinkingSlug: 't', bareSlug: 'b' });
    const off = probes.find((p) => p.dimension === 'reasoning-off');
    expect(off?.body.model).toBe('b');
    expect(off?.body.reasoning).toBe(false);
    expect(off?.body.stream).toBe(true);
  });

  it('attaches a tool schema to the tool-call probe', () => {
    const probes = buildProbeSuite({ thinkingSlug: 't', bareSlug: 'b' });
    const tc = probes.find((p) => p.dimension === 'tool-call');
    expect(Array.isArray(tc?.body.tools)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/synthesis/probe-suite.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// probe-suite.ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { Probe } from './fixture-types.js';

export interface SlugPair {
  thinkingSlug: string;
  bareSlug: string;
}

const WEATHER_TOOL = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Get the current weather for a city.',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
};

const userMsg = (content: string) => [{ role: 'user', content }];

/**
 * Deterministic probe suite for a nano-gpt slug-pair model. Each probe sends a
 * synthetic (non-sensitive) prompt designed to reveal one behavioural
 * dimension. The reasoning-off probe deliberately combines the thinking-capable
 * path with an explicit suppression signal to test whether "off" is real.
 */
export function buildProbeSuite(slugs: SlugPair): Probe[] {
  const base = { stream: true } as const;
  return [
    {
      id: 'reasoning-on', dimension: 'reasoning-on',
      body: { ...base, model: slugs.thinkingSlug, messages: userMsg('What is 17 * 23? Think it through.') },
    },
    {
      id: 'reasoning-off', dimension: 'reasoning-off',
      body: { ...base, model: slugs.bareSlug, reasoning: false, messages: userMsg('Reply with only the word OK.') },
    },
    {
      id: 'effort-high', dimension: 'effort-high',
      body: { ...base, model: slugs.thinkingSlug, reasoning_effort: 'high', messages: userMsg('Prove sqrt(2) is irrational.') },
    },
    {
      id: 'effort-max', dimension: 'effort-max',
      body: { ...base, model: slugs.thinkingSlug, reasoning_effort: 'max', messages: userMsg('Prove sqrt(2) is irrational.') },
    },
    {
      id: 'tool-call', dimension: 'tool-call',
      body: { ...base, model: slugs.bareSlug, tools: [WEATHER_TOOL], messages: userMsg('What is the weather in Vienna?') },
    },
    {
      id: 'reasoning-and-tools', dimension: 'reasoning-and-tools',
      body: { ...base, model: slugs.thinkingSlug, tools: [WEATHER_TOOL], messages: userMsg('Think, then check the weather in Vienna.') },
    },
    {
      id: 'contradiction', dimension: 'contradiction',
      body: { ...base, model: slugs.bareSlug, reasoning: false, reasoning_effort: 'high', messages: userMsg('Hello.') },
    },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/synthesis/probe-suite.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/synthesis/probe-suite.ts packages/llm-unified/src/synthesis/probe-suite.test.ts
git commit -m "Add deterministic probe suite for nano-gpt slug-pair models"
```

---

## Task 6: Capture (probe runner with injected fetch)

**Files:**
- Create: `packages/llm-unified/src/synthesis/capture.ts`
- Test: `packages/llm-unified/src/synthesis/capture.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// capture.test.ts
import { describe, expect, it } from 'bun:test';
import { runProbe } from './capture.js';
import type { Probe } from './fixture-types.js';

const probe: Probe = { id: 'p', dimension: 'reasoning-on', body: { model: 'm', messages: [] } };

describe('runProbe', () => {
  it('captures status and raw body verbatim', async () => {
    const fetchFn = async () => new Response('data: {"x":1}\n\ndata: [DONE]\n\n', { status: 200 });
    const fx = await runProbe({
      baseUrl: 'https://nano-gpt.com/api/v1', apiKey: 'k', probe, fetchFn,
    });
    expect(fx.status).toBe(200);
    expect(fx.rawResponse).toContain('"x":1');
    expect(fx.requestBody).toEqual({ model: 'm', messages: [] });
    expect(fx.dimension).toBe('reasoning-on');
  });

  it('captures error bodies without throwing', async () => {
    const fetchFn = async () => new Response('{"error":"bad effort"}', { status: 400 });
    const fx = await runProbe({ baseUrl: 'b', apiKey: 'k', probe, fetchFn });
    expect(fx.status).toBe(400);
    expect(fx.rawResponse).toContain('bad effort');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/synthesis/capture.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// capture.ts
// SPDX-License-Identifier: LGPL-3.0-only
import { buildRequest } from '../transport.js';
import type { CapturedFixture, Probe } from './fixture-types.js';

export interface RunProbeArgs {
  baseUrl: string;
  apiKey: string;
  probe: Probe;
  fetchFn?: typeof fetch;
}

/**
 * Run one probe against the provider and capture the raw response verbatim.
 * Never throws on upstream errors — a 4xx/5xx is itself evidence (e.g. the
 * contradiction probe expects a 400). Uses the existing direct-routing
 * transport; no CORS proxy from the CLI.
 */
export async function runProbe(args: RunProbeArgs): Promise<CapturedFixture> {
  const fetchFn = args.fetchFn ?? globalThis.fetch.bind(globalThis);
  const request = buildRequest({
    provider: { baseUrl: args.baseUrl, routing: { kind: 'direct' } },
    apiKey: args.apiKey,
    corsProxyUrl: null,
    corsProxyKey: null,
    path: '/chat/completions',
    method: 'POST',
    body: args.probe.body,
  });
  const response = await fetchFn(request);
  const rawResponse = await response.text();
  return {
    probeId: args.probe.id,
    dimension: args.probe.dimension,
    requestBody: args.probe.body,
    status: response.status,
    rawResponse,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/synthesis/capture.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/synthesis/capture.ts packages/llm-unified/src/synthesis/capture.test.ts
git commit -m "Add probe capture runner with verbatim raw-response storage"
```

---

## Task 7: Sandbox host (Bun Worker isolation stand-in)

Load an adapter module in a Worker and expose its pure functions over `postMessage`, with a watchdog timeout. This rehearses the production iframe `postMessage` contract.

**Files:**
- Create: `packages/llm-unified/src/synthesis/_worker-entry.ts`
- Create: `packages/llm-unified/src/synthesis/sandbox-host.ts`
- Test: `packages/llm-unified/src/synthesis/sandbox-host.test.ts`

- [ ] **Step 1: Write the worker entry (no direct test — exercised via the host test)**

```ts
// _worker-entry.ts
// SPDX-License-Identifier: LGPL-3.0-only
// Runs inside a Bun Worker. Imports an adapter module by path (first message),
// then answers buildRequest / parseChunk calls. No network, no storage access
// is granted to or used by this entry — the adapter is a pure transformation.
declare const self: Worker;

let adapter: {
  buildRequest: (req: unknown) => unknown;
  parseChunk: (raw: unknown, state: unknown) => unknown;
  profile: unknown;
} | null = null;

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { id: number; cmd: string; modulePath?: string; arg1?: unknown; arg2?: unknown };
  try {
    if (msg.cmd === 'init') {
      const mod = await import(msg.modulePath as string);
      adapter = mod.adapter ?? mod.default;
      self.postMessage({ id: msg.id, ok: true, result: adapter?.profile });
      return;
    }
    if (!adapter) throw new Error('adapter not initialised');
    if (msg.cmd === 'buildRequest') {
      self.postMessage({ id: msg.id, ok: true, result: adapter.buildRequest(msg.arg1) });
      return;
    }
    if (msg.cmd === 'parseChunk') {
      self.postMessage({ id: msg.id, ok: true, result: adapter.parseChunk(msg.arg1, msg.arg2) });
      return;
    }
    throw new Error(`unknown cmd ${msg.cmd}`);
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: (err as Error).message });
  }
};
```

- [ ] **Step 2: Write the failing test**

```ts
// sandbox-host.test.ts
import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { loadAdapterInSandbox } from './sandbox-host.js';

const baselinePath = resolve(import.meta.dir, '../adapters/nano-gpt-deepseek.baseline.sandbox.ts');

describe('loadAdapterInSandbox', () => {
  it('round-trips buildRequest through the worker boundary', async () => {
    const handle = await loadAdapterInSandbox(baselinePath);
    const wire = await handle.buildRequest({
      messages: [{ role: 'user', content: 'hi' }],
      reasoning: { enabled: true, effort: 'high' },
    });
    expect((wire as { model: string }).model).toBe('deepseek/deepseek-v4-pro:thinking');
    handle.dispose();
  });

  it('terminates a runaway module via the watchdog', async () => {
    const runawayPath = resolve(import.meta.dir, '__fixtures__/runaway-adapter.ts');
    const handle = await loadAdapterInSandbox(runawayPath, { timeoutMs: 200 });
    await expect(handle.buildRequest({ messages: [], reasoning: { enabled: false } })).rejects.toThrow(/timed out/);
    handle.dispose();
  });
});
```

- [ ] **Step 3: Create the two test support modules**

```ts
// adapters/nano-gpt-deepseek.baseline.sandbox.ts
// SPDX-License-Identifier: LGPL-3.0-only
// Worker-loadable wrapper: re-exports the baseline adapter under the name the
// worker entry expects (`adapter`).
import { deepseekBaselineAdapter } from './nano-gpt-deepseek.baseline.js';
export const adapter = deepseekBaselineAdapter;
```

```ts
// synthesis/__fixtures__/runaway-adapter.ts
// SPDX-License-Identifier: LGPL-3.0-only
export const adapter = {
  buildRequest() {
    while (true) { /* deliberate infinite loop for the watchdog test */ }
  },
  parseChunk(_raw: unknown, state: unknown) {
    return { events: [], state };
  },
  profile: {},
};
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/synthesis/sandbox-host.test.ts`
Expected: FAIL — `loadAdapterInSandbox` missing.

- [ ] **Step 5: Implement the host**

```ts
// sandbox-host.ts
// SPDX-License-Identifier: LGPL-3.0-only
import { resolve } from 'node:path';
import type { CanonicalRequest, ParseState, WireRequest } from '../adapter-contract.js';
import type { StreamChunk } from '../types.js';

export interface AdapterHandle {
  profile: unknown;
  buildRequest(req: CanonicalRequest): Promise<WireRequest>;
  parseChunk(raw: unknown, state: ParseState): Promise<{ events: StreamChunk[]; state: ParseState }>;
  dispose(): void;
}

export interface SandboxOpts {
  timeoutMs?: number;
}

const WORKER_ENTRY = resolve(import.meta.dir, '_worker-entry.ts');

/**
 * Load an adapter module inside a Bun Worker and expose its pure functions over
 * postMessage. The Worker is a functional isolation stand-in for the spike —
 * NOT the production security boundary (that is a sandboxed iframe). Each call
 * is guarded by a watchdog that terminates the Worker on timeout, containing
 * infinite loops / resource abuse to the capsule.
 */
export async function loadAdapterInSandbox(
  modulePath: string,
  opts: SandboxOpts = {},
): Promise<AdapterHandle> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const worker = new Worker(WORKER_ENTRY);
  let nextId = 1;
  let terminated = false;

  const call = <T>(cmd: string, payload: Record<string, unknown>): Promise<T> => {
    const id = nextId++;
    return new Promise<T>((resolvePromise, reject) => {
      if (terminated) {
        reject(new Error('sandbox already disposed'));
        return;
      }
      const timer = setTimeout(() => {
        terminated = true;
        worker.terminate();
        reject(new Error(`adapter ${cmd} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const onMessage = (e: MessageEvent) => {
        const data = e.data as { id: number; ok: boolean; result?: unknown; error?: string };
        if (data.id !== id) return;
        clearTimeout(timer);
        worker.removeEventListener('message', onMessage);
        if (data.ok) resolvePromise(data.result as T);
        else reject(new Error(data.error ?? 'sandbox error'));
      };
      worker.addEventListener('message', onMessage);
      worker.postMessage({ id, cmd, ...payload });
    });
  };

  const profile = await call<unknown>('init', { modulePath });

  return {
    profile,
    buildRequest: (req) => call<WireRequest>('buildRequest', { arg1: req }),
    parseChunk: (raw, state) =>
      call<{ events: StreamChunk[]; state: ParseState }>('parseChunk', { arg1: raw, arg2: state }),
    dispose: () => {
      terminated = true;
      worker.terminate();
    },
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/synthesis/sandbox-host.test.ts`
Expected: PASS (both round-trip and watchdog).

- [ ] **Step 7: Commit**

```bash
git add packages/llm-unified/src/synthesis/_worker-entry.ts packages/llm-unified/src/synthesis/sandbox-host.ts packages/llm-unified/src/synthesis/sandbox-host.test.ts packages/llm-unified/src/adapters/nano-gpt-deepseek.baseline.sandbox.ts packages/llm-unified/src/synthesis/__fixtures__/runaway-adapter.ts
git commit -m "Add Bun Worker sandbox host with watchdog for adapter execution"
```

---

## Task 8: Validate (structural facts + baseline equivalence)

**Files:**
- Create: `packages/llm-unified/src/synthesis/validate.ts`
- Test: `packages/llm-unified/src/synthesis/validate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// validate.test.ts
import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { loadAdapterInSandbox } from './sandbox-host.js';
import { validateAdapter } from './validate.js';
import type { CapturedFixture } from './fixture-types.js';

const baselinePath = resolve(import.meta.dir, '../adapters/nano-gpt-deepseek.baseline.sandbox.ts');

function sse(...deltas: object[]): string {
  return `${deltas.map((d) => `data: ${JSON.stringify(d)}`).join('\n\n')}\n\ndata: [DONE]\n\n`;
}

const toolFixture: CapturedFixture = {
  probeId: 'tool-call', dimension: 'tool-call', requestBody: {}, status: 200,
  rawResponse: sse(
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'get_weather', arguments: '{"city":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Wien"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ),
};

describe('validateAdapter', () => {
  it('passes when the candidate reproduces the baseline on the fixtures', async () => {
    const candidate = await loadAdapterInSandbox(baselinePath);
    const baseline = await loadAdapterInSandbox(baselinePath);
    const verdict = await validateAdapter({ candidate, baseline, fixtures: [toolFixture] });
    expect(verdict.passed).toBe(true);
    expect(verdict.failures).toHaveLength(0);
    candidate.dispose();
    baseline.dispose();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/synthesis/validate.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// validate.ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { ParseState } from '../adapter-contract.js';
import type { StreamChunk } from '../types.js';
import type { AdapterHandle } from './sandbox-host.js';
import { frameSse } from './sse-framing.js';
import type { CapturedFixture } from './fixture-types.js';

export interface Verdict {
  passed: boolean;
  failures: string[];
}

export interface ValidateArgs {
  candidate: AdapterHandle;
  baseline: AdapterHandle;
  fixtures: CapturedFixture[];
}

async function replay(handle: AdapterHandle, deltas: unknown[]): Promise<StreamChunk[]> {
  let state: ParseState = {};
  const events: StreamChunk[] = [];
  for (const d of deltas) {
    const r = await handle.parseChunk(d, state);
    state = r.state;
    events.push(...r.events);
  }
  return events;
}

/**
 * Replay each successful fixture through both the candidate (generated) and
 * baseline (hand-ported, known-good) adapters and require event-for-event
 * equivalence. Divergence means the generated adapter is wrong — the strongest
 * oracle available for the spike, and a direct hand-vs-AI comparison.
 */
export async function validateAdapter(args: ValidateArgs): Promise<Verdict> {
  const failures: string[] = [];
  for (const fx of args.fixtures) {
    if (fx.status !== 200) continue;
    const deltas = frameSse(fx.rawResponse);
    const candidateEvents = await replay(args.candidate, deltas);
    const baselineEvents = await replay(args.baseline, deltas);
    if (JSON.stringify(candidateEvents) !== JSON.stringify(baselineEvents)) {
      failures.push(
        `Fixture ${fx.probeId}: candidate events diverge from baseline.\n` +
          `  baseline:  ${JSON.stringify(baselineEvents)}\n` +
          `  candidate: ${JSON.stringify(candidateEvents)}`,
      );
    }
  }
  return { passed: failures.length === 0, failures };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/synthesis/validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/synthesis/validate.ts packages/llm-unified/src/synthesis/validate.test.ts
git commit -m "Add replay validation comparing candidate adapter to baseline"
```

---

## Task 9: Analyzer (prompt building + code extraction)

**Files:**
- Create: `packages/llm-unified/src/synthesis/analyzer.ts`
- Test: `packages/llm-unified/src/synthesis/analyzer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// analyzer.test.ts
import { describe, expect, it } from 'bun:test';
import { buildAnalyzerPrompt, extractAdapterModule } from './analyzer.js';
import type { CapturedFixture } from './fixture-types.js';

const fixtures: CapturedFixture[] = [
  { probeId: 'reasoning-on', dimension: 'reasoning-on', requestBody: { model: 't' }, status: 200, rawResponse: 'data: {"choices":[{"delta":{"reasoning":"x"}}]}\n\n' },
];

describe('buildAnalyzerPrompt', () => {
  it('embeds the contract, the fixtures and an explicit single-code-block instruction', () => {
    const prompt = buildAnalyzerPrompt({ contract: 'CONTRACT_TEXT', providerDocs: 'DOCS', fixtures });
    expect(prompt).toContain('CONTRACT_TEXT');
    expect(prompt).toContain('reasoning-on');
    expect(prompt).toContain('"reasoning":"x"');
    expect(prompt.toLowerCase()).toContain('single');
  });
});

describe('extractAdapterModule', () => {
  it('pulls the fenced code block from the model reply', () => {
    const reply = 'Here you go:\n```ts\nexport const adapter = {};\n```\nDone.';
    expect(extractAdapterModule(reply)).toBe('export const adapter = {};');
  });

  it('throws when no code block is present', () => {
    expect(() => extractAdapterModule('no code here')).toThrow(/no code block/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/synthesis/analyzer.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// analyzer.ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { CapturedFixture } from './fixture-types.js';

export interface PromptArgs {
  contract: string;
  providerDocs: string;
  fixtures: CapturedFixture[];
  /** Validation failures from a previous round, for self-repair. */
  priorFailures?: string[];
}

/**
 * Build the analyzer prompt. The model is given the canonical contract, the
 * provider documentation and — crucially — the REAL captured probe evidence,
 * and must return exactly one fenced code block exporting `adapter`
 * (buildRequest + parseChunk + profile). Empirical evidence over docs.
 */
export function buildAnalyzerPrompt(args: PromptArgs): string {
  const fixtureBlock = args.fixtures
    .map(
      (f) =>
        `### Probe ${f.probeId} (${f.dimension}) → HTTP ${f.status}\n` +
        `Request body: ${JSON.stringify(f.requestBody)}\n` +
        `Raw response:\n${f.rawResponse}`,
    )
    .join('\n\n');

  const repair = args.priorFailures?.length
    ? `\n\n## Previous attempt FAILED validation. Fix these and try again:\n${args.priorFailures.join('\n')}`
    : '';

  return `You are writing a per-model adapter for an LLM gateway. It must mediate
between our canonical internal API and this specific model's real wire
behaviour, which you can see in the captured evidence below.

## Canonical contract (TypeScript)
${args.contract}

## Provider documentation
${args.providerDocs}

## Captured probe evidence (ground truth — trust this over the docs)
${fixtureBlock}

## Your task
Return EXACTLY ONE fenced TypeScript code block and nothing else of substance.
The block must \`export const adapter\` implementing the ModelAdapter contract:
a pure \`buildRequest\`, a pure \`parseChunk\` that correctly reassembles
fragmented streamed tool calls across deltas, and a \`profile\` whose fields
match what the evidence demonstrates. No imports, no I/O, no network, no
storage access — pure functions only.${repair}`;
}

/** Extract the first fenced code block's contents from a model reply. */
export function extractAdapterModule(reply: string): string {
  const match = reply.match(/```(?:ts|typescript|js|javascript)?\n([\s\S]*?)```/);
  if (!match || !match[1]) throw new Error('analyzer reply contained no code block');
  return match[1].trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/synthesis/analyzer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/synthesis/analyzer.ts packages/llm-unified/src/synthesis/analyzer.test.ts
git commit -m "Add analyzer prompt builder and code-block extraction"
```

---

## Task 10: Loop orchestration

**Files:**
- Create: `packages/llm-unified/src/synthesis/loop.ts`
- Test: `packages/llm-unified/src/synthesis/loop.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// loop.test.ts
import { describe, expect, it } from 'bun:test';
import { runSynthesisLoop } from './loop.js';
import type { Verdict } from './validate.js';

describe('runSynthesisLoop', () => {
  it('accepts on first pass and reports verified', async () => {
    const result = await runSynthesisLoop({
      generate: async () => 'export const adapter = {};',
      validate: async (): Promise<Verdict> => ({ passed: true, failures: [] }),
      maxRounds: 3,
    });
    expect(result.outcome).toBe('verified');
    expect(result.rounds).toBe(1);
  });

  it('self-repairs then falls back to heuristic after maxRounds failures', async () => {
    let calls = 0;
    const result = await runSynthesisLoop({
      generate: async () => { calls += 1; return `attempt ${calls}`; },
      validate: async (): Promise<Verdict> => ({ passed: false, failures: ['nope'] }),
      maxRounds: 3,
    });
    expect(result.outcome).toBe('heuristic-fallback');
    expect(calls).toBe(3);
    expect(result.rounds).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/synthesis/loop.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// loop.ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { Verdict } from './validate.js';

export interface LoopArgs {
  /** Generate adapter source; receives prior failures for self-repair rounds. */
  generate: (priorFailures: string[]) => Promise<string>;
  /** Validate adapter source, returning a verdict. */
  validate: (adapterSource: string) => Promise<Verdict>;
  maxRounds: number;
}

export interface LoopResult {
  outcome: 'verified' | 'heuristic-fallback';
  rounds: number;
  adapterSource: string | null;
  lastFailures: string[];
}

/**
 * Drive generate → validate → self-repair. On a passing verdict, accept
 * (`verified`). After `maxRounds` failed attempts, give up and signal the
 * conservative heuristic fallback. Capture and probing happen before this loop;
 * it operates purely on already-captured evidence via the injected callbacks.
 */
export async function runSynthesisLoop(args: LoopArgs): Promise<LoopResult> {
  let failures: string[] = [];
  let lastSource: string | null = null;
  for (let round = 1; round <= args.maxRounds; round++) {
    const source = await args.generate(failures);
    lastSource = source;
    const verdict = await args.validate(source);
    if (verdict.passed) {
      return { outcome: 'verified', rounds: round, adapterSource: source, lastFailures: [] };
    }
    failures = verdict.failures;
  }
  return {
    outcome: 'heuristic-fallback',
    rounds: args.maxRounds,
    adapterSource: lastSource,
    lastFailures: failures,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/synthesis/loop.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/synthesis/loop.ts packages/llm-unified/src/synthesis/loop.test.ts
git commit -m "Add synthesis loop orchestration with self-repair and fallback"
```

---

## Task 11: CLI wiring + env + live run

Wire the real pieces together: capture via live nano-gpt, generate via GLM-5.1, write the generated module to a temp file, load it in the sandbox, validate against baseline + observed facts. No unit test — this is the live entry covered by Manual Verification.

**Files:**
- Create: `packages/llm-unified/src/synthesis/cli.ts`
- Create: `packages/llm-unified/.env.example`
- Modify: `packages/llm-unified/package.json` (add `synthesise` script)

- [ ] **Step 1: Add the env example**

```bash
# packages/llm-unified/.env.example
# nano-gpt API key for the adapter-synthesis spike (capture + analyzer calls).
NANO_GPT_API_KEY=your-nano-gpt-key-here
```

- [ ] **Step 2: Add the npm script**

Modify `packages/llm-unified/package.json` scripts block to add:

```json
    "synthesise": "bun run src/synthesis/cli.ts"
```

(Insert after the `"test"` line; keep valid JSON with a trailing comma on `"test"`.)

- [ ] **Step 3: Write the CLI**

```ts
// cli.ts
// SPDX-License-Identifier: LGPL-3.0-only
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runOneShotCompletion } from '../one-shot-completion.js';
import { getProvider } from '../registry.js';
import { buildAnalyzerPrompt, extractAdapterModule } from './analyzer.js';
import { runProbe } from './capture.js';
import { deriveObservedProfile } from './derive-profile.js';
import { runSynthesisLoop } from './loop.js';
import { buildProbeSuite } from './probe-suite.js';
import { loadAdapterInSandbox } from './sandbox-host.js';
import { validateAdapter } from './validate.js';
import type { CapturedFixture } from './fixture-types.js';

const BASE_URL = 'https://nano-gpt.com/api/v1';
const ANALYZER_MODEL_ID = 'zai-org/glm-5.1';
const TARGET_BARE = 'deepseek/deepseek-v4-pro';
const TARGET_THINKING = 'deepseek/deepseek-v4-pro:thinking';

async function main(): Promise<void> {
  const apiKey = process.env.NANO_GPT_API_KEY;
  if (!apiKey) throw new Error('NANO_GPT_API_KEY is not set (see .env.example)');

  // 1–2. Probe + capture.
  console.log('Probing target and capturing fixtures...');
  const probes = buildProbeSuite({ thinkingSlug: TARGET_THINKING, bareSlug: TARGET_BARE });
  const fixtures: CapturedFixture[] = [];
  for (const probe of probes) {
    const fx = await runProbe({ baseUrl: BASE_URL, apiKey, probe });
    console.log(`  ${probe.dimension}: HTTP ${fx.status} (${fx.rawResponse.length} bytes)`);
    fixtures.push(fx);
  }

  const fixtureDir = resolve(import.meta.dir, '..', '..', 'fixtures');
  await writeFile(join(fixtureDir, 'deepseek-v4-pro.fixtures.json'), JSON.stringify(fixtures, null, 2)).catch(
    () => console.warn('  (fixtures dir missing — skipping persist)'),
  );

  const observed = deriveObservedProfile(fixtures);
  console.log('Observed facts:', observed);

  // 3–5. Generate + validate with self-repair.
  const contract = await readFile(resolve(import.meta.dir, '..', 'adapter-contract.ts'), 'utf8');
  const provider = getProvider('nano-gpt');
  if (!provider) throw new Error('nano-gpt provider not registered');
  const analyzerModel = provider.knownModels.find((m) => m.id === ANALYZER_MODEL_ID);
  if (!analyzerModel) throw new Error(`analyzer model ${ANALYZER_MODEL_ID} not in known models`);
  const baselinePath = resolve(import.meta.dir, '..', 'adapters', 'nano-gpt-deepseek.baseline.sandbox.ts');
  const workDir = await mkdtemp(join(tmpdir(), 'adapter-synth-'));

  const result = await runSynthesisLoop({
    maxRounds: 3,
    generate: async (priorFailures) => {
      const prompt = buildAnalyzerPrompt({ contract, providerDocs: 'nano-gpt is OpenAI chat-completions compatible at /chat/completions.', fixtures, priorFailures });
      const reply = await runOneShotCompletion({
        provider,
        providerConfig: { baseUrl: BASE_URL, routing: { kind: 'direct' } },
        apiKey,
        corsProxyUrl: null,
        corsProxyKey: null,
        model: analyzerModel,
        messages: [{ role: 'user', content: prompt }],
        bodyExtras: { thinking: true },
      });
      return extractAdapterModule(reply);
    },
    validate: async (source) => {
      const modPath = join(workDir, `candidate-${Date.now()}.ts`);
      await writeFile(modPath, source);
      const candidate = await loadAdapterInSandbox(modPath);
      const baseline = await loadAdapterInSandbox(baselinePath);
      try {
        return await validateAdapter({ candidate, baseline, fixtures });
      } finally {
        candidate.dispose();
        baseline.dispose();
      }
    },
  });

  console.log(`\nVerdict: ${result.outcome} after ${result.rounds} round(s).`);
  if (result.outcome !== 'verified') {
    console.log('Last failures:\n', result.lastFailures.join('\n'));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

- [ ] **Step 4: Create the fixtures directory marker**

```bash
mkdir -p packages/llm-unified/fixtures
printf '%s\n' 'Captured probe fixtures (git-tracked golden evidence).' > packages/llm-unified/fixtures/README.md
```

- [ ] **Step 5: Typecheck the package**

Run: `pnpm --filter @chatsundere/llm-unified typecheck`
Expected: no errors. (Fix any type drift between tasks before proceeding.)

- [ ] **Step 6: Live run (Manual Verification §11.1–11.2)**

Ensure `packages/llm-unified/.env` exists with a real `NANO_GPT_API_KEY`, then:
Run: `cd packages/llm-unified && bun run synthesise`
Expected: probe HTTP statuses printed, observed facts printed, and `Verdict: verified after 1–3 round(s).` Inspect `fixtures/deepseek-v4-pro.fixtures.json` and confirm the observed facts match the raw evidence by eye (the trust gate).

- [ ] **Step 7: Commit**

```bash
git add packages/llm-unified/src/synthesis/cli.ts packages/llm-unified/.env.example packages/llm-unified/package.json packages/llm-unified/fixtures/README.md
git commit -m "Wire adapter-synthesis CLI with live capture, GLM analyzer and validation"
```

---

## Task 12: Full suite, squash, STATUS update

- [ ] **Step 1: Run the whole package test suite**

Run: `cd packages/llm-unified && bun test`
Expected: all tests pass.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @chatsundere/llm-unified typecheck`
Expected: no errors.

- [ ] **Step 3: Squash into one feature commit**

Per ADR 0003 (squash per feature unit). Soft-reset to the **plan doc commit** (the `[skip ci]` commit created just before Task 1 — find its hash with `git log --oneline | grep "synthesis spike — implementation plan"`), so spec and plan stay as their own doc commits and only the implementation folds into one unit:

```bash
git reset --soft <plan-doc-commit-hash>
git commit -m "Add agentic adapter-synthesis spike (probe → generate → validate loop)

GLM-5.1 analyzes a target model from captured probe evidence and writes a
per-model adapter (pure buildRequest + parseChunk + declarative profile),
accepted only after replay-validation against real fixtures and a hand-ported
baseline. Bun Worker isolation stand-in; conservative heuristic fallback.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

- [ ] **Step 4: Update STATUS.md**

Move adapter synthesis from "Doing now" to "Done (spike)" in `obsidian/STATUS.md`, note the deferred production iframe boundary in the follow-ups, refresh `Last updated:`. Commit:

```bash
git add obsidian/STATUS.md
git commit -m "STATUS — agentic adapter-synthesis spike landed [skip ci]"
```

---

## Self-Review

**Spec coverage:**
- §4 canonical contract → Task 1. ✓
- §4 purity / host-does-I/O → Tasks 6, 7 (capture + sandbox). ✓
- §5 five-stage loop → Tasks 5 (probe), 6 (capture), 9 (generate), 7+8 (sandbox+validate), 10 (self-repair). ✓
- §5 probe suite (the six empirical questions) → Task 5 + Task 4 derivation. ✓
- §6 Bun Worker stand-in + watchdog → Task 7. ✓
- §7 fallback ladder + confidence → Task 1 (`conservativeProfile`), Task 10 (`heuristic-fallback`). ✓
- §8 concrete models/provider → Task 11 CLI constants. ✓
- §9 file layout → matches Tasks 1–11. ✓
- §11 manual verification → Task 11 Step 6 + Task 12. ✓
- Streamed tool-call reassembly (the `streaming.ts:112` bug) → Task 3 baseline + Task 4 derivation + Task 8 validation. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `ModelAdapter`/`CanonicalRequest`/`WireRequest`/`ParseState`/`ModelProfile` defined in Task 1 and used consistently in Tasks 3, 7, 8. `CapturedFixture`/`Probe`/`ProbeDimension` defined in Task 4 and used in 5, 6, 8, 9, 11. `Verdict` defined in Task 8, used in 10, 11. `AdapterHandle` defined in Task 7, used in 8. `adapter` export name consistent between worker entry (Task 7), baseline sandbox wrapper (Task 7), and analyzer instruction (Task 9). ✓
