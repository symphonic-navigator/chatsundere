# xAI / Grok 4.3 Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Onboard xAI as a curated provider with one first-class model, Grok 4.3 (reasoning + vision + tools), via `/chat/completions`, including conversation-affinity prompt caching.

**Architecture:** Standard curation pattern (wafer/novita precedent): a canonical model, a provider definition with one offering, a per-model `ModelAdapter`, and client wiring. One cross-cutting addition: a `cacheKey` field threaded from the chat id through `streamCompletion` to the adapter, which emits it as the `x-grok-conv-id` header. Reasoning is display-only (xAI hands us a readable summary on `reasoning_content`); no replay, no new persistence, no Dexie migration.

**Tech Stack:** TypeScript (strict), Bun test runner (`packages/llm-unified`), Vitest (`apps/user-client`), the existing `ModelAdapter` contract.

**Spec:** [[../specs/2026-06-02-xai-grok-integration-design]]

**Larissa:** Not triggered (llm-unified + user-client only).

**Deviation from spec §4.4:** The standalone `xai-scanner` is **omitted** (YAGNI — a single hardcoded offering needs no model discovery; the runtime never calls it). The live conversation-suite runner (Task 9) is the real verification artefact.

---

## File Map

**Create:**
- `packages/llm-unified/src/adapters/xai-openai.ts` — the Grok adapter
- `packages/llm-unified/src/adapters/xai-openai.test.ts` — adapter unit tests
- `packages/llm-unified/src/providers/xai.ts` — provider + offering + register fn
- `packages/llm-unified/curation/run-xai-suite.ts` — live verification harness
- `obsidian/providers/xai.md`, `obsidian/models/grok-4.3.md` — Records

**Modify:**
- `packages/llm-unified/src/adapter-contract.ts` — add `cacheKey?` to `CanonicalRequest`
- `packages/llm-unified/src/stream-completion.ts` — add `cacheKey?` to args, thread into `buildWire`
- `packages/llm-unified/src/catalogue/canonical-registry.ts` — add the `grok-4.3` canonical
- `packages/llm-unified/src/providers/_register-builtins.ts` — call `registerXai()`
- `packages/llm-unified/src/providers/builtins.test.ts` — assert xai provider/offering
- `packages/llm-unified/src/catalogue/canonical-registry.test.ts` — assert canonical
- `apps/user-client/src/lib/built-in-providers.ts` — add xai display entry
- `apps/user-client/src/components/ProviderSheet.tsx` — add `'xai'` to the templateId union
- `apps/user-client/src/lib/stream-engine.ts` — pass `cacheKey: args.chat.id`
- `obsidian/STATUS-CLIENT-ONLY.md` — session log

---

## Task 1: Thread `cacheKey` through the adapter contract

**Files:**
- Modify: `packages/llm-unified/src/adapter-contract.ts`
- Modify: `packages/llm-unified/src/stream-completion.ts`
- Test: `packages/llm-unified/src/stream-completion.test.ts`

- [ ] **Step 1: Write the failing test** — append to `stream-completion.test.ts`. It uses a fake adapter that echoes `req.cacheKey` into a header, asserting the field reaches `buildRequest`.

```ts
import { describe, expect, it } from 'bun:test';
import type { ModelAdapter } from './adapter-contract.js';
// (reuse the file's existing imports for buildAdapterBody/buildWire if exported;
//  otherwise test via the exported `_buildWireForTests`. See Step 3.)

describe('cacheKey threading', () => {
  it('passes args.cacheKey into the CanonicalRequest the adapter receives', () => {
    let seen: string | undefined;
    const fake: ModelAdapter = {
      profile: {
        reasoning: { mode: 'none' },
        toolCalls: { supported: false, streaming: false, concurrentWithReasoning: false },
        vision: false,
        replayReasoning: false,
      },
      buildRequest(req) {
        seen = req.cacheKey;
        return { model: 'm', body: { model: 'm' } };
      },
      parseChunk(_raw, state) {
        return { events: [], state };
      },
    };
    _buildWireForTests(
      {
        provider: { id: 'xai' } as never,
        providerConfig: { baseUrl: 'x', routing: { kind: 'direct' } },
        apiKey: 'k',
        target: { slug: 'm', adapterId: 'xai:grok-4.3' },
        messages: [{ role: 'user', content: 'hi' }],
        bodyExtras: {},
        cacheKey: 'chat-uuid-123',
      } as never,
      fake,
    );
    expect(seen).toBe('chat-uuid-123');
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`cacheKey` not on the args type; `_buildWireForTests` may not exist).

Run: `cd packages/llm-unified && bun test src/stream-completion.test.ts`
Expected: FAIL (type error / undefined export).

- [ ] **Step 3: Implement.** In `adapter-contract.ts`, add to `CanonicalRequest`:

```ts
export interface CanonicalRequest {
  messages: WireMessage[];
  reasoning: ReasoningIntent;
  tools?: ToolDef[];
  /**
   * Stable per-conversation key for providers with conversation-affinity prompt
   * caching (xAI's `x-grok-conv-id`; OpenAI's `prompt_cache_key` later). Ignored
   * by adapters that don't cache by conversation.
   */
  cacheKey?: string;
}
```

In `stream-completion.ts`, add `cacheKey?: string;` to `StreamCompletionArgs` (next to `tools?`), thread it in `buildWire`:

```ts
  const req: CanonicalRequest = {
    messages: args.messages,
    reasoning: intent,
    ...(args.tools && args.tools.length > 0 ? { tools: args.tools } : {}),
    ...(args.cacheKey ? { cacheKey: args.cacheKey } : {}),
  };
```

and export a thin test hook beside `buildAdapterBody`:

```ts
/** Test hook — exposes buildWire so cacheKey/header threading can be asserted. */
export function _buildWireForTests(args: StreamCompletionArgs, adapter: ModelAdapter) {
  return buildWire(args, adapter);
}
```

- [ ] **Step 4: Run it — expect PASS.**

Run: `cd packages/llm-unified && bun test src/stream-completion.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/llm-unified/src/adapter-contract.ts packages/llm-unified/src/stream-completion.ts packages/llm-unified/src/stream-completion.test.ts
git commit -m "Thread cacheKey through CanonicalRequest for conversation-affinity caching"
```

---

## Task 2: Add the `grok-4.3` canonical model

**Files:**
- Modify: `packages/llm-unified/src/catalogue/canonical-registry.ts`
- Test: `packages/llm-unified/src/catalogue/canonical-registry.test.ts`

- [ ] **Step 1: Write the failing test** — add to `canonical-registry.test.ts`:

```ts
it('includes the grok-4.3 canonical with vision + reasoning + tools', () => {
  const grok = CANONICALS.find((c) => c.id === 'grok-4.3');
  expect(grok).toBeDefined();
  expect(grok?.requiredCaps).toEqual({ tools: true, reasoning: true, vision: true });
  expect(grok?.freedomOriented).toBe(true);
  expect(grok?.family).toBe('grok');
});
```

If the test file asserts an exact `CANONICALS.length`, bump it by 1.

- [ ] **Step 2: Run it — expect FAIL.**

Run: `cd packages/llm-unified && bun test src/catalogue/canonical-registry.test.ts`
Expected: FAIL ("grok not defined").

- [ ] **Step 3: Implement** — append to the `CANONICALS` array in `canonical-registry.ts`:

```ts
  {
    id: 'grok-4.3',
    displayName: 'Grok 4.3',
    family: 'grok',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: true,
    freedomNote: 'xAI/Grok refuses near-nothing; freedom-oriented model and deployment (Chris, 2026-06-02).',
  },
```

- [ ] **Step 4: Run it — expect PASS.**

Run: `cd packages/llm-unified && bun test src/catalogue/canonical-registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/llm-unified/src/catalogue/canonical-registry.ts packages/llm-unified/src/catalogue/canonical-registry.test.ts
git commit -m "Add grok-4.3 canonical model"
```

---

## Task 3: The Grok adapter (`xai-openai.ts`)

The meat. Mirrors `wafer-openai.ts` (identical usage shape + `reasoning_content` channel + tool reassembly), differing only in: no slug swap, default effort `low`, and the `x-grok-conv-id` header from `req.cacheKey`.

**Files:**
- Create: `packages/llm-unified/src/adapters/xai-openai.ts`
- Test: `packages/llm-unified/src/adapters/xai-openai.test.ts`

- [ ] **Step 1: Write the failing tests** (`xai-openai.test.ts`):

```ts
import { describe, expect, it } from 'bun:test';
import type { CanonicalRequest } from '../adapter-contract.js';
import { xaiAdapter } from './xai-openai.js';

const base: CanonicalRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  reasoning: { enabled: true, effort: 'low' },
};

describe('xaiAdapter buildRequest', () => {
  it('targets the grok-4.3 slug with no swap, streaming + usage', () => {
    const wire = xaiAdapter('grok-4.3', { vision: true }).buildRequest(base);
    expect(wire.model).toBe('grok-4.3');
    expect(wire.body.model).toBe('grok-4.3');
    expect(wire.body.stream).toBe(true);
    expect(wire.body.stream_options).toEqual({ include_usage: true });
  });

  it('maps reasoning effort: off->none, on->effort, default low', () => {
    const a = xaiAdapter('grok-4.3', { vision: true });
    expect(a.buildRequest({ ...base, reasoning: { enabled: false } }).body.reasoning_effort).toBe('none');
    expect(a.buildRequest({ ...base, reasoning: { enabled: true, effort: 'high' } }).body.reasoning_effort).toBe('high');
    expect(a.buildRequest({ ...base, reasoning: { enabled: true } }).body.reasoning_effort).toBe('low');
  });

  it('emits x-grok-conv-id header only when cacheKey is set', () => {
    const a = xaiAdapter('grok-4.3', { vision: true });
    expect(a.buildRequest(base).headers).toBeUndefined();
    expect(a.buildRequest({ ...base, cacheKey: 'c1' }).headers).toEqual({ 'x-grok-conv-id': 'c1' });
  });

  it('passes tools through in OpenAI function shape', () => {
    const wire = xaiAdapter('grok-4.3', { vision: true }).buildRequest({
      ...base,
      tools: [{ name: 't', description: 'd', parameters: { type: 'object' } }],
    });
    expect(wire.body.tools).toEqual([
      { type: 'function', function: { name: 't', description: 'd', parameters: { type: 'object' } } },
    ]);
  });

  it('carries the steps reasoning profile with vision', () => {
    const p = xaiAdapter('grok-4.3', { vision: true }).profile;
    expect(p.reasoning).toEqual({ mode: 'steps', steps: ['low', 'medium', 'high'], offStep: 'none', defaultStep: 'low' });
    expect(p.vision).toBe(true);
    expect(p.replayReasoning).toBe(false);
  });
});

describe('xaiAdapter parseChunk', () => {
  const a = xaiAdapter('grok-4.3', { vision: true });

  it('splits reasoning_content and content', () => {
    const r = a.parseChunk({ choices: [{ delta: { reasoning_content: 'th' } }] }, {});
    expect(r.events).toEqual([{ type: 'reasoning', text: 'th' }]);
    const c = a.parseChunk({ choices: [{ delta: { content: 'hi' } }] }, {});
    expect(c.events).toEqual([{ type: 'token', text: 'hi' }]);
  });

  it('extracts usage incl. reasoning + cached tokens', () => {
    const r = a.parseChunk(
      {
        choices: [],
        usage: {
          prompt_tokens: 163,
          completion_tokens: 64,
          total_tokens: 497,
          prompt_tokens_details: { cached_tokens: 128 },
          completion_tokens_details: { reasoning_tokens: 270 },
        },
      },
      {},
    );
    expect(r.events).toEqual([
      {
        type: 'usage',
        usage: { promptTokens: 163, completionTokens: 64, totalTokens: 497, reasoningTokens: 270, cachedTokens: 128 },
      },
    ]);
  });

  it('reassembles fragmented tool calls and emits finish', () => {
    let state = {};
    ({ state } = a.parseChunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'gen' } }] } }] }, state));
    ({ state } = a.parseChunk({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"p":1}' } }] } }] }, state));
    const fin = a.parseChunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }, state);
    expect(fin.events).toEqual([
      { type: 'tool-call', toolCallId: 'c', name: 'gen', argumentsJson: '{"p":1}' },
      { type: 'finish', reason: 'tool_calls' },
    ]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing).

Run: `cd packages/llm-unified && bun test src/adapters/xai-openai.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** `xai-openai.ts` (adapted from `wafer-openai.ts`):

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import type {
  CanonicalRequest,
  ModelAdapter,
  ModelProfile,
  ParseState,
  WireRequest,
} from '../adapter-contract.js';
import type { ReasoningControl } from '../catalogue/types.js';
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

interface XaiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
  completion_tokens_details?: { reasoning_tokens?: number } | null;
}

interface XaiDelta {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: XaiUsage | null;
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

function normaliseUsage(u: XaiUsage): NormalisedUsage {
  // Grok reports the OpenAI-standard shape (probed live 2026-06-02): reasoning
  // tokens under completion_tokens_details, cached prompt tokens under
  // prompt_tokens_details. total_tokens already includes reasoning tokens.
  const usage: NormalisedUsage = {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
  };
  const reasoning = u.completion_tokens_details?.reasoning_tokens;
  if (reasoning !== undefined && reasoning !== null) usage.reasoningTokens = reasoning;
  const cached = u.prompt_tokens_details?.cached_tokens;
  if (cached !== undefined) usage.cachedTokens = cached;
  return usage;
}

export interface XaiAdapterOptions {
  vision: boolean;
}

const REASONING: ReasoningControl = {
  mode: 'steps',
  steps: ['low', 'medium', 'high'],
  offStep: 'none',
  defaultStep: 'low',
};
const DEFAULT_ON_EFFORT = 'low';

/**
 * Grok 4.3 via xAI's OpenAI-compatible `/chat/completions`. Probed live
 * 2026-06-02: reasoning is the native `reasoning_effort` param (no slug swap),
 * `none` disables, `low|medium|high` enable (`low` is xAI's default). Reasoning
 * streams on `delta.reasoning_content` and is ALREADY the human-readable summary
 * — there is no opaque encrypted blob on the Chat Completions surface, so it is
 * display-only and never replayed (`replayReasoning: false`).
 *
 * Prompt caching uses the `x-grok-conv-id` request header: set per-request from
 * `req.cacheKey` (the chat's UUIDv7 id) so all turns of one chat route to the
 * same cache server. Usage via `stream_options.include_usage`.
 */
export function xaiAdapter(slug: string, opts: XaiAdapterOptions): ModelAdapter {
  const profile: ModelProfile = {
    reasoning: REASONING,
    toolCalls: { supported: true, streaming: true, concurrentWithReasoning: true },
    vision: opts.vision,
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
        reasoning_effort: req.reasoning.enabled
          ? (req.reasoning.effort ?? DEFAULT_ON_EFFORT)
          : 'none',
      };
      if (req.tools?.length) {
        body.tools = req.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
      }
      const wire: WireRequest = { model: slug, body };
      // Conversation-affinity caching: route same-chat turns to one server.
      if (req.cacheKey) wire.headers = { 'x-grok-conv-id': req.cacheKey };
      return wire;
    },

    parseChunk(raw: unknown, state: ParseState): { events: StreamChunk[]; state: ParseState } {
      const events: StreamChunk[] = [];
      const p = raw as XaiDelta;

      if (p.usage) events.push({ type: 'usage', usage: normaliseUsage(p.usage) });

      const choice = p.choices?.[0];
      if (!choice) return { events, state };

      if (choice.delta?.reasoning_content)
        events.push({ type: 'reasoning', text: choice.delta.reasoning_content });
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
}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `cd packages/llm-unified && bun test src/adapters/xai-openai.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit.**

```bash
git add packages/llm-unified/src/adapters/xai-openai.ts packages/llm-unified/src/adapters/xai-openai.test.ts
git commit -m "Add Grok 4.3 adapter (reasoning_effort, x-grok-conv-id caching)"
```

---

## Task 4: Provider definition + registration

**Files:**
- Create: `packages/llm-unified/src/providers/xai.ts`
- Modify: `packages/llm-unified/src/providers/_register-builtins.ts`
- Test: `packages/llm-unified/src/providers/builtins.test.ts`

- [ ] **Step 1: Write the failing test** — add to `builtins.test.ts` (match its existing assertion style; if it counts providers, bump the count by 1):

```ts
it('registers xai with a single verified grok-4.3 offering', () => {
  const p = getProvider('xai');
  expect(p?.corsHint).toBe('requires-proxy');
  expect(p?.capabilities).toContain('vision');
  expect(p?.offerings).toHaveLength(1);
  const o = p?.offerings[0];
  expect(o?.canonicalRef).toBe('grok-4.3');
  expect(o?.context).toEqual({ recommended: 200_000, max: 1_000_000 });
  expect(o?.trust).toEqual({ tee: false, zdr: false, jurisdiction: 'US' });
  expect(o?.freedomOrientedDeployment).toBe(true);
  expect(o?.confidence).toBe('verified');
});
```

(Ensure `getProvider` is imported as the other cases do, and that the suite calls `registerBuiltinProviders()` in its setup as it already does for wafer.)

- [ ] **Step 2: Run — expect FAIL.**

Run: `cd packages/llm-unified && bun test src/providers/builtins.test.ts`
Expected: FAIL ("xai" provider not found).

- [ ] **Step 3: Implement** `xai.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { registerAdapter } from '../adapter-registry.js';
import { xaiAdapter } from '../adapters/xai-openai.js';
import type { Offering } from '../catalogue/types.js';
import { registerProvider } from '../registry.js';
import type { ProviderDefinition } from '../types.js';
import { apiKeyField } from './_helpers.js';

const offerings: Offering[] = [
  {
    canonicalRef: 'grok-4.3',
    providerId: 'xai',
    upstreamSlug: 'grok-4.3',
    adapter: { kind: 'catalogue', adapterId: 'xai:grok-4.3' },
    profile: {
      reasoning: { mode: 'steps', steps: ['low', 'medium', 'high'], offStep: 'none', defaultStep: 'low' },
      toolCalls: { supported: true, streaming: true, concurrentWithReasoning: true },
      vision: true,
      replayReasoning: false,
    },
    // Above 200k xAI roughly doubles the price; recommended sits at the cheap
    // band, max is xAI's 1M ceiling (Chris 2026-06-02 — "compact and continue").
    context: { recommended: 200_000, max: 1_000_000 },
    // US jurisdiction, no TEE/ZDR today. (NGO-negotiated ZDR is a future
    // possibility — venice.ai precedent — which would flip zdr + add a header.)
    trust: { tee: false, zdr: false, jurisdiction: 'US' },
    freedomOrientedDeployment: true, // Chris: xAI/Grok refuses near-nothing
    source: 'curated',
    confidence: 'verified', // set after run-xai-suite.ts passes (Task 9)
    serviceKind: 'llm',
  },
];

export const xai: ProviderDefinition = {
  id: 'xai',
  displayName: 'xAI',
  iconKey: 'xai',
  baseUrl: 'https://api.x.ai/v1',
  shape: 'openai-chat-completions',
  capabilities: ['llm', 'streaming', 'tools', 'vision'],
  configFields: [apiKeyField('xAI API key')],
  probe: { path: '/models', method: 'GET' },
  secretFields: new Set(['api_key']),
  // api.x.ai sends no Access-Control-* headers; an authenticated browser POST
  // (with the x-grok-conv-id header) needs a preflight xAI does not honour →
  // routed through the CORS proxy. Node/Bun (the live suite) is unaffected.
  corsHint: 'requires-proxy',
  offerings,
  // Freedom-oriented but US jurisdiction, no TEE/ZDR, premium-priced → ranked
  // after the privacy-forward providers.
  sortPriority: 20,
};

export function registerXai(): void {
  registerProvider(xai);
  for (const o of offerings) {
    if (o.adapter.kind === 'catalogue') {
      registerAdapter(o.adapter.adapterId, xaiAdapter(o.upstreamSlug, { vision: o.profile.vision }));
    }
  }
}
```

Then in `_register-builtins.ts` add the import and call:

```ts
import { registerXai } from './xai.js';
// ... inside registerBuiltinProviders(), beside the other freedom-first providers:
  registerXai();
```

- [ ] **Step 4: Run — expect PASS** (full builtins + canonical suites green).

Run: `cd packages/llm-unified && bun test src/providers/builtins.test.ts src/catalogue/canonical-registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/llm-unified/src/providers/xai.ts packages/llm-unified/src/providers/_register-builtins.ts packages/llm-unified/src/providers/builtins.test.ts
git commit -m "Register xai provider with the grok-4.3 offering"
```

---

## Task 5: Client display wiring

**Files:**
- Modify: `apps/user-client/src/lib/built-in-providers.ts`
- Modify: `apps/user-client/src/components/ProviderSheet.tsx`
- Test: `apps/user-client/src/lib/built-in-providers.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test** (`built-in-providers.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { BUILT_IN_PROVIDERS } from './built-in-providers.js';

describe('BUILT_IN_PROVIDERS', () => {
  it('includes xAI with a monogram', () => {
    const xai = BUILT_IN_PROVIDERS.find((p) => p.id === 'xai');
    expect(xai).toEqual({ id: 'xai', name: 'xAI', monogram: 'xA' });
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `cd apps/user-client && pnpm vitest run src/lib/built-in-providers.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Add to the `BUILT_IN_PROVIDERS` array in `built-in-providers.ts` (freedom-first ordering, near the privacy providers — place after `wafer`):

```ts
  { id: 'xai', name: 'xAI', monogram: 'xA' },
```

In `ProviderSheet.tsx`, add `'xai'` to the `templateId` union (the `| 'wafer' | ...` list):

```ts
    | 'xai'
```

- [ ] **Step 4: Run — expect PASS.**

Run: `cd apps/user-client && pnpm vitest run src/lib/built-in-providers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/user-client/src/lib/built-in-providers.ts apps/user-client/src/components/ProviderSheet.tsx apps/user-client/src/lib/built-in-providers.test.ts
git commit -m "Wire xAI into the client provider list"
```

---

## Task 6: Pass the chat id as cacheKey from the stream engine

**Files:**
- Modify: `apps/user-client/src/lib/stream-engine.ts`
- Test: `apps/user-client/src/lib/stream-engine.test.ts` (extend, or create a focused test)

- [ ] **Step 1: Write the failing test.** Assert the `streamCompletion` call receives `cacheKey === args.chat.id`. If `stream-engine` is hard to unit-test in isolation, add the assertion by mocking `@chatsundere/llm-unified`'s `streamCompletion` and capturing its argument:

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('@chatsundere/llm-unified', async (orig) => {
  const mod = await orig<typeof import('@chatsundere/llm-unified')>();
  return { ...mod, streamCompletion: vi.fn(async function* () { /* no chunks */ }) };
});

import { streamCompletion } from '@chatsundere/llm-unified';
import { runStreamEngine } from './stream-engine.js';
// ...build a minimal StartStreamArgs with chat.id = 'chat-7' (reuse a test factory
// if the file already has one; otherwise construct the rows inline)...

it('passes the chat id as cacheKey', async () => {
  await runStreamEngine(makeArgs({ chatId: 'chat-7' }));
  expect(streamCompletion).toHaveBeenCalledWith(expect.objectContaining({ cacheKey: 'chat-7' }));
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `cd apps/user-client && pnpm vitest run src/lib/stream-engine.test.ts`
Expected: FAIL (cacheKey not passed).

- [ ] **Step 3: Implement.** In `stream-engine.ts`, add `cacheKey: args.chat.id,` to the `streamCompletion({ ... })` call (beside `target`/`messages`):

```ts
  for await (const chunk of streamCompletion({
    provider: args.provider,
    providerConfig: args.providerConfig,
    apiKey: args.apiKey,
    corsProxyUrl: args.corsProxyUrl,
    corsProxyKey: args.corsProxyKey,
    target: offeringToTarget(args.offering),
    messages: wireMessages,
    bodyExtras: extras,
    cacheKey: args.chat.id,
    signal: args.signal,
    onRetry: (e) => console.warn(formatRetryEvent(e)),
  })) {
```

- [ ] **Step 4: Run — expect PASS.**

Run: `cd apps/user-client && pnpm vitest run src/lib/stream-engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/user-client/src/lib/stream-engine.ts apps/user-client/src/lib/stream-engine.test.ts
git commit -m "Pass chat id as cacheKey so Grok caches per conversation"
```

---

## Task 7: Records

**Files:**
- Create: `obsidian/providers/xai.md`
- Create: `obsidian/models/grok-4.3.md`

- [ ] **Step 1: Write `obsidian/providers/xai.md`** — provider record: base URL `https://api.x.ai/v1`, `corsHint: requires-proxy` (no CORS headers), probe `GET /models`, freedom-oriented deployment, US jurisdiction, no TEE/ZDR **today** (note the NGO-ZDR future per [[project_xai_zdr_negotiation_possible]]), `sortPriority: 20`, the `x-grok-conv-id` caching mechanism, and the probed facts from spec §2.

- [ ] **Step 2: Write `obsidian/models/grok-4.3.md`** — model record: Grok 4.3, family grok, reasoning `steps` low/medium/high (default low, default-on), vision yes, tools yes, context recommended 200k / max 1M, the summarised-`reasoning_content` finding, no encrypted blob on Chat Completions, `replayReasoning: false`, usage shape, the live-suite verdict (filled after Task 9).

- [ ] **Step 3: Commit** (doc-only).

```bash
git add obsidian/providers/xai.md obsidian/models/grok-4.3.md
git commit -m "Add xAI provider and Grok 4.3 model records [skip ci]"
```

---

## Task 8: Static verification gate

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the repo** (the CI gate — covers tests too, [[feedback_typecheck_is_the_ci_gate]]).

Run: `pnpm typecheck`
Expected: clean (13/13 or current baseline).

- [ ] **Step 2: Full llm-unified Bun suite.**

Run: `cd packages/llm-unified && bun test`
Expected: all green (prior baseline + the new xai cases).

- [ ] **Step 3: Full user-client Vitest suite.**

Run: `cd apps/user-client && pnpm vitest run`
Expected: the new tests pass; the only failures are the known pre-existing `cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom baseline (8 fails). **Verify that baseline is identical on `master`** before attributing any failure to "pre-existing" ([[feedback_per_task_review_runs_full_suite]]).

- [ ] **Step 4: Build.**

Run: `pnpm run build`
Expected: clean.

- [ ] **Step 5: Commit** any lint/format fixups only if produced. (No commit if nothing changed.)

---

## Task 9: Live conversation-suite (the curation gate)

**Files:**
- Create: `packages/llm-unified/curation/run-xai-suite.ts`

This runs locally with `keys/.xai-test-key`, NEVER in CI (CLAUDE.md §10). It is the gate that justifies `confidence: 'verified'`.

- [ ] **Step 1: Create `run-xai-suite.ts`** (mirrors `run-wafer-suite.ts`):

```ts
// SPDX-License-Identifier: LGPL-3.0-only
//
// Live verification harness for the xAI Grok offering (run via /curate, NEVER in
// CI — needs keys/.xai-test-key). Runs the conversation-suite across the full
// reasoning permutation matrix plus the vision scenario. Prints a PASS/FAIL report.
//
//   bun run curation/run-xai-suite.ts        (from packages/llm-unified)
import { readFileSync } from 'node:fs';
import type { ToolDef } from '../src/adapter-contract.js';
import { xaiAdapter } from '../src/adapters/xai-openai.js';
import { xai } from '../src/providers/xai.js';
import type { ProviderConfig } from '../src/types.js';
import {
  type ReasoningPermutation,
  coreScenario,
  makeLiveBinding,
  permutationsForReasoning,
  renderSuiteReport,
  runSuite,
  visionScenario,
} from './conversation-suite/index.js';

const apiKey = readFileSync(new URL('../../../keys/.xai-test-key', import.meta.url), 'utf8').trim();

const providerConfig: ProviderConfig = {
  baseUrl: xai.baseUrl,
  routing: { kind: 'direct' }, // server-side: no CORS, talk to xAI directly
};

const tools: ToolDef[] = [
  {
    name: 'generate_image',
    description: 'Generate an image from a text prompt.',
    parameters: {
      type: 'object',
      properties: { prompt: { type: 'string', description: 'What to draw.' } },
      required: ['prompt'],
    },
  },
];

const VISION_PERM: ReasoningPermutation[] = [{ label: 'default', intent: { enabled: false } }];

for (const o of xai.offerings) {
  const adapter = xaiAdapter(o.upstreamSlug, { vision: o.profile.vision });
  const binding = makeLiveBinding({
    offeringRef: `xai:${o.upstreamSlug}`,
    providerConfig,
    apiKey,
    adapter,
    tools,
  });

  console.log(`\n${'='.repeat(72)}\nOFFERING xai:${o.upstreamSlug}\n${'='.repeat(72)}`);

  const perms = permutationsForReasoning(o.profile.reasoning);
  const core = await runSuite(coreScenario, perms, binding);
  console.log(renderSuiteReport(core));

  if (o.profile.vision) {
    const vision = await runSuite(visionScenario, VISION_PERM, binding);
    console.log(renderSuiteReport(vision));
  }
}

console.log('\nDONE.');
```

- [ ] **Step 2: Run it** (needs a live `keys/.xai-test-key`).

Run: `cd packages/llm-unified && bun run curation/run-xai-suite.ts`
Expected, against the real wire:
  1. reasoning **off** (`none`) → no trace leaks (rule out the wafer/Kimi `fixed-on` failure);
  2. low / medium / high → trace + answer;
  3. **vision** → real test image described correctly;
  4. **tools** → `generate_image` fires and reassembles;
  5. **memory/recall** turn green;
  6. usage carries `cachedTokens` on a repeated `x-grok-conv-id`.

**Contingency:** if reasoning-off leaks a trace (like wafer's Kimi), change the offering's reasoning control to `{ mode: 'fixed-on' }` and the adapter's `REASONING` accordingly, and re-run. If `medium`/`high` are rejected, fall back to `toggle`. Record whichever holds.

- [ ] **Step 3: Commit** the runner (doc/tooling — touches code, so NO `[skip ci]`).

```bash
git add packages/llm-unified/curation/run-xai-suite.ts
git commit -m "Add live conversation-suite runner for xAI Grok 4.3"
```

---

## Task 10: STATUS update + squash

**Files:**
- Modify: `obsidian/STATUS-CLIENT-ONLY.md`

- [ ] **Step 1: Update STATUS-CLIENT-ONLY.md** — new top entry: xAI/Grok 4.3 onboarded; the probed facts (summarised `reasoning_content`, no encrypted blob, cache via `x-grok-conv-id`); the `cacheKey` threading addition; the live-suite verdict; "Not a Larissa change"; verification numbers. Refresh `Last updated:`.

- [ ] **Step 2: Commit the STATUS** (doc-only).

```bash
git add obsidian/STATUS-CLIENT-ONLY.md
git commit -m "Update client STATUS: xAI/Grok 4.3 onboarded [skip ci]"
```

- [ ] **Step 3: Squash** the feature commits (Tasks 1–9 code commits) into one per CLAUDE.md §8 — "Add xAI/Grok 4.3 provider integration" — keeping the spec/plan/STATUS doc commits separate. (Liz does the squash; subagents never merge/push/switch branches.)

---

## Self-Review

**Spec coverage:** §2 facts → encoded in adapter (Task 3) + records (Task 7). §3 decisions: scope/vision (Task 2,3,4), reasoning steps (Task 3), context (Task 4), caching (Tasks 1,3,6), freedom (Task 4), proxy (Task 4). §4 architecture → Tasks 2–6. §5 reasoning → Task 3. §6 cache threading → Tasks 1,3,6. §7 testing → Tasks 3,8,9. §8 no-new-shapes → honoured (only `cacheKey` added). §9 manual verification → device steps live in the spec; §10 out-of-scope respected (no image-gen, no 4.20, no encrypted replay). §11 Larissa → noted. **Gap intentionally closed:** spec §4.4 scanner omitted (YAGNI) — flagged at the top.

**Placeholders:** none — every code step shows complete code; the records (Task 7) and STATUS (Task 10) are prose artefacts with enumerated contents.

**Type consistency:** `xaiAdapter(slug, { vision })` signature is identical across Tasks 3, 4, 9. `cacheKey` is the same field name in `CanonicalRequest`, `StreamCompletionArgs`, `buildWire`, and the `stream-engine` call (Tasks 1, 6). The reasoning control literal `{ mode: 'steps', steps: ['low','medium','high'], offStep: 'none', defaultStep: 'low' }` is identical in the adapter (Task 3) and the offering (Task 4).
