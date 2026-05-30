# Chutes Curation + Live Suite Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring chutes fully live — a `chutes-openai` adapter (per-model factory), the `chutes` provider with its 4 TEE models, a chutes `ProviderScanner`, a live conversation-suite `RunnerBinding`, and Curation Records — validated against real chutes.

**Architecture:** A `chutesAdapter(slug, vision)` factory produces a `ModelAdapter` per model (OpenAI-compatible + `reasoning_effort` + `stream_options.include_usage`). `registerChutes()` registers the provider and one adapter per model (`chutes:<slug>`), and reorders providers (nano-gpt to the end). `makeLiveBinding` wires the conversation-suite to a real provider via its own status-capturing fetch.

**Tech Stack:** TypeScript (strict), Bun test runner. All unit tests key-free; the live suite run is local-only.

**Spec:** [`../specs/2026-05-30-chutes-curation-and-live-suite-design.md`](../specs/2026-05-30-chutes-curation-and-live-suite-design.md)

---

## File Structure

**Create:**
- `packages/llm-unified/src/adapters/chutes-openai.ts` — `chutesAdapter(slug, vision)` factory.
- `packages/llm-unified/src/adapters/chutes-openai.test.ts`
- `packages/llm-unified/src/providers/curation/chutes-scanner.ts` — `groupChutesModels`.
- `packages/llm-unified/src/providers/curation/chutes-scanner.test.ts`
- `packages/llm-unified/src/providers/chutes.ts` — `ProviderDefinition` + `registerChutes()`.
- `packages/llm-unified/curation/conversation-suite/binding.ts` — `makeLiveBinding`.
- `packages/llm-unified/curation/conversation-suite/binding.test.ts`
- `obsidian/providers/chutes.md` — Provider Curation Record.
- `obsidian/models/{deepseek-v3.2.md,kimi-k2.6.md,glm-5.1.md,gemma-4-31b-turbo.md}` — Model Records.

**Modify:**
- `packages/llm-unified/src/providers/_register-builtins.ts` — call `registerChutes()`.
- `packages/llm-unified/src/providers/nano-gpt.ts` — `sortPriority: 10 → 40`.
- `packages/llm-unified/curation/conversation-suite/index.ts` — export the binding.

---

## Task 1: `chutes-openai` adapter factory

**Files:**
- Create: `packages/llm-unified/src/adapters/chutes-openai.ts`
- Test: `packages/llm-unified/src/adapters/chutes-openai.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import type { ParseState } from '../adapter-contract.js';
import { chutesAdapter } from './chutes-openai.js';

const a = chutesAdapter('deepseek-ai/DeepSeek-V3.2-TEE', false);

describe('chutesAdapter buildRequest', () => {
  it('sets stream_options.include_usage and the slug, omits reasoning_effort when off', () => {
    const wire = a.buildRequest({ messages: [{ role: 'user', content: 'hi' }], reasoning: { enabled: false } });
    expect(wire.model).toBe('deepseek-ai/DeepSeek-V3.2-TEE');
    expect(wire.body.model).toBe('deepseek-ai/DeepSeek-V3.2-TEE');
    expect(wire.body.stream).toBe(true);
    expect(wire.body.stream_options).toEqual({ include_usage: true });
    expect(wire.body.reasoning_effort).toBeUndefined();
  });

  it('sets reasoning_effort from the intent when reasoning is on', () => {
    const wire = a.buildRequest({ messages: [], reasoning: { enabled: true, effort: 'high' } });
    expect(wire.body.reasoning_effort).toBe('high');
  });

  it('defaults reasoning_effort to medium when on without an explicit effort', () => {
    const wire = a.buildRequest({ messages: [], reasoning: { enabled: true } });
    expect(wire.body.reasoning_effort).toBe('medium');
  });

  it('maps tools to the OpenAI function shape, omits when empty', () => {
    const withTools = a.buildRequest({
      messages: [],
      reasoning: { enabled: false },
      tools: [{ name: 'generate_image', description: 'make an image', parameters: { type: 'object' } }],
    });
    expect(withTools.body.tools).toEqual([
      { type: 'function', function: { name: 'generate_image', description: 'make an image', parameters: { type: 'object' } } },
    ]);
    const noTools = a.buildRequest({ messages: [], reasoning: { enabled: false }, tools: [] });
    expect(noTools.body.tools).toBeUndefined();
  });
});

describe('chutesAdapter parseChunk', () => {
  it('emits reasoning_content as reasoning and content as token', () => {
    const r = a.parseChunk(
      { choices: [{ delta: { reasoning_content: 'thinking', content: 'answer' } }] },
      {},
    );
    expect(r.events).toEqual([
      { type: 'reasoning', text: 'thinking' },
      { type: 'token', text: 'answer' },
    ]);
  });

  it('reassembles a fragmented tool call across deltas, flushing on finish', () => {
    const deltas: unknown[] = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'generate_image', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"prompt":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"a cat"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ];
    let state: ParseState = {};
    const events = [];
    for (const d of deltas) {
      const res = a.parseChunk(d, state);
      state = res.state;
      events.push(...res.events);
    }
    expect(events.find((e) => e.type === 'tool-call')).toEqual({
      type: 'tool-call', toolCallId: 'call_1', name: 'generate_image', argumentsJson: '{"prompt":"a cat"}',
    });
    expect(events.at(-1)).toEqual({ type: 'finish', reason: 'tool_calls' });
  });

  it('normalises usage from a final choices:[] event, reading top-level reasoning_tokens', () => {
    const r = a.parseChunk(
      { choices: [], usage: { prompt_tokens: 14, completion_tokens: 9, total_tokens: 23, reasoning_tokens: 5, prompt_tokens_details: { cached_tokens: 4 } } },
      {},
    );
    expect(r.events).toEqual([
      { type: 'usage', usage: { promptTokens: 14, completionTokens: 9, totalTokens: 23, reasoningTokens: 5, cachedTokens: 4 } },
    ]);
  });

  it('ignores a null usage on the finish event', () => {
    const r = a.parseChunk({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: null }, {});
    expect(r.events).toEqual([{ type: 'finish', reason: 'stop' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/adapters/chutes-openai.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the factory**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import type {
  CanonicalRequest,
  ModelAdapter,
  ModelProfile,
  ParseState,
  WireRequest,
} from '../adapter-contract.js';
import type { NormalisedUsage, StreamChunk } from '../types.js';

interface PendingToolCall {
  id: string;
  name: string;
  args: string;
}

function getPending(state: ParseState): Record<string, PendingToolCall> {
  if (!state.toolCalls) state.toolCalls = {};
  return state.toolCalls as Record<string, PendingToolCall>;
}

interface ChutesUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  reasoning_tokens?: number | null;
  prompt_tokens_details?: { cached_tokens?: number } | null;
}

interface ChutesDelta {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: ChutesUsage | null;
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

function normaliseUsage(u: ChutesUsage): NormalisedUsage {
  // Chutes reports reasoning_tokens TOP-LEVEL in usage (not under
  // completion_tokens_details as OpenAI does). Empirically confirmed.
  const usage: NormalisedUsage = {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
  };
  if (u.reasoning_tokens !== undefined && u.reasoning_tokens !== null) {
    usage.reasoningTokens = u.reasoning_tokens;
  }
  const cached = u.prompt_tokens_details?.cached_tokens;
  if (cached !== undefined) usage.cachedTokens = cached;
  return usage;
}

/**
 * Build a chutes adapter bound to one model slug. Chutes is uniformly
 * OpenAI-compatible: reasoning via `reasoning_effort` (omitted = off),
 * usage requested via `stream_options.include_usage` and delivered on a
 * final `choices: []` event. `vision` feeds only the recorded profile
 * (the catalogue profile is not yet runtime-consumed).
 */
export function chutesAdapter(slug: string, vision: boolean): ModelAdapter {
  const profile: ModelProfile = {
    reasoning: { mode: 'steps', steps: ['low', 'medium', 'high'], offStep: null, defaultStep: 'medium' },
    toolCalls: { supported: true, streaming: true, concurrentWithReasoning: true },
    vision,
    replayReasoning: false,
  };

  return {
    profile,

    buildRequest(req: CanonicalRequest): WireRequest {
      const body: Record<string, unknown> = {
        model: slug,
        messages: req.messages,
        stream: true,
        stream_options: { include_usage: true },
      };
      if (req.reasoning.enabled) body.reasoning_effort = req.reasoning.effort ?? 'medium';
      if (req.tools?.length) {
        body.tools = req.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
      }
      return { model: slug, body };
    },

    parseChunk(raw: unknown, state: ParseState): { events: StreamChunk[]; state: ParseState } {
      const events: StreamChunk[] = [];
      const p = raw as ChutesDelta;

      if (p.usage) events.push({ type: 'usage', usage: normaliseUsage(p.usage) });

      const choice = p.choices?.[0];
      if (!choice) return { events, state };

      if (choice.delta?.reasoning_content) events.push({ type: 'reasoning', text: choice.delta.reasoning_content });
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
        for (const acc of Object.values(pending)) {
          if (acc.id && acc.name) {
            events.push({ type: 'tool-call', toolCallId: acc.id, name: acc.name, argumentsJson: acc.args });
          }
        }
        state.toolCalls = {};
        events.push({ type: 'finish', reason: normaliseFinish(choice.finish_reason) });
      }
      return { events, state };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/adapters/chutes-openai.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/adapters/chutes-openai.ts packages/llm-unified/src/adapters/chutes-openai.test.ts
git commit -m "Add chutes-openai adapter factory (reasoning_effort, usage, tool reassembly)"
```

---

## Task 2: chutes ProviderScanner

**Files:**
- Create: `packages/llm-unified/src/providers/curation/chutes-scanner.ts`
- Test: `packages/llm-unified/src/providers/curation/chutes-scanner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { groupChutesModels } from './chutes-scanner.js';

describe('groupChutesModels', () => {
  test('one offering per model; teeVariant tracks confidential_compute', () => {
    const offerings = groupChutesModels([
      { id: 'deepseek-ai/DeepSeek-V3.2-TEE', confidential_compute: true },
      { id: 'some/non-tee-model', confidential_compute: false },
      { id: 'other/no-flag' },
    ]);
    expect(offerings).toEqual([
      { providerId: 'chutes', baseSlug: 'deepseek-ai/DeepSeek-V3.2-TEE', teeVariant: true },
      { providerId: 'chutes', baseSlug: 'some/non-tee-model', teeVariant: false },
      { providerId: 'chutes', baseSlug: 'other/no-flag', teeVariant: false },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/providers/curation/chutes-scanner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the scanner**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { DiscoveredOffering } from './provider-scanner.js';

/** One raw entry from chutes' GET /v1/models. */
export interface ChutesModelEntry {
  id: string;
  confidential_compute?: boolean;
}

/**
 * Group chutes' model list into offerings. Chutes is simple compared to the
 * nano-gpt slug-zoo: one offering per model, TEE identified by the
 * `confidential_compute` boolean (the authoritative signal — not the `-TEE`
 * suffix). Reasoning is a body param (`reasoning_effort`), so there is no
 * reasoning-sibling slug to group.
 */
export function groupChutesModels(models: ChutesModelEntry[]): DiscoveredOffering[] {
  return models.map((m) => ({
    providerId: 'chutes',
    baseSlug: m.id,
    teeVariant: m.confidential_compute === true,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/providers/curation/chutes-scanner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/providers/curation/chutes-scanner.ts packages/llm-unified/src/providers/curation/chutes-scanner.test.ts
git commit -m "Add chutes ProviderScanner (groupChutesModels)"
```

---

## Task 3: chutes ProviderDefinition + registration + provider reorder

**Files:**
- Create: `packages/llm-unified/src/providers/chutes.ts`
- Modify: `packages/llm-unified/src/providers/_register-builtins.ts`
- Modify: `packages/llm-unified/src/providers/nano-gpt.ts`

- [ ] **Step 1: Write the chutes provider definition + registration**

Create `packages/llm-unified/src/providers/chutes.ts`. Follow `nano-gpt.ts`'s structure (imports `registerProvider`, `apiKeyField`). The 4 `knownModels` come from the live `/models` probe (context windows, vision per input modalities). Each `adapterId` is `chutes:<slug>` and each registers a `chutesAdapter(slug, vision)`.

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { chutesAdapter } from '../adapters/chutes-openai.js';
import { registerAdapter } from '../adapter-registry.js';
import { registerProvider } from '../registry.js';
import type { KnownModel, ProviderDefinition } from '../types.js';
import { apiKeyField } from './_helpers.js';

const REASONING = {
  kind: 'optional' as const,
  effort: { buckets: ['low', 'medium', 'high'], defaultBucket: 'medium' },
  defaultOn: false,
  replayReasoning: false,
};

/** The curated chutes TEE models (all confidential_compute === true). */
const MODELS: Array<Omit<KnownModel, 'adapterId' | 'reasoning'> & { vision: boolean }> = [
  { id: 'deepseek-ai/DeepSeek-V3.2-TEE', displayName: 'DeepSeek V3.2 (TEE)', contextWindow: 131_072, vision: false, tools: true },
  { id: 'moonshotai/Kimi-K2.6-TEE', displayName: 'Kimi K2.6 (TEE)', notes: 'QAT model', contextWindow: 262_144, vision: true, tools: true },
  { id: 'zai-org/GLM-5.1-TEE', displayName: 'GLM 5.1 (TEE)', contextWindow: 202_752, vision: false, tools: true },
  { id: 'google/gemma-4-31B-turbo-TEE', displayName: 'Gemma 4 31B Turbo (TEE)', notes: 'FP4 quant', contextWindow: 131_072, vision: true, tools: true },
];

const knownModels: KnownModel[] = MODELS.map((m) => ({
  id: m.id,
  displayName: m.displayName,
  ...(m.notes ? { notes: m.notes } : {}),
  contextWindow: m.contextWindow,
  reasoning: REASONING,
  vision: m.vision,
  tools: m.tools,
  adapterId: `chutes:${m.id}`,
}));

export const chutes: ProviderDefinition = {
  id: 'chutes',
  displayName: 'Chutes',
  iconKey: 'chutes',
  baseUrl: 'https://llm.chutes.ai/v1',
  shape: 'openai-chat-completions',
  capabilities: ['llm', 'streaming', 'tools'],
  configFields: [apiKeyField('Chutes API key')],
  probe: { path: '/models', method: 'GET' },
  secretFields: new Set(['api_key']),
  corsHint: 'direct',
  knownModels,
  sortPriority: 10,
};

export function registerChutes(): void {
  registerProvider(chutes);
  for (const m of MODELS) {
    registerAdapter(`chutes:${m.id}`, chutesAdapter(m.id, m.vision));
  }
}
```

Note: confirm `apiKeyField` and the `ProviderDefinition`/`KnownModel` field names against `nano-gpt.ts` and `types.ts` before finalising (e.g. `iconKey`, `capabilities` member spelling). If `capabilities` does not include a `'tools'` member in the `Capability` union (`types.ts`), drop it from the array — keep `['llm', 'streaming']` to match nano-gpt.

- [ ] **Step 2: Wire into `_register-builtins.ts`**

In `packages/llm-unified/src/providers/_register-builtins.ts`, import and call `registerChutes()`:

```ts
import { registerChutes } from './chutes.js';
```
and inside `registerBuiltinProviders()` add `registerChutes();` (first, so it registers ahead — order does not affect sortPriority but keep it tidy).

- [ ] **Step 3: Reorder — move nano-gpt to the end**

In `packages/llm-unified/src/providers/nano-gpt.ts`, change `sortPriority: 10` to `sortPriority: 40`. (Final order: chutes 10 < novita 20 < ollama-cloud 30 < nano-gpt 40.)

- [ ] **Step 4: Verify build, typecheck, and the full suite (provider/adapter registration must not throw on import)**

Run: `cd packages/llm-unified && bun run build && bun run typecheck && bun test`
Expected: clean; all tests pass. If any test calls `_resetRegistryForTests` then `registerBuiltinProviders()`, chutes now registers too — that is fine. If a test asserts an exact provider count or order, update it to include chutes and the new order.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/providers/chutes.ts packages/llm-unified/src/providers/_register-builtins.ts packages/llm-unified/src/providers/nano-gpt.ts
git commit -m "Register chutes provider (4 TEE models) and reorder nano-gpt to the end"
```

---

## Task 4: Live `RunnerBinding`

**Files:**
- Create: `packages/llm-unified/curation/conversation-suite/binding.ts`
- Test: `packages/llm-unified/curation/conversation-suite/binding.test.ts`
- Modify: `packages/llm-unified/curation/conversation-suite/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import type { ProviderConfig } from '../../src/types.js';
import { chutesAdapter } from '../../src/adapters/chutes-openai.js';
import { makeLiveBinding } from './binding.js';

const providerConfig = { baseUrl: 'https://llm.chutes.ai/v1', routing: 'direct' } as unknown as ProviderConfig;
const adapter = chutesAdapter('deepseek-ai/DeepSeek-V3.2-TEE', false);

function sseStream(parts: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < parts.length) c.enqueue(enc.encode(parts[i++]));
      else c.close();
    },
  });
}

describe('makeLiveBinding', () => {
  test('captures a non-2xx status as an outcome (no throw) — the 400 case', async () => {
    const binding = makeLiveBinding({
      offeringRef: 'chutes:deepseek',
      providerConfig,
      apiKey: 'k',
      adapter,
      fetchImpl: async () => new Response('bad request', { status: 400 }),
    });
    const outcome = await binding.runTurn([{ role: 'user', content: 'hi' }], { enabled: false });
    expect(outcome.httpStatus).toBe(400);
    expect(outcome.toolCalls).toEqual([]);
  });

  test('parses a 200 SSE body through the adapter into a TurnOutcome', async () => {
    const binding = makeLiveBinding({
      offeringRef: 'chutes:deepseek',
      providerConfig,
      apiKey: 'k',
      adapter,
      fetchImpl: async () =>
        new Response(
          sseStream([
            'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":null}\n\n',
            'data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\n',
            'data: [DONE]\n\n',
          ]),
          { status: 200 },
        ),
    });
    const outcome = await binding.runTurn([{ role: 'user', content: 'hi' }], { enabled: false });
    expect(outcome.httpStatus).toBe(200);
    expect(outcome.text).toBe('hello');
    expect(outcome.usage).toEqual({ promptTokens: 2, completionTokens: 1, totalTokens: 3 });
    expect(outcome.finishReason).toBe('stop');
  });

  test('toolResultFor synthesises a tool-role message', () => {
    const binding = makeLiveBinding({ offeringRef: 'r', providerConfig, apiKey: 'k', adapter });
    expect(binding.toolResultFor('generate_image', '{}')).toEqual({
      role: 'tool',
      content: JSON.stringify({ ok: true }),
      name: 'generate_image',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test curation/conversation-suite/binding.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `makeLiveBinding`**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { ModelAdapter, ToolDef } from '../../src/adapter-contract.js';
import { parseWithAdapter } from '../../src/adapter-stream.js';
import { buildRequest } from '../../src/transport.js';
import type { ProviderConfig, StreamChunk } from '../../src/types.js';
import { assembleOutcome, type RunnerBinding } from './runner.js';

export interface LiveBindingArgs {
  offeringRef: string;
  providerConfig: ProviderConfig;
  apiKey: string;
  corsProxyUrl?: string | null;
  corsProxyKey?: string | null;
  adapter: ModelAdapter;
  tools?: ToolDef[];
  /** Injectable for key-free unit tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Wire the conversation-suite to a live provider. Does its OWN fetch (not
 * streamCompletion) so the HTTP status is captured rather than thrown — the
 * MiMo/chutes 400 case must become a checkable outcome, not an exception.
 */
export function makeLiveBinding(args: LiveBindingArgs): RunnerBinding {
  const doFetch = args.fetchImpl ?? fetch;
  return {
    offeringRef: args.offeringRef,
    async runTurn(messages, reasoning) {
      const wire = args.adapter.buildRequest({
        messages,
        reasoning,
        ...(args.tools && args.tools.length > 0 ? { tools: args.tools } : {}),
      });
      const request = buildRequest({
        provider: args.providerConfig,
        apiKey: args.apiKey,
        corsProxyUrl: args.corsProxyUrl ?? null,
        corsProxyKey: args.corsProxyKey ?? null,
        path: '/chat/completions',
        method: 'POST',
        body: wire.body,
      });
      const response = await doFetch(request);
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => {});
        return assembleOutcome(response.status, []);
      }
      const chunks: StreamChunk[] = [];
      for await (const c of parseWithAdapter(response.body, args.adapter)) chunks.push(c);
      return assembleOutcome(response.status, chunks);
    },
    toolResultFor(toolName: string): ReturnType<RunnerBinding['toolResultFor']> {
      return { role: 'tool', content: JSON.stringify({ ok: true }), name: toolName };
    },
  };
}
```

- [ ] **Step 4: Export from the suite index**

In `packages/llm-unified/curation/conversation-suite/index.ts`, add:
```ts
export * from './binding.js';
```

- [ ] **Step 5: Run tests + build + typecheck**

Run: `cd packages/llm-unified && bun test curation/conversation-suite/binding.test.ts && bun run build && bun run typecheck`
Expected: 3 tests PASS; build + typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/llm-unified/curation/conversation-suite/binding.ts packages/llm-unified/curation/conversation-suite/binding.test.ts packages/llm-unified/curation/conversation-suite/index.ts
git commit -m "Add live conversation-suite RunnerBinding (captures HTTP status)"
```

---

## Task 5: Curation Records (docs)

**Files:**
- Create: `obsidian/providers/chutes.md`
- Create: `obsidian/models/deepseek-v3.2.md`, `kimi-k2.6.md`, `glm-5.1.md`, `gemma-4-31b-turbo.md`

These are British-English Markdown records (the badge emojis 🔒/🕊️ are permitted product content; no emojis in code). Follow `conventions.md`.

- [ ] **Step 1: Write the Provider Record `obsidian/providers/chutes.md`**

Required content:
- **Identity:** Chutes, `https://llm.chutes.ai/v1`, OpenAI-compatible, Bearer `cpk_` key (`keys/.chutes-test-key`), docs `https://chutes.ai/llms.txt`.
- **Base characteristics:** TEE for **all** models (the authoritative signal is the `confidential_compute` boolean, not the `-TEE` suffix); the per-chunk `chutes_verification` attestation hash is the TEE proof; CORS `direct`; jurisdiction/ZDR (fill from Chris's relationship knowledge). 🔒 Privacy badge: yes.
- **Slug convention:** `org/Model-TEE`.
- **Reasoning control:** `reasoning_effort` body param (buckets low/medium/high); off = omit. Reasoning text surfaces as `reasoning_content`.
- **`usage` quirk:** delivered on a **final event with `choices: []`** when `stream_options.include_usage: true` is sent; `reasoning_tokens` is **top-level in `usage`** (not under `completion_tokens_details`).
- **Why:** NGO-relationship partner (Privacy badge already in chatsune; direct contact with their lead); future recommendation + member conditions a goal. Community-driven model selection.
- Cross-link the spec and the model records.

- [ ] **Step 2: Write the four Model Records**

Each: identity, family, T/R/V (`tools: true`, `reasoning: optional/effort`, `vision` per model), the offering (provider chutes, slug, context window, reasoning control, 🔒 Privacy badge, 🕊️ Freedom note pending live judgement), and the WHY. Specifics:
- `deepseek-v3.2.md`: slug `deepseek-ai/DeepSeek-V3.2-TEE`, ctx 131072, vision false. Note the probe finding: `reasoning_effort` accepted but a trivial prompt returned `reasoning_content: null` / `reasoning_tokens: 0` — the live suite confirms whether reasoning surfaces on a harder prompt.
- `kimi-k2.6.md`: slug `moonshotai/Kimi-K2.6-TEE`, ctx 262144, vision true (input text+image+video), **QAT** model (note Chris's enthusiasm for QAT).
- `glm-5.1.md`: slug `zai-org/GLM-5.1-TEE`, ctx 202752, vision false.
- `gemma-4-31b-turbo.md`: slug `google/gemma-4-31B-turbo-TEE`, ctx 131072, vision true, **FP4 quant** (note it explicitly; tool-invocation reliability is the watch case per the model-curation playbook — Gemma historically tool-reluctant).

- [ ] **Step 3: Verify the records exist and links resolve**

Run: `ls obsidian/providers/chutes.md obsidian/models/{deepseek-v3.2,kimi-k2.6,glm-5.1,gemma-4-31b-turbo}.md`
Expected: all five present.

- [ ] **Step 4: Commit (doc-only)**

```bash
git add obsidian/providers/chutes.md obsidian/models/
git commit -m "Add chutes provider + model curation records [skip ci]"
```

---

## Final Verification

- [ ] **Whole package builds, typechecks, tests green (key-free)**

Run: `cd packages/llm-unified && bun run build && bun run typecheck && bun test`
Expected: clean; chutes adapter, scanner, binding all unit-tested without keys.

- [ ] **Provider order correct**

Run: `cd packages/llm-unified && bun run -e "import('./src/index.js').then(m => console.log(m.listProviders().map(p => p.id)))"` (or a small inline check)
Expected: `['chutes', 'novita', 'ollama-cloud', 'nano-gpt']`.

- [ ] **No live calls in tests**

Run: `rg -n "fetch\(|llm.chutes.ai" packages/llm-unified/src/adapters/chutes-openai.test.ts packages/llm-unified/curation/conversation-suite/binding.test.ts`
Expected: only the injected `fetchImpl` fakes in binding.test.ts; no real network.

---

## Live Validation (Chris — manual, needs `keys/.chutes-test-key`)

Not part of automated CI. After the above lands, drive the conversation-suite live:
1. Build a `makeLiveBinding` for `chutes:deepseek-ai/DeepSeek-V3.2-TEE` (and Gemma) with the chutes key + the `generate_image` tool, and run `runSuite(coreScenario, [{label:'reasoning-off', intent:{enabled:false}}, {label:'reasoning-on', intent:{enabled:true, effort:'high'}}], binding)`, render with `renderSuiteReport`.
2. Confirm `assertNoHttpError` + `assertUsagePresent` green; record the `generate_image` tool-fire result (Gemma is the watch case) and whether `reasoning_content` surfaces with reasoning on.
3. Liz drives/diagnoses any red; findings update the records.

---

## Self-Review Notes (author)

- **Spec coverage:** RunnerBinding (§2) → Task 4; chutes adapter (§3, §3.1 factory) → Task 1 + registration in Task 3; provider + scanner + reorder (§4, §5) → Tasks 2, 3; records (§6) → Task 5; live validation (§7) → manual section; testing (§8) → Tasks 1/2/4 + Final Verification.
- **Empirical facts encoded:** `reasoning_content` field, `stream_options.include_usage`, usage on `choices:[]` final event, top-level `reasoning_tokens`, `reasoning_effort` off=omit — all in Task 1's adapter + tests.
- **Type consistency:** `chutesAdapter(slug, vision)`, `groupChutesModels`, `makeLiveBinding`, `registerChutes`, adapterId `chutes:<slug>` consistent across tasks. `RunnerBinding`/`assembleOutcome` reused from `runner.ts` (verified exported). `buildRequest` args match `transport.ts` (verified).
- **Verify-before-finalise flags in Task 3:** the `Capability` union may not include `'tools'`; `KnownModel`/`ProviderDefinition` field names — the implementer must check `types.ts`/`nano-gpt.ts` and adjust (called out inline).
