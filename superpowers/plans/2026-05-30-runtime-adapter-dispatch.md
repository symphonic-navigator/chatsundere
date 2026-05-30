# Runtime Adapter Dispatch (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route `streamCompletion` through a per-model `ModelAdapter` when one is registered (gaining correct fragmented tool-call reassembly, `usage` emission, and a tools-capable `buildRequest`), falling back to the existing generic parser otherwise.

**Architecture:** A small adapter registry (mirroring the provider registry) maps an `adapterId` to a `ModelAdapter`. `KnownModel` gains an optional `adapterId`. The SSE framing is extracted from `parseOpenAiSseStream` into shared helpers so both the generic path and a new stateful `parseWithAdapter` loop reuse it. `streamCompletion` branches on adapter presence for both body-building and parsing; the fetch/retry loop is shared and unchanged. Incremental opt-in — adapter-less models behave byte-identically to today.

**Tech Stack:** TypeScript (strict), Bun test runner. All tests key-free and CI-safe.

**Spec:** [`../specs/2026-05-30-runtime-adapter-dispatch-design.md`](../specs/2026-05-30-runtime-adapter-dispatch-design.md)

---

## File Structure

**Create:**
- `packages/llm-unified/src/adapter-registry.ts` — `registerAdapter` / `getAdapter` / `_resetAdapterRegistryForTests`.
- `packages/llm-unified/src/adapter-registry.test.ts`
- `packages/llm-unified/src/adapter-stream.ts` — `parseWithAdapter` (stateful adapter parse loop).
- `packages/llm-unified/src/adapter-stream.test.ts`

**Modify:**
- `packages/llm-unified/src/types.ts` — add `adapterId?: string` to `KnownModel`.
- `packages/llm-unified/src/streaming.ts` — extract `frameSseEvents` + `eventToTokens`; refactor `parseOpenAiSseStream` to compose them; export the two helpers + `ParseOpts`.
- `packages/llm-unified/src/stream-completion.ts` — adapter dispatch, `buildAdapterBody`, `tools?` on args.
- `packages/llm-unified/src/index.ts` — export `registerAdapter`, `getAdapter`.
- `apps/user-client/src/lib/stream-engine.ts` — explicit no-op `usage` branch.

---

## Task 1: Adapter registry

**Files:**
- Create: `packages/llm-unified/src/adapter-registry.ts`
- Test: `packages/llm-unified/src/adapter-registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, describe, expect, test } from 'bun:test';
import type { CanonicalRequest, ModelAdapter, ParseState, WireRequest } from './adapter-contract.js';
import { _resetAdapterRegistryForTests, getAdapter, registerAdapter } from './adapter-registry.js';

const stub: ModelAdapter = {
  profile: {
    reasoning: { mode: 'none' },
    toolCalls: { supported: false, streaming: false, concurrentWithReasoning: false },
    vision: false,
    replayReasoning: false,
  },
  buildRequest(_req: CanonicalRequest): WireRequest {
    return { model: 'm', body: {} };
  },
  parseChunk(_raw: unknown, state: ParseState) {
    return { events: [], state };
  },
};

afterEach(() => _resetAdapterRegistryForTests());

describe('adapter-registry', () => {
  test('register then get returns the adapter', () => {
    registerAdapter('stub', stub);
    expect(getAdapter('stub')).toBe(stub);
  });
  test('get on an unknown id returns undefined', () => {
    expect(getAdapter('nope')).toBeUndefined();
  });
  test('duplicate registration throws', () => {
    registerAdapter('stub', stub);
    expect(() => registerAdapter('stub', stub)).toThrow("adapter 'stub' already registered");
  });
  test('reset clears the registry', () => {
    registerAdapter('stub', stub);
    _resetAdapterRegistryForTests();
    expect(getAdapter('stub')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/adapter-registry.test.ts`
Expected: FAIL — `Cannot find module './adapter-registry.js'`.

- [ ] **Step 3: Implement the registry**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { ModelAdapter } from './adapter-contract.js';

const registry = new Map<string, ModelAdapter>();

/**
 * Register a hand-written adapter under a stable id (e.g. 'chutes-openai').
 * Duplicate ids throw — registration happens once at module load.
 */
export function registerAdapter(id: string, adapter: ModelAdapter): void {
  if (registry.has(id)) {
    throw new Error(`adapter '${id}' already registered`);
  }
  registry.set(id, adapter);
}

/** Resolve an adapter by id, or undefined if none is registered. */
export function getAdapter(id: string): ModelAdapter | undefined {
  return registry.get(id);
}

/** Test-only — clears registry state. */
export function _resetAdapterRegistryForTests(): void {
  registry.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/adapter-registry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/adapter-registry.ts packages/llm-unified/src/adapter-registry.test.ts
git commit -m "Add adapter registry (registerAdapter/getAdapter)"
```

---

## Task 2: `adapterId` on KnownModel + registry exports

**Files:**
- Modify: `packages/llm-unified/src/types.ts`
- Modify: `packages/llm-unified/src/index.ts`

- [ ] **Step 1: Add the optional field to `KnownModel`**

In `packages/llm-unified/src/types.ts`, the `KnownModel` interface (currently `id`, `displayName`, `notes?`, `contextWindow`, `reasoning`, `vision`, `tools`) gains one field. Add after `tools`:

```ts
  /**
   * When set, streamCompletion routes through getAdapter(adapterId) for
   * wire-body building and parsing; otherwise the generic path is used.
   * Many models may share one id (e.g. all chutes models → 'chutes-openai').
   */
  adapterId?: string;
```

- [ ] **Step 2: Export the registry from the package index**

In `packages/llm-unified/src/index.ts`, after the existing `export { registerProvider, getProvider, listProviders } from './registry.js';` line, add:

```ts
export { registerAdapter, getAdapter } from './adapter-registry.js';
```

- [ ] **Step 3: Verify build + typecheck**

Run: `cd packages/llm-unified && bun run build && bun run typecheck`
Expected: both clean (adding an optional field is backwards-compatible; existing `KnownModel` literals stay valid).

- [ ] **Step 4: Commit**

```bash
git add packages/llm-unified/src/types.ts packages/llm-unified/src/index.ts
git commit -m "Add optional adapterId to KnownModel; export adapter registry"
```

---

## Task 3: Extract SSE framing (no behaviour change)

**Files:**
- Modify: `packages/llm-unified/src/streaming.ts`

This refactor must leave `parseOpenAiSseStream`'s observable behaviour identical — the existing `streaming.test.ts` is the regression guard.

- [ ] **Step 1: Run the existing streaming tests to capture the green baseline**

Run: `cd packages/llm-unified && bun test src/streaming.test.ts`
Expected: PASS. Note the count; it must be identical after the refactor.

- [ ] **Step 2: Extract `frameSseEvents` and `eventToTokens`, recompose `parseOpenAiSseStream`**

In `packages/llm-unified/src/streaming.ts`, replace the body of `parseOpenAiSseStream` and the `parseEvent`/`DONE` machinery with the following. Keep `openAiPayloadToChunks` and `normaliseFinishReason` exactly as they are.

```ts
/**
 * Frame an SSE byte stream into raw event strings (the text between `\n\n`
 * separators). Generic — no payload interpretation. Shared by the generic
 * and adapter parse paths.
 */
export async function* frameSseEvents(
  stream: ReadableStream<Uint8Array>,
  opts: ParseOpts = {},
): AsyncIterable<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  opts.signal?.addEventListener('abort', onAbort);

  try {
    while (true) {
      if (opts.signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep = buffer.indexOf('\n\n');
      while (sep !== -1) {
        yield buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        sep = buffer.indexOf('\n\n');
      }
    }
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

/** One SSE `data:` line, interpreted up to (but not including) payload shape. */
export type SsePayloadToken =
  | { kind: 'data'; data: unknown }
  | { kind: 'done' }
  | { kind: 'malformed'; message: string };

/** Split one SSE event into its payload tokens (data lines, [DONE], malformed). */
export function eventToTokens(event: string): SsePayloadToken[] {
  const out: SsePayloadToken[] = [];
  for (const line of event.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trimStart();
    if (data === '[DONE]') {
      out.push({ kind: 'done' });
      continue;
    }
    try {
      out.push({ kind: 'data', data: JSON.parse(data) });
    } catch (e) {
      out.push({ kind: 'malformed', message: (e as Error).message });
    }
  }
  return out;
}

/**
 * Parse an OpenAI-compatible SSE stream into a structured StreamChunk
 * AsyncIterable. Handles split chunks, comments, blank lines, the [DONE]
 * terminator, and abort signals.
 */
export async function* parseOpenAiSseStream(
  stream: ReadableStream<Uint8Array>,
  opts: ParseOpts = {},
): AsyncIterable<StreamChunk> {
  for await (const event of frameSseEvents(stream, opts)) {
    for (const tok of eventToTokens(event)) {
      if (tok.kind === 'done') return;
      if (tok.kind === 'malformed') {
        yield { type: 'error', message: `malformed SSE payload: ${tok.message}` };
        continue;
      }
      yield* openAiPayloadToChunks(tok.data);
    }
  }
}
```

Delete the now-unused `parseEvent` function, the `DONE` symbol, and the `EventOut` type (their logic moved into `eventToTokens` + `parseOpenAiSseStream`). The `error` message string (`malformed SSE payload: …`) is preserved exactly.

- [ ] **Step 3: Run the existing streaming tests — must be byte-identical green**

Run: `cd packages/llm-unified && bun test src/streaming.test.ts`
Expected: PASS, same count as Step 1. If any test fails, the refactor changed behaviour — fix to match the original, do not change the tests.

- [ ] **Step 4: Verify build + typecheck**

Run: `cd packages/llm-unified && bun run build && bun run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/streaming.ts
git commit -m "Extract shared SSE framing (frameSseEvents/eventToTokens)"
```

---

## Task 4: `parseWithAdapter` — stateful adapter parse loop

**Files:**
- Create: `packages/llm-unified/src/adapter-stream.ts`
- Test: `packages/llm-unified/src/adapter-stream.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import type { CanonicalRequest, ModelAdapter, ParseState, WireRequest } from './adapter-contract.js';
import type { StreamChunk } from './types.js';
import { parseWithAdapter } from './adapter-stream.js';

/** Build a ReadableStream<Uint8Array> from SSE text parts (arbitrary splits). */
function streamFrom(parts: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < parts.length) controller.enqueue(enc.encode(parts[i++]));
      else controller.close();
    },
  });
}

/**
 * Fake adapter that reassembles fragmented tool-call arguments via ParseState
 * (the case the generic parser drops). Flushes the tool call on finish_reason.
 */
const fakeAdapter: ModelAdapter = {
  profile: {
    reasoning: { mode: 'none' },
    toolCalls: { supported: true, streaming: true, concurrentWithReasoning: false },
    vision: false,
    replayReasoning: false,
  },
  buildRequest(_req: CanonicalRequest): WireRequest {
    return { model: 'fake', body: {} };
  },
  parseChunk(raw: unknown, state: ParseState): { events: StreamChunk[]; state: ParseState } {
    const events: StreamChunk[] = [];
    const p = raw as {
      choices?: Array<{
        delta?: { tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> };
        finish_reason?: string | null;
      }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    if (p.usage) {
      events.push({
        type: 'usage',
        usage: {
          promptTokens: p.usage.prompt_tokens,
          completionTokens: p.usage.completion_tokens,
          totalTokens: p.usage.total_tokens,
        },
      });
    }
    const choice = p.choices?.[0];
    if (!choice) return { events, state };
    const acc = (state.tc as { id: string; name: string; args: string }) ?? { id: '', name: '', args: '' };
    for (const tc of choice.delta?.tool_calls ?? []) {
      if (tc.id) acc.id = tc.id;
      if (tc.function?.name) acc.name = tc.function.name;
      if (typeof tc.function?.arguments === 'string') acc.args += tc.function.arguments;
    }
    state.tc = acc;
    if (choice.finish_reason) {
      if (acc.id && acc.name) {
        events.push({ type: 'tool-call', toolCallId: acc.id, name: acc.name, argumentsJson: acc.args });
      }
      state.tc = { id: '', name: '', args: '' };
      events.push({ type: 'finish', reason: 'tool_calls' });
    }
    return { events, state };
  },
};

async function collect(it: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

describe('parseWithAdapter', () => {
  test('reassembles fragmented tool-call arguments across events', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","function":{"name":"generate_image","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"{\\"prompt\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"\\"a cat\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const chunks = await collect(parseWithAdapter(streamFrom(sse), fakeAdapter));
    const toolCall = chunks.find((c) => c.type === 'tool-call');
    expect(toolCall).toEqual({
      type: 'tool-call',
      toolCallId: 'call_1',
      name: 'generate_image',
      argumentsJson: '{"prompt":"a cat"}',
    });
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: 'tool_calls' });
  });

  test('emits a usage chunk', async () => {
    const sse = [
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}\n\n',
      'data: [DONE]\n\n',
    ];
    const chunks = await collect(parseWithAdapter(streamFrom(sse), fakeAdapter));
    expect(chunks).toContainEqual({
      type: 'usage',
      usage: { promptTokens: 3, completionTokens: 4, totalTokens: 7 },
    });
  });

  test('stops at [DONE] and surfaces malformed payloads as error chunks', async () => {
    const sse = ['data: not-json\n\n', 'data: [DONE]\n\n'];
    const chunks = await collect(parseWithAdapter(streamFrom(sse), fakeAdapter));
    expect(chunks.some((c) => c.type === 'error')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/adapter-stream.test.ts`
Expected: FAIL — `Cannot find module './adapter-stream.js'`.

- [ ] **Step 3: Implement `parseWithAdapter`**

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { ModelAdapter, ParseState } from './adapter-contract.js';
import { type ParseOpts, eventToTokens, frameSseEvents } from './streaming.js';
import type { StreamChunk } from './types.js';

/**
 * Parse an SSE stream through a ModelAdapter, threading ParseState across
 * events so the adapter can reassemble fragmented tool calls and emit usage.
 * Reuses the generic SSE framing; only per-event interpretation differs from
 * parseOpenAiSseStream. Stops at [DONE]; malformed payloads become error chunks.
 */
export async function* parseWithAdapter(
  stream: ReadableStream<Uint8Array>,
  adapter: ModelAdapter,
  opts: ParseOpts = {},
): AsyncIterable<StreamChunk> {
  let state: ParseState = {};
  for await (const event of frameSseEvents(stream, opts)) {
    for (const tok of eventToTokens(event)) {
      if (tok.kind === 'done') return;
      if (tok.kind === 'malformed') {
        yield { type: 'error', message: `malformed SSE payload: ${tok.message}` };
        continue;
      }
      const { events, state: next } = adapter.parseChunk(tok.data, state);
      state = next;
      yield* events;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/adapter-stream.test.ts`
Expected: PASS (3 tests). The first proves the fragmented-tool-call reassembly the generic path drops.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/adapter-stream.ts packages/llm-unified/src/adapter-stream.test.ts
git commit -m "Add parseWithAdapter (stateful adapter SSE parse loop)"
```

---

## Task 5: `streamCompletion` adapter dispatch

**Files:**
- Modify: `packages/llm-unified/src/stream-completion.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/llm-unified/src/stream-completion.test.ts` (or extend it if it exists — check first with `ls packages/llm-unified/src/stream-completion.test.ts`). Add tests that exercise the adapter-body builder via a test export, without the network:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, describe, expect, test } from 'bun:test';
import type { CanonicalRequest, ModelAdapter, ParseState, WireRequest } from './adapter-contract.js';
import { _resetAdapterRegistryForTests, registerAdapter } from './adapter-registry.js';
import { buildAdapterBodyForTest } from './stream-completion.js';
import type { KnownModel, ProviderConfig, ProviderDefinition } from './types.js';

let lastReq: CanonicalRequest | null = null;
const recordingAdapter: ModelAdapter = {
  profile: {
    reasoning: { mode: 'toggle', defaultOn: false },
    toolCalls: { supported: true, streaming: true, concurrentWithReasoning: false },
    vision: false,
    replayReasoning: false,
  },
  buildRequest(req: CanonicalRequest): WireRequest {
    lastReq = req;
    return { model: 'slug', body: { model: 'slug', messages: req.messages, stream: true } };
  },
  parseChunk(_raw: unknown, state: ParseState) {
    return { events: [], state };
  },
};

const provider = { id: 'p' } as ProviderDefinition;
const providerConfig = {} as ProviderConfig;
const model: KnownModel = {
  id: 'slug',
  displayName: 'M',
  contextWindow: 100_000,
  reasoning: { kind: 'optional', defaultOn: false, replayReasoning: false },
  vision: false,
  tools: true,
  adapterId: 'rec',
};

afterEach(() => {
  _resetAdapterRegistryForTests();
  lastReq = null;
});

describe('buildAdapterBody', () => {
  test('assembles a CanonicalRequest with reasoning intent and preserves temperature', () => {
    registerAdapter('rec', recordingAdapter);
    const body = buildAdapterBodyForTest(
      {
        provider,
        providerConfig,
        apiKey: 'k',
        corsProxyUrl: null,
        corsProxyKey: null,
        model,
        messages: [{ role: 'user', content: 'hi' }],
        bodyExtras: { reasoning: { enabled: true, effort: 'high' }, temperature: 0.4 },
      },
      recordingAdapter,
    );
    expect(lastReq?.reasoning).toEqual({ enabled: true, effort: 'high' });
    expect(lastReq?.messages).toEqual([{ role: 'user', content: 'hi' }]);
    // temperature is a generic sampling param layered onto the adapter body.
    expect(body.temperature).toBe(0.4);
    expect(body.model).toBe('slug');
  });

  test('includes tools when provided, omits when absent', () => {
    registerAdapter('rec', recordingAdapter);
    buildAdapterBodyForTest(
      {
        provider,
        providerConfig,
        apiKey: 'k',
        corsProxyUrl: null,
        corsProxyKey: null,
        model,
        messages: [{ role: 'user', content: 'hi' }],
        bodyExtras: {},
        tools: [{ name: 'generate_image', description: 'make an image', parameters: { type: 'object' } }],
      },
      recordingAdapter,
    );
    expect(lastReq?.tools).toHaveLength(1);
    expect(lastReq?.tools?.[0].name).toBe('generate_image');
  });

  test('defaults reasoning to disabled when no intent is supplied', () => {
    registerAdapter('rec', recordingAdapter);
    buildAdapterBodyForTest(
      {
        provider,
        providerConfig,
        apiKey: 'k',
        corsProxyUrl: null,
        corsProxyKey: null,
        model,
        messages: [],
        bodyExtras: {},
      },
      recordingAdapter,
    );
    expect(lastReq?.reasoning).toEqual({ enabled: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/stream-completion.test.ts`
Expected: FAIL — `buildAdapterBodyForTest` / `tools` not exported / not in args.

- [ ] **Step 3: Implement dispatch in `stream-completion.ts`**

Add imports near the top of `packages/llm-unified/src/stream-completion.ts`:

```ts
import type { CanonicalRequest, ModelAdapter, ToolDef } from './adapter-contract.js';
import { getAdapter } from './adapter-registry.js';
import { parseWithAdapter } from './adapter-stream.js';
```

Add an optional `tools` field to `StreamCompletionArgs` (after `bodyExtras`):

```ts
  /**
   * Canonical tool definitions. Only the adapter path sends them (the generic
   * path ignores them). The client passes none today; the conversation-suite
   * populates this for verification.
   */
  tools?: ToolDef[];
```

Replace the final parse line and the body-build call. Where `streamCompletion` currently does `const body = buildBody(args);` and later `yield* parseOpenAiSseStream(response.body, { signal: args.signal });`, change to resolve the adapter once and branch both:

```ts
  const adapter = args.model.adapterId ? getAdapter(args.model.adapterId) : undefined;
  const body = adapter ? buildAdapterBody(args, adapter) : buildBody(args);
```

and at the end:

```ts
  if (adapter) {
    yield* parseWithAdapter(response.body, adapter, { signal: args.signal });
  } else {
    yield* parseOpenAiSseStream(response.body, { signal: args.signal });
  }
```

Add the `buildAdapterBody` function alongside `buildBody`:

```ts
/**
 * Build the wire body via a ModelAdapter. The adapter owns model/messages/
 * stream/reasoning/tools; generic sampling params (e.g. temperature) carried in
 * bodyExtras are layered on afterwards so they are never lost, and never
 * override the adapter's keys.
 */
function buildAdapterBody(args: StreamCompletionArgs, adapter: ModelAdapter): Record<string, unknown> {
  const { thinking: _thinking, reasoning: rawReasoning, ...sampling } = args.bodyExtras;
  const intent = (rawReasoning as ReasoningIntent | undefined) ?? { enabled: false };
  const req: CanonicalRequest = {
    messages: args.messages,
    reasoning: intent,
    ...(args.tools && args.tools.length > 0 ? { tools: args.tools } : {}),
  };
  const wire = adapter.buildRequest(req);
  return { ...wire.body, ...sampling };
}

// Test-only re-export so unit tests can exercise adapter-body composition
// without the network.
export const buildAdapterBodyForTest = buildAdapterBody;
```

- [ ] **Step 4: Run the new tests + the full package suite**

Run: `cd packages/llm-unified && bun test src/stream-completion.test.ts && bun test`
Expected: new tests PASS; the whole suite green (the generic path is unchanged for adapter-less models).

- [ ] **Step 5: Verify build + typecheck**

Run: `cd packages/llm-unified && bun run build && bun run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/llm-unified/src/stream-completion.ts packages/llm-unified/src/stream-completion.test.ts
git commit -m "Dispatch streamCompletion through a ModelAdapter when registered"
```

---

## Task 6: Client — explicit no-op `usage` branch

**Files:**
- Modify: `apps/user-client/src/lib/stream-engine.ts`

The chunk-handling `if/else if` chain (lines ~88-112) already ignores `usage` chunks (they match no branch). Make the deferral explicit so a future reader knows usage display is intentionally not yet wired.

- [ ] **Step 1: Add an explicit `usage` branch**

In `apps/user-client/src/lib/stream-engine.ts`, in the chunk loop, add a branch before the `error` branch:

```ts
    } else if (chunk.type === 'usage') {
      // Usage display is a later feature (Slice 2+). Adapters emit usage
      // chunks; we deliberately ignore them here for now.
    } else if (chunk.type === 'error') {
```

- [ ] **Step 2: Run the user-client unit tests**

Run: `cd apps/user-client && pnpm vitest run` (or the project's frontend test command — check `package.json` `scripts.test`)
Expected: PASS — the added no-op branch changes no behaviour; if a stream-engine test feeds chunks, a `usage` chunk is now explicitly ignored rather than implicitly.

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/lib/stream-engine.ts
git commit -m "Explicitly ignore usage chunks in the client stream engine (display deferred)"
```

---

## Final Verification

- [ ] **Whole package builds + typechecks + tests green**

Run: `cd packages/llm-unified && bun run build && bun run typecheck && bun test`
Expected: clean build, clean typecheck, all unit tests pass (registry, framing regression, parseWithAdapter, dispatch).

- [ ] **No live-provider calls in any test**

Run: `rg -n "fetch\(|llm.chutes|nano-gpt.com|api\." packages/llm-unified/src/adapter-registry.test.ts packages/llm-unified/src/adapter-stream.test.ts packages/llm-unified/src/stream-completion.test.ts`
Expected: no network calls — tests use in-memory `ReadableStream`s and fakes only.

- [ ] **Generic path regression locked**

Run: `cd packages/llm-unified && bun test src/streaming.test.ts`
Expected: PASS, same count as before Task 3 (adapter-less behaviour byte-identical).

- [ ] **Frontend still builds**

Run: `cd apps/user-client && pnpm build` (or the workspace build)
Expected: clean — the `usage` branch and the new optional `adapterId` field are backwards-compatible.

---

## Self-Review Notes (author)

- **Spec coverage:** registry+resolution (§3) → Task 1, 2; streamCompletion refactor + framing (§4) → Task 3, 4, 5; usage+tools (§5) → Task 4 (emit/parse), Task 5 (tools in CanonicalRequest), Task 6 (client ignore); `_reasoning-body` transition (§6) → preserved on the generic path, untouched (no task needed; it only retires per-provider later); testing (§7) → Tasks 1/3/4/5 + Final Verification; `/chat/completions` endpoint constraint → unchanged (`stream-completion.ts:59` already posts to `/chat/completions`; adapters produce only a body, never an endpoint). Acceptance (§8) → Final Verification.
- **Temperature** (not in the spec, surfaced from the code): handled by layering generic sampling `bodyExtras` onto the adapter body in `buildAdapterBody`, so adapter-backed models keep `temperature` (`stream-engine.ts:68` sets it).
- **Type consistency:** `CanonicalRequest { messages, reasoning, tools? }`, `WireRequest { model, body }`, `ParseState`, `ModelAdapter` all match `adapter-contract.ts`. `registerAdapter(id, adapter)` / `getAdapter(id)` consistent across Tasks 1, 2, 5. `buildAdapterBodyForTest` / `buildAdapterBody` names consistent.
- **No placeholders:** every code step shows complete code; every run step has an expected result.
