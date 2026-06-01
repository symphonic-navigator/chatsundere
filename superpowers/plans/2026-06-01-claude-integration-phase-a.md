# Claude Integration (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate seven Claude models (Haiku 4.5; Sonnet 4.5/4.6; Opus 4.5/4.6/4.7/4.8) via OpenRouter, with refined Anthropic prompt-cache breakpoints, reasoning-effort steps, and the honest CENSORED badge — all live-verifiable today.

**Architecture:** Claude rides OpenRouter's OpenAI-compatible `/chat/completions`. A dedicated adapter reuses the existing OpenRouter adapter wholesale and adds one thing: it injects Anthropic `cache_control` breakpoints (stable prefix + token-anchored history point + rolling tail) onto the message content, which OpenRouter passes through verbatim. Reasoning uses the unified `reasoning` object. The CENSORED badge is derived from the existing `effectiveFreedom()` (`canonical.freedomOriented=false` × `deployment=true` → `'restricted'`), no new data field. Signature/thinking replay is deliberately deferred (no live tool-loop consumer — see spec §5.2).

**Tech Stack:** TypeScript (strict), Bun test runner (llm-unified), Vitest (user-client), React 18, Tailwind v4. Package manager pnpm + Turborepo.

**Spec:** `superpowers/specs/2026-06-01-premium-model-integration-design.md`

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/llm-unified/src/types.ts` | Add optional `cache_control` to `WireContentPart` | Modify |
| `packages/llm-unified/src/adapters/_anthropic-cache.ts` | Pure breakpoint computation + content-marking | Create |
| `packages/llm-unified/src/adapters/_anthropic-cache.test.ts` | Unit tests for the module | Create |
| `packages/llm-unified/src/adapters/anthropic-claude.ts` | Claude adapter (OpenRouter shape + cache injection) | Create |
| `packages/llm-unified/src/adapters/anthropic-claude.test.ts` | Unit tests for the adapter | Create |
| `packages/llm-unified/src/catalogue/canonical-registry.ts` | Add 7 Claude canonicals | Modify |
| `packages/llm-unified/src/providers/openrouter.ts` | Add Claude offerings + register Claude adapters | Modify |
| `packages/llm-unified/src/providers/builtins.test.ts` | Assert Claude offerings registered | Modify |
| `apps/user-client/src/routes/app/persona-editor.tsx` | `FreedomBadge` + `effectiveFreedom` wiring | Modify |
| `packages/llm-unified/curation/run-claude-suite.ts` | Live probe (manual, non-CI) | Create |
| `obsidian/decisions/0032-premium-censored-models-via-routers.md` | ADR | Create |
| `obsidian/models/claude-*.md` (×7), `obsidian/providers/nano-gpt.md` | Curation records | Create |

**Conventions (verified in-repo):** Bun tests import from `'bun:test'`, co-located `*.test.ts`. Run llm-unified tests with `cd packages/llm-unified && bun test <path>`. Typecheck (the CI gate) with `pnpm typecheck` from repo root. Frontend tests: `cd apps/user-client && pnpm test <path>` (vitest run). SPDX header on every source file: `LGPL-3.0-only` for `packages/llm-unified`, `AGPL-3.0-only` for `apps/user-client`. British English everywhere.

---

## Task 1: Allow `cache_control` on wire content parts

**Files:**
- Modify: `packages/llm-unified/src/types.ts:51-64`

- [ ] **Step 1: Extend `WireContentPart` and document it**

In `packages/llm-unified/src/types.ts`, replace the `WireContentPart` definition (currently lines 51-53) with:

```typescript
/** Anthropic ephemeral prompt-cache marker. OpenRouter passes this through to
 * Anthropic verbatim on the OpenAI-compatible surface. Only the Claude adapter
 * ever sets it; every other adapter leaves content parts unmarked. */
export interface CacheControl {
  type: 'ephemeral';
  ttl?: '5m' | '1h';
}

/**
 * One part of a multimodal message body (OpenAI shape). A plain-text message
 * uses the `string` content form; a message carrying an image uses the array
 * form with one `text` part and one or more `image_url` parts (data URL or
 * remote URL). Every provider we curate accepts this on a `user` message.
 * The optional `cache_control` marker is Claude-only (see CacheControl).
 */
export type WireContentPart =
  | { type: 'text'; text: string; cache_control?: CacheControl }
  | { type: 'image_url'; image_url: { url: string }; cache_control?: CacheControl };
```

- [ ] **Step 2: Verify typecheck still passes**

Run: `pnpm typecheck`
Expected: PASS (the new field is optional, so all existing adapters and call-sites still type-check).

- [ ] **Step 3: Commit**

```bash
git add packages/llm-unified/src/types.ts
git commit -m "Allow optional cache_control on wire content parts (Claude prep)"
```

---

## Task 2: Anthropic cache-breakpoint module

**Files:**
- Create: `packages/llm-unified/src/adapters/_anthropic-cache.ts`
- Test: `packages/llm-unified/src/adapters/_anthropic-cache.test.ts`

The strategy (spec §5.1): up to three breakpoints — **BP1** the leading system message (stable prefix, 1h), **BP2** a token-anchored history point that snaps to a coarse grid so it stays put across turns (1h), **BP3** the rolling tail (5m default). Anthropic auto-reads the longest cached prefix, so the tail only writes the delta. Token estimate is a cheap char/4 heuristic — precision is irrelevant to anchor cadence.

- [ ] **Step 1: Write the failing tests**

Create `packages/llm-unified/src/adapters/_anthropic-cache.test.ts`:

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import type { WireContentPart, WireMessage } from '../types.js';
import { applyCacheControl, computeCacheBreakpoints } from './_anthropic-cache.js';

/** A message whose text is `n` characters long (≈ n/4 tokens). */
function msg(role: WireMessage['role'], chars: number): WireMessage {
  return { role, content: 'x'.repeat(chars) };
}

describe('computeCacheBreakpoints', () => {
  it('returns no breakpoints for an empty conversation', () => {
    expect(computeCacheBreakpoints([])).toEqual([]);
  });

  it('marks only the rolling tail when there is no system message', () => {
    const messages = [msg('user', 40)];
    expect(computeCacheBreakpoints(messages)).toEqual([{ index: 0, ttl: '5m' }]);
  });

  it('marks the system prefix (1h) and the tail (5m) for a short conversation', () => {
    const messages = [msg('system', 100), msg('user', 40)];
    expect(computeCacheBreakpoints(messages)).toEqual([
      { index: 0, ttl: '1h' },
      { index: 1, ttl: '5m' },
    ]);
  });

  it('adds a token-anchored history breakpoint once settled history crosses the grid', () => {
    // grid 100 tokens = 400 chars. system 400 chars (100 tok). Then several
    // 400-char turns. Settled = everything but the tail.
    const messages = [
      msg('system', 400), // idx0 cum=100
      msg('user', 400), // idx1 cum=200
      msg('assistant', 400), // idx2 cum=300
      msg('user', 400), // idx3 cum=400
      msg('assistant', 400), // idx4 cum=500  <- tail (excluded from settled)
    ];
    // settled = cum[3] = 400; target = floor(400/100)*100 = 400.
    // largest idx in (0, 4) with cum<=400 is idx3.
    expect(computeCacheBreakpoints(messages, { anchorGridTokens: 100 })).toEqual([
      { index: 0, ttl: '1h' },
      { index: 3, ttl: '1h' },
      { index: 4, ttl: '5m' },
    ]);
  });

  it('keeps the anchor stable when a short turn is appended within the same grid band', () => {
    const base = [msg('system', 400), msg('user', 400), msg('assistant', 400), msg('user', 400)];
    const a = computeCacheBreakpoints([...base, msg('assistant', 400)], { anchorGridTokens: 100 });
    // append one more tiny turn — settled grows by little, anchor band unchanged
    const b = computeCacheBreakpoints([...base, msg('assistant', 400), msg('user', 4)], {
      anchorGridTokens: 100,
    });
    const anchorA = a.find((bp) => bp.ttl === '1h' && bp.index !== 0)?.index;
    const anchorB = b.find((bp) => bp.ttl === '1h' && bp.index !== 0)?.index;
    expect(anchorB).toBe(anchorA);
  });

  it('honours a 1h tail TTL override', () => {
    const messages = [msg('system', 100), msg('user', 40)];
    expect(computeCacheBreakpoints(messages, { tailTtl: '1h' })).toEqual([
      { index: 0, ttl: '1h' },
      { index: 1, ttl: '1h' },
    ]);
  });

  it('never emits more than four breakpoints', () => {
    const messages = Array.from({ length: 50 }, (_, i) =>
      msg(i === 0 ? 'system' : i % 2 ? 'user' : 'assistant', 400),
    );
    expect(computeCacheBreakpoints(messages, { anchorGridTokens: 100 }).length).toBeLessThanOrEqual(
      4,
    );
  });
});

describe('applyCacheControl', () => {
  it('promotes a string system message to the array form with an ephemeral marker', () => {
    const out = applyCacheControl([msg('system', 100), msg('user', 40)]);
    const sys = out[0];
    expect(Array.isArray(sys?.content)).toBe(true);
    const part = (sys?.content as WireContentPart[])[0];
    expect(part).toEqual({ type: 'text', text: 'x'.repeat(100), cache_control: { type: 'ephemeral', ttl: '1h' } });
  });

  it('marks the last content part of an array-form message', () => {
    const messages: WireMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }, { type: 'image_url', image_url: { url: 'data:...' } }] },
    ];
    const out = applyCacheControl(messages);
    const parts = out[0]?.content as WireContentPart[];
    expect(parts[1]?.cache_control).toEqual({ type: 'ephemeral', ttl: '5m' });
    expect(parts[0]?.cache_control).toBeUndefined();
  });

  it('leaves unmarked messages untouched (referential passthrough for non-breakpoint indices)', () => {
    const messages = [msg('system', 100), msg('user', 40), msg('assistant', 40), msg('user', 40)];
    const out = applyCacheControl(messages, { anchorGridTokens: 1_000_000 });
    // grid huge → no anchor; only idx0 and tail marked. idx1, idx2 unchanged.
    expect(out[1]).toBe(messages[1]);
    expect(out[2]).toBe(messages[2]);
  });

  it('returns the original array reference when there are no breakpoints', () => {
    const messages: WireMessage[] = [];
    expect(applyCacheControl(messages)).toBe(messages);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/llm-unified && bun test src/adapters/_anthropic-cache.test.ts`
Expected: FAIL — "Cannot find module './_anthropic-cache.js'".

- [ ] **Step 3: Implement the module**

Create `packages/llm-unified/src/adapters/_anthropic-cache.ts`:

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import type { CacheControl, WireContentPart, WireMessage } from '../types.js';

/** Anthropic ephemeral-cache TTL. 5m is the default tier; 1h is long-lived. */
export type CacheTtl = '5m' | '1h';

export interface CacheBreakpoint {
  /** Index into the messages array whose content gets the cache_control marker. */
  index: number;
  ttl: CacheTtl;
}

export interface CacheOptions {
  /** TTL for the rolling-tail breakpoint. Default '5m'. */
  tailTtl?: CacheTtl;
  /** Token grid the history anchor snaps to, for cross-turn stability. Default 8192. */
  anchorGridTokens?: number;
}

/** Cheap, deterministic token estimate: ~4 chars per token over the message text. */
function estimateTokens(m: WireMessage): number {
  const text =
    typeof m.content === 'string'
      ? m.content
      : m.content.map((p) => (p.type === 'text' ? p.text : '')).join('');
  return Math.ceil(text.length / 4);
}

/**
 * Compute up to three cache breakpoints for an Anthropic request:
 *  - BP1: the leading system message (stable prefix), 1h.
 *  - BP2: a token-anchored history point, snapped to a coarse grid so it stays
 *    put across turns and only advances when a new grid band is crossed, 1h.
 *  - BP3: the rolling tail (last message), default 5m.
 * Anthropic auto-reads the longest cached prefix, so the tail writes only the
 * delta. Deterministic and stateless — same messages always yield the same
 * breakpoints, which is what makes the cached prefix reusable across turns.
 */
export function computeCacheBreakpoints(
  messages: WireMessage[],
  opts: CacheOptions = {},
): CacheBreakpoint[] {
  const tailTtl = opts.tailTtl ?? '5m';
  const grid = opts.anchorGridTokens ?? 8192;
  const last = messages.length - 1;
  if (last < 0) return [];

  const bps: CacheBreakpoint[] = [];

  // BP1 — stable prefix: a leading system message, if present.
  const hasSystem = messages[0]?.role === 'system';
  const prefixEnd = hasSystem ? 0 : -1;
  if (hasSystem) bps.push({ index: 0, ttl: '1h' });

  // Cumulative token counts.
  const cum: number[] = [];
  let running = 0;
  for (let i = 0; i <= last; i++) {
    running += estimateTokens(messages[i] as WireMessage);
    cum[i] = running;
  }

  // BP2 — history anchor: snap to the largest grid multiple of the SETTLED
  // history (everything but the rolling tail). Skipped when there isn't a full
  // grid band yet, or it would coincide with the prefix or the tail.
  const settledTokens = last > 0 ? (cum[last - 1] ?? 0) : 0;
  const target = Math.floor(settledTokens / grid) * grid;
  if (target > 0) {
    let anchorIdx = -1;
    for (let i = prefixEnd + 1; i < last; i++) {
      if ((cum[i] ?? 0) <= target) anchorIdx = i;
      else break;
    }
    if (anchorIdx > prefixEnd) bps.push({ index: anchorIdx, ttl: '1h' });
  }

  // BP3 — rolling tail.
  if (last > prefixEnd) bps.push({ index: last, ttl: tailTtl });

  return bps;
}

/** Attach an ephemeral marker to the last content part, promoting string content. */
function withCacheControl(m: WireMessage, ttl: CacheTtl): WireMessage {
  const marker: CacheControl = { type: 'ephemeral', ttl };
  if (typeof m.content === 'string') {
    const part: WireContentPart = { type: 'text', text: m.content, cache_control: marker };
    return { ...m, content: [part] };
  }
  const parts: WireContentPart[] = m.content.map((p) => ({ ...p }));
  const lastPart = parts[parts.length - 1];
  if (lastPart) lastPart.cache_control = marker;
  return { ...m, content: parts };
}

/**
 * Return a copy of `messages` with cache_control markers applied at the computed
 * breakpoints. Unmarked messages are passed through by reference. Returns the
 * original array reference when there are no breakpoints (empty input).
 */
export function applyCacheControl(
  messages: WireMessage[],
  opts: CacheOptions = {},
): WireMessage[] {
  const bps = computeCacheBreakpoints(messages, opts);
  if (bps.length === 0) return messages;
  const ttlByIndex = new Map(bps.map((b) => [b.index, b.ttl]));
  return messages.map((m, i) => {
    const ttl = ttlByIndex.get(i);
    return ttl ? withCacheControl(m, ttl) : m;
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/llm-unified && bun test src/adapters/_anthropic-cache.test.ts`
Expected: PASS (all assertions).

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add packages/llm-unified/src/adapters/_anthropic-cache.ts packages/llm-unified/src/adapters/_anthropic-cache.test.ts
git commit -m "Add Anthropic cache-breakpoint module (token-anchored, deterministic)"
```

---

## Task 3: Claude adapter

**Files:**
- Create: `packages/llm-unified/src/adapters/anthropic-claude.ts`
- Test: `packages/llm-unified/src/adapters/anthropic-claude.test.ts`

The adapter reuses `openRouterAdapter` wholesale (same reasoning object, same SSE parsing on `delta.reasoning`) and overrides only `buildRequest` to inject cache_control onto the messages. No native Anthropic shape — OpenRouter's OpenAI-compatible surface passes cache_control through.

- [ ] **Step 1: Write the failing tests**

Create `packages/llm-unified/src/adapters/anthropic-claude.test.ts`:

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import type { CanonicalRequest, ParseState } from '../adapter-contract.js';
import type { ReasoningControl } from '../catalogue/types.js';
import type { WireContentPart, WireMessage } from '../types.js';
import { claudeAdapter } from './anthropic-claude.js';

const STEPS: ReasoningControl = {
  mode: 'steps',
  steps: ['low', 'medium', 'high'],
  offStep: 'off',
  defaultStep: 'medium',
};

function req(partial: Partial<CanonicalRequest>): CanonicalRequest {
  return {
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ],
    reasoning: { enabled: false },
    ...partial,
  };
}

describe('claudeAdapter.buildRequest', () => {
  it('targets the given slug and streams with usage', () => {
    const wire = claudeAdapter('anthropic/claude-opus-4.8', { vision: true, reasoning: STEPS }).buildRequest(
      req({}),
    );
    expect(wire.model).toBe('anthropic/claude-opus-4.8');
    expect(wire.body.stream).toBe(true);
    expect(wire.body.stream_options).toEqual({ include_usage: true });
  });

  it('injects cache_control on the system prefix and the rolling tail', () => {
    const wire = claudeAdapter('anthropic/claude-opus-4.8', { vision: true, reasoning: STEPS }).buildRequest(
      req({}),
    );
    const messages = wire.body.messages as WireMessage[];
    const sysPart = (messages[0]?.content as WireContentPart[])[0];
    const tailPart = (messages[1]?.content as WireContentPart[])[0];
    expect(sysPart?.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(tailPart?.cache_control).toEqual({ type: 'ephemeral', ttl: '5m' });
  });

  it('emits the unified reasoning object with the chosen effort', () => {
    const wire = claudeAdapter('anthropic/claude-opus-4.8', { vision: true, reasoning: STEPS }).buildRequest(
      req({ reasoning: { enabled: true, effort: 'high' } }),
    );
    expect(wire.body.reasoning).toEqual({ enabled: true, effort: 'high' });
  });

  it('sends a genuine off when reasoning is disabled', () => {
    const wire = claudeAdapter('anthropic/claude-opus-4.8', { vision: true, reasoning: STEPS }).buildRequest(
      req({ reasoning: { enabled: false } }),
    );
    expect(wire.body.reasoning).toEqual({ enabled: false });
  });
});

describe('claudeAdapter.parseChunk', () => {
  const a = claudeAdapter('anthropic/claude-opus-4.8', { vision: true, reasoning: STEPS });

  it('emits reasoning then token events (delegated to the OpenRouter parser)', () => {
    const state: ParseState = {};
    const r1 = a.parseChunk({ choices: [{ delta: { reasoning: 'thinking…' } }] }, state);
    const r2 = a.parseChunk({ choices: [{ delta: { content: 'Hi' } }] }, r1.state);
    expect(r1.events).toEqual([{ type: 'reasoning', text: 'thinking…' }]);
    expect(r2.events).toEqual([{ type: 'token', text: 'Hi' }]);
  });
});

describe('claudeAdapter.profile', () => {
  it('reports the offering reasoning control and defers reasoning replay', () => {
    const a = claudeAdapter('anthropic/claude-opus-4.8', { vision: true, reasoning: STEPS });
    expect(a.profile.reasoning).toBe(STEPS);
    expect(a.profile.vision).toBe(true);
    // Signature replay is deferred (spec §5.2); no replay wired today.
    expect(a.profile.replayReasoning).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/llm-unified && bun test src/adapters/anthropic-claude.test.ts`
Expected: FAIL — "Cannot find module './anthropic-claude.js'".

- [ ] **Step 3: Implement the adapter**

Create `packages/llm-unified/src/adapters/anthropic-claude.ts`:

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import type {
  CanonicalRequest,
  ModelAdapter,
  ParseState,
  WireRequest,
} from '../adapter-contract.js';
import type { ReasoningControl } from '../catalogue/types.js';
import type { StreamChunk } from '../types.js';
import { type CacheOptions, applyCacheControl } from './_anthropic-cache.js';
import { type OpenRouterAttribution, openRouterAdapter } from './openrouter-openai.js';

export interface ClaudeAdapterOptions {
  vision: boolean;
  /** The offering's reasoning control — source of truth for the profile. */
  reasoning: ReasoningControl;
  /** Cache-breakpoint tuning. Defaults: tail 5m, anchor grid 8192 tokens. */
  cache?: CacheOptions;
  attribution?: OpenRouterAttribution;
}

/**
 * Claude via OpenRouter's OpenAI-compatible `/chat/completions`. Identical wire
 * shape and SSE parsing to the generic OpenRouter adapter — reasoning on the
 * unified `reasoning` object, thinking text on `delta.reasoning` — with one
 * Claude-specific addition: Anthropic prompt caching is opt-in, so this adapter
 * injects `cache_control` breakpoints (stable prefix + token-anchored history
 * point + rolling tail; see `_anthropic-cache.ts`). OpenRouter passes
 * cache_control through to Anthropic verbatim.
 *
 * Extended-thinking signature replay for the tool-use loop is intentionally NOT
 * implemented here — deferred build-when-needed (spec §5.2): there is no live
 * tool-loop consumer yet, and plain multi-turn chat does not require replay.
 */
export function claudeAdapter(slug: string, opts: ClaudeAdapterOptions): ModelAdapter {
  const base = openRouterAdapter(slug, {
    vision: opts.vision,
    reasoning: opts.reasoning,
    ...(opts.attribution ? { attribution: opts.attribution } : {}),
  });

  return {
    profile: base.profile,

    buildRequest(req: CanonicalRequest): WireRequest {
      const wire = base.buildRequest(req);
      wire.body.messages = applyCacheControl(req.messages, opts.cache);
      return wire;
    },

    parseChunk(raw: unknown, state: ParseState): { events: StreamChunk[]; state: ParseState } {
      return base.parseChunk(raw, state);
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/llm-unified && bun test src/adapters/anthropic-claude.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add packages/llm-unified/src/adapters/anthropic-claude.ts packages/llm-unified/src/adapters/anthropic-claude.test.ts
git commit -m "Add Claude adapter (OpenRouter shape + cache_control injection)"
```

---

## Task 4: Claude canonical models

**Files:**
- Modify: `packages/llm-unified/src/catalogue/canonical-registry.ts`

- [ ] **Step 1: Add the seven Claude canonicals**

In `packages/llm-unified/src/catalogue/canonical-registry.ts`, inside the `CANONICALS` array (append before the closing `];`), add:

```typescript
  // --- Claude (Anthropic) — via OpenRouter only; censored at source → not
  // freedom-oriented; surfaced with the CENSORED badge. See ADR 0032. ---
  {
    id: 'claude-haiku-4.5',
    displayName: 'Claude Haiku 4.5',
    family: 'claude',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'Anthropic aligns/censors the model at source → not freedom-oriented. Integrated via an anonymising router (LLM-VPN) per ADR 0032; effectiveFreedom is "restricted" → CENSORED badge.',
  },
  {
    id: 'claude-sonnet-4.5',
    displayName: 'Claude Sonnet 4.5',
    family: 'claude',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'Anthropic aligns/censors the model at source → not freedom-oriented. Integrated via an anonymising router (LLM-VPN) per ADR 0032; effectiveFreedom is "restricted" → CENSORED badge.',
  },
  {
    id: 'claude-sonnet-4.6',
    displayName: 'Claude Sonnet 4.6',
    family: 'claude',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'Anthropic aligns/censors the model at source → not freedom-oriented. Integrated via an anonymising router (LLM-VPN) per ADR 0032; effectiveFreedom is "restricted" → CENSORED badge.',
  },
  {
    id: 'claude-opus-4.5',
    displayName: 'Claude Opus 4.5',
    family: 'claude',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'Anthropic aligns/censors the model at source → not freedom-oriented. Integrated via an anonymising router (LLM-VPN) per ADR 0032; effectiveFreedom is "restricted" → CENSORED badge.',
  },
  {
    id: 'claude-opus-4.6',
    displayName: 'Claude Opus 4.6',
    family: 'claude',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'Anthropic aligns/censors the model at source → not freedom-oriented. Integrated via an anonymising router (LLM-VPN) per ADR 0032; effectiveFreedom is "restricted" → CENSORED badge.',
  },
  {
    id: 'claude-opus-4.7',
    displayName: 'Claude Opus 4.7',
    family: 'claude',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'Anthropic aligns/censors the model at source → not freedom-oriented. Integrated via an anonymising router (LLM-VPN) per ADR 0032; effectiveFreedom is "restricted" → CENSORED badge.',
  },
  {
    id: 'claude-opus-4.8',
    displayName: 'Claude Opus 4.8',
    family: 'claude',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'Anthropic aligns/censors the model at source → not freedom-oriented. Integrated via an anonymising router (LLM-VPN) per ADR 0032; effectiveFreedom is "restricted" → CENSORED badge.',
  },
```

- [ ] **Step 2: Verify typecheck and existing catalogue tests pass**

Run: `pnpm typecheck && cd packages/llm-unified && bun test src/catalogue/`
Expected: PASS. (Canonicals are validated structurally; no offering references them yet, which is allowed.)

- [ ] **Step 3: Commit**

```bash
git add packages/llm-unified/src/catalogue/canonical-registry.ts
git commit -m "Add seven Claude canonicals (freedomOriented=false per ADR 0032)"
```

---

## Task 5: Claude offerings on OpenRouter + adapter registration

**Files:**
- Modify: `packages/llm-unified/src/providers/openrouter.ts`
- Modify: `packages/llm-unified/src/providers/builtins.test.ts`

> **Reasoning control note:** This task ships the offerings with `mode: 'steps'`. Task 7's live probe confirms whether Claude's effort genuinely modulates via OpenRouter **and** survives alongside `cache_control`. If the probe shows it does not modulate (or effort is dropped when caching), change `CLAUDE_REASONING` to `{ mode: 'toggle', defaultOn: true }` in this file and re-run Task 7. Do not claim the control is correct until measured (the serial-probe discipline).

- [ ] **Step 1: Add the Claude adapter import and offering factory**

In `packages/llm-unified/src/providers/openrouter.ts`, add to the imports at the top:

```typescript
import { claudeAdapter } from '../adapters/anthropic-claude.js';
```

After the `TOGGLE` constant (around line 16), add:

```typescript
// Claude reasoning: provisional steps pending Task 7's live probe (effort
// modulation + coexistence with cache_control). Downgrade to TOGGLE if the
// probe disproves modulation. See the plan's Task 5 note.
const CLAUDE_REASONING: ReasoningControl = {
  mode: 'steps',
  steps: ['low', 'medium', 'high'],
  offStep: 'off',
  defaultStep: 'medium',
};

/**
 * A Claude offering on OpenRouter. The model itself is censored by Anthropic
 * (`canonical.freedomOriented=false`), but OpenRouter routes verbatim
 * (`freedomOrientedDeployment=true`) → effectiveFreedom 'restricted' → CENSORED
 * badge. Uses the dedicated Claude adapter (cache_control injection). All Claude
 * models here carry a 200k context window.
 */
function claudeOffering(canonicalRef: string, slug: string): Offering {
  return {
    canonicalRef,
    providerId: 'openrouter',
    upstreamSlug: slug,
    adapter: { kind: 'catalogue', adapterId: `openrouter-claude:${slug}` },
    profile: {
      reasoning: CLAUDE_REASONING,
      toolCalls: { supported: true, streaming: true, concurrentWithReasoning: true },
      vision: true,
      // Signature replay deferred (spec §5.2) — no hard-CoT replay wired yet.
      replayReasoning: false,
    },
    context: { recommended: 200_000, max: 200_000 },
    trust: { tee: false, zdr: false, jurisdiction: 'US' },
    freedomOrientedDeployment: true,
    source: 'curated',
    confidence: 'verified',
    serviceKind: 'llm',
  };
}

const claudeOfferings: Offering[] = [
  claudeOffering('claude-haiku-4.5', 'anthropic/claude-haiku-4.5'),
  claudeOffering('claude-sonnet-4.5', 'anthropic/claude-sonnet-4.5'),
  claudeOffering('claude-sonnet-4.6', 'anthropic/claude-sonnet-4.6'),
  claudeOffering('claude-opus-4.5', 'anthropic/claude-opus-4.5'),
  claudeOffering('claude-opus-4.6', 'anthropic/claude-opus-4.6'),
  claudeOffering('claude-opus-4.7', 'anthropic/claude-opus-4.7'),
  claudeOffering('claude-opus-4.8', 'anthropic/claude-opus-4.8'),
];
```

- [ ] **Step 2: Append the Claude offerings to the provider's offerings array**

Change the end of the `offerings` array (after the last existing entry, before the closing `];` at line 117) so the Claude offerings are included. Replace the `];` that closes `const offerings: Offering[] = [ … ]` with:

```typescript
  ...claudeOfferings,
];
```

- [ ] **Step 3: Branch the adapter registration by adapter id**

In `registerOpenRouter()` (lines 144-157), replace the registration loop body with a branch so Claude offerings get the Claude adapter:

```typescript
export function registerOpenRouter(): void {
  registerProvider(openrouter);
  for (const o of offerings) {
    if (o.adapter.kind !== 'catalogue') continue;
    if (o.adapter.adapterId.startsWith('openrouter-claude:')) {
      registerAdapter(
        o.adapter.adapterId,
        claudeAdapter(o.upstreamSlug, {
          vision: o.profile.vision,
          reasoning: o.profile.reasoning,
        }),
      );
    } else {
      registerAdapter(
        o.adapter.adapterId,
        openRouterAdapter(o.upstreamSlug, {
          vision: o.profile.vision,
          reasoning: o.profile.reasoning,
        }),
      );
    }
  }
}
```

- [ ] **Step 4: Update the builtins test for the new offering count and a Claude assertion**

In `packages/llm-unified/src/providers/builtins.test.ts`, find the assertion on OpenRouter's offering count (the existing OpenRouter offerings number 8). Update it to `8 + 7 = 15` and add a Claude-specific check. Add this test inside the existing `describe`:

```typescript
  it('registers the seven Claude offerings with the dedicated adapter and CENSORED freedom', () => {
    const p = getProvider('openrouter');
    expect(p).toBeDefined();
    const claude = p?.offerings.filter((o) => o.canonicalRef?.startsWith('claude-')) ?? [];
    expect(claude.map((o) => o.canonicalRef).sort()).toEqual([
      'claude-haiku-4.5',
      'claude-opus-4.5',
      'claude-opus-4.6',
      'claude-opus-4.7',
      'claude-opus-4.8',
      'claude-sonnet-4.5',
      'claude-sonnet-4.6',
    ]);
    for (const o of claude) {
      expect(o.adapter.kind).toBe('catalogue');
      if (o.adapter.kind === 'catalogue') {
        expect(o.adapter.adapterId.startsWith('openrouter-claude:')).toBe(true);
      }
      expect(o.freedomOrientedDeployment).toBe(true);
      const canonical = getCanonical(o.canonicalRef ?? '');
      expect(canonical?.freedomOriented).toBe(false);
      expect(effectiveFreedom(canonical?.freedomOriented ?? null, o.freedomOrientedDeployment)).toBe(
        'restricted',
      );
    }
  });
```

Ensure `getCanonical` and `effectiveFreedom` are imported at the top of `builtins.test.ts` (add to the existing `@chatsundere/llm-unified` / catalogue import if absent):

```typescript
import { effectiveFreedom, getCanonical } from '../catalogue/index.js';
```

If the file's existing OpenRouter count assertion reads e.g. `expect(p.offerings).toHaveLength(8)`, change `8` to `15`.

- [ ] **Step 5: Run the provider tests**

Run: `cd packages/llm-unified && bun test src/providers/builtins.test.ts src/providers/offerings.test.ts`
Expected: PASS — Claude offerings registered, every offering passes the capability gate (canonicals require reasoning+tools+vision; Claude offerings provide all three), and effectiveFreedom is 'restricted'.

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm typecheck
git add packages/llm-unified/src/providers/openrouter.ts packages/llm-unified/src/providers/builtins.test.ts
git commit -m "Register seven Claude offerings on OpenRouter (CENSORED, cache adapter)"
```

---

## Task 6: CENSORED badge in the model picker

**Files:**
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx`

Data mechanics + a minimal functional badge. Opulent styling is a later pass (spec §2); this delivers the derived `'restricted'` state to the client and renders a clear, honest CENSORED chip. UX is verified manually on-device (project convention: manual verification beats automated coverage for UX).

- [ ] **Step 1: Import `effectiveFreedom` and `FreedomState`**

In `apps/user-client/src/routes/app/persona-editor.tsx`, extend the `@chatsundere/llm-unified` import (lines 3-8) to include the freedom helpers:

```typescript
import {
  availableCanonicals,
  effectiveFreedom,
  type FreedomState,
  getCanonical,
  getProvider,
  listOfferings,
} from '@chatsundere/llm-unified';
```

- [ ] **Step 2: Add the `FreedomBadge` component**

Immediately after the `TrustBadge` component (after its closing `}` at line 533), add:

```typescript
/**
 * The loud, honest signal for a censored model. Only 'restricted' carries a
 * badge today (free/unknown stay unmarked); restricted means the model — or its
 * deployment — applies content restrictions somewhere in the stack. For Claude
 * and ChatGPT the model is censored at source while the router routes verbatim;
 * we route via the anonymising router (LLM-VPN, ADR 0032), so the server still
 * never sees plaintext, but the censorship is real and we name it.
 */
function FreedomBadge({ state }: { state: FreedomState }): JSX.Element | null {
  if (state !== 'restricted') return null;
  return (
    <span
      title="This model is censored by its maker. Reached via an anonymising router — the server never sees your data — but the model itself applies content restrictions."
      className="rounded border border-danger/40 bg-danger/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-danger"
    >
      Censored
    </span>
  );
}
```

- [ ] **Step 3: Render the badge in the per-offering deployment row**

In the deployment-row badges block (around lines 664-668, where `o.trust.tee` / `o.trust.zdr` / `o.trust.jurisdiction` badges render), add the freedom badge. The canonical `c` is in scope from the enclosing `available.map((c) => …)`:

```typescript
                          {o.trust.tee ? <TrustBadge kind="tee" /> : null}
                          {o.trust.zdr ? <TrustBadge kind="zdr" /> : null}
                          {o.trust.jurisdiction ? (
                            <JurisdictionBadge code={o.trust.jurisdiction} />
                          ) : null}
                          <FreedomBadge
                            state={effectiveFreedom(c.freedomOriented, o.freedomOrientedDeployment)}
                          />
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Manual verification (on-device, per project convention)**

In a dev session (`pnpm --filter @chatsundere/user-client dev` or the project's run command), open a persona editor with OpenRouter configured, select a Claude model, and confirm each Claude deployment row shows a red **CENSORED** chip with the tooltip, while a freedom-oriented model (e.g. a DeepSeek offering) shows none.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/routes/app/persona-editor.tsx
git commit -m "Surface CENSORED badge for restricted offerings in the model picker"
```

---

## Task 7: Live probe — Claude reasoning modulation + cache engagement

**Files:**
- Create: `packages/llm-unified/curation/run-claude-suite.ts`

This is a **manual, non-CI** harness (keys never enter CI). It mirrors `run-openrouter-suite.ts` and adds a two-turn cache check. It answers two empirical questions the offering config depends on: (a) does Claude's reasoning effort genuinely modulate via OpenRouter, and does it survive alongside `cache_control`? (b) does the cache actually engage (cachedTokens > 0 on the second turn)?

- [ ] **Step 1: Write the probe harness**

Create `packages/llm-unified/curation/run-claude-suite.ts`:

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
//
// One-off live verification harness for the Claude offerings (run via the
// /curate skill, NEVER in CI — it needs keys/.or-test-key). Runs the
// deterministic conversation-suite across the reasoning matrix, then a bespoke
// two-turn cache check that asserts Anthropic prompt-cache engages (cached
// prompt tokens > 0 on the second turn). Prints a Markdown report.
//
//   bun run curation/run-claude-suite.ts            (from packages/llm-unified)
//   bun run curation/run-claude-suite.ts opus-4.8   (substring-filter offerings)
import { readFileSync } from 'node:fs';
import type { ToolDef } from '../src/adapter-contract.js';
import { claudeAdapter } from '../src/adapters/anthropic-claude.js';
import { openrouter } from '../src/providers/openrouter.js';
import { streamCompletion } from '../src/stream-completion.js';
import type { ProviderConfig, StreamChunk, WireMessage } from '../src/types.js';
import {
  coreScenario,
  makeLiveBinding,
  permutationsForReasoning,
  renderSuiteReport,
  runSuite,
} from './conversation-suite/index.js';

const apiKey = readFileSync(new URL('../../../keys/.or-test-key', import.meta.url), 'utf8').trim();

const providerConfig: ProviderConfig = {
  baseUrl: openrouter.baseUrl,
  routing: { kind: 'direct' },
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

const slugFilter = process.argv[2];
const claudeTargets = openrouter.offerings.filter(
  (o) =>
    o.canonicalRef?.startsWith('claude-') &&
    (!slugFilter || o.upstreamSlug.toLowerCase().includes(slugFilter.toLowerCase())),
);

/** Collect the usage chunks from one streamed completion. */
async function streamUsage(
  adapter: ReturnType<typeof claudeAdapter>,
  messages: WireMessage[],
): Promise<{ cachedTokens: number; promptTokens: number; reasoningTokens: number }> {
  let cachedTokens = 0;
  let promptTokens = 0;
  let reasoningTokens = 0;
  const iter = streamCompletion({
    target: { adapterId: 'probe' },
    providerConfig,
    apiKey,
    messages,
    bodyExtras: { reasoning: { enabled: true, effort: 'medium' } },
  } as never) as AsyncIterable<StreamChunk>;
  // The probe builds the body via the adapter directly; we reuse makeLiveBinding
  // for the suite runs and only this bespoke path for the cache check.
  for await (const c of iter) {
    if (c.type === 'usage') {
      cachedTokens = c.usage.cachedTokens ?? 0;
      promptTokens = c.usage.promptTokens;
      reasoningTokens = c.usage.reasoningTokens ?? 0;
    }
  }
  return { cachedTokens, promptTokens, reasoningTokens };
}

for (const o of claudeTargets) {
  const adapter = claudeAdapter(o.upstreamSlug, {
    vision: o.profile.vision,
    reasoning: o.profile.reasoning,
    cache: { tailTtl: '1h' }, // force 1h so the second turn within minutes hits.
  });
  const binding = makeLiveBinding({
    offeringRef: `openrouter-claude:${o.upstreamSlug}`,
    providerConfig,
    apiKey,
    adapter,
    tools,
  });

  console.log(`\n${'='.repeat(72)}\nOFFERING ${o.upstreamSlug}\n${'='.repeat(72)}`);

  // (a) correctness + reasoning matrix
  const perms = permutationsForReasoning(o.profile.reasoning);
  const core = await runSuite(coreScenario, perms, binding);
  console.log(renderSuiteReport(core));

  // (b) cache engagement: a large stable system prefix, two turns. Turn 2 must
  // report cached prompt tokens > 0 if cache_control passes through.
  const bigSystem = 'You are a meticulous assistant. '.repeat(400); // ≈ 2k tokens, > min cacheable
  const turn1: WireMessage[] = [
    { role: 'system', content: bigSystem },
    { role: 'user', content: 'Say hello in one word.' },
  ];
  const u1 = await streamUsage(adapter, turn1);
  const turn2: WireMessage[] = [
    ...turn1,
    { role: 'assistant', content: 'Hello.' },
    { role: 'user', content: 'Now say goodbye in one word.' },
  ];
  const u2 = await streamUsage(adapter, turn2);
  console.log(
    `\nCACHE CHECK ${o.upstreamSlug}\n` +
      `  turn1: prompt=${u1.promptTokens} cached=${u1.cachedTokens} reasoning=${u1.reasoningTokens}\n` +
      `  turn2: prompt=${u2.promptTokens} cached=${u2.cachedTokens} reasoning=${u2.reasoningTokens}\n` +
      `  → cache ${u2.cachedTokens > 0 ? 'ENGAGED ✅' : 'NOT engaged ❌'}`,
  );
}

console.log('\nDONE.');
```

> **Note for the implementer:** `streamCompletion`'s exact argument shape (`StreamCompletionArgs`) is defined in `packages/llm-unified/src/stream-completion.ts`. Read it and adjust the `streamUsage` call to match the real fields (the `as never` cast above is a placeholder to be removed once the real shape is wired — the harness must register the adapter via `registerAdapter('probe', adapter)` and pass a real `target.adapterId`, OR call `adapter.buildRequest` + the transport directly). The conversation-suite's `makeLiveBinding` already does this correctly for the suite runs; model the cache check on `binding`'s internals if simpler.

- [ ] **Step 2: Run the probe (manual, requires `keys/.or-test-key`)**

Run: `cd packages/llm-unified && bun run curation/run-claude-suite.ts opus-4.8`
Observe and record (in the model record, Task 8):
- Whether the core scenario PASSES (tool call + multi-turn correctness).
- Whether reasoning effort modulates: compare reasoning/usage across low/medium/high permutations (expect higher effort → more reasoning tokens; if flat, the control is a toggle, not steps).
- Whether the cache ENGAGED on turn 2 (cached > 0). If NOT engaged, try dropping the `ttl` field (some routers reject `ttl`); re-run.

- [ ] **Step 3: Apply the finding to the offering config**

- If reasoning does **not** modulate (or effort is dropped when caching): in `packages/llm-unified/src/providers/openrouter.ts`, change `CLAUDE_REASONING` to `{ mode: 'toggle', defaultOn: true }`, re-run the probe, and commit the correction.
- If the cache needs `ttl` removed: in `_anthropic-cache.ts`, make `withCacheControl` omit `ttl` (emit `{ type: 'ephemeral' }`), update the unit tests accordingly, and re-run Task 2's tests.
- If everything modulates and caches: no code change; the provisional `steps` config stands.

- [ ] **Step 4: Commit the harness (and any correction)**

```bash
git add packages/llm-unified/curation/run-claude-suite.ts
# plus openrouter.ts / _anthropic-cache.ts if the probe forced a correction
git commit -m "Add Claude live-probe harness; reconcile reasoning/cache config with measured behaviour"
```

---

## Task 8: ADR, model records, provider record, STATUS

**Files:**
- Create: `obsidian/decisions/0032-premium-censored-models-via-routers.md`
- Create: `obsidian/models/claude-haiku-4.5.md`, `claude-sonnet-4.5.md`, `claude-sonnet-4.6.md`, `claude-opus-4.5.md`, `claude-opus-4.6.md`, `claude-opus-4.7.md`, `claude-opus-4.8.md`
- Create: `obsidian/providers/nano-gpt.md`
- Modify: `obsidian/STATUS-CLIENT-ONLY.md` (or the batch-plan tick-off)

> These are documentation artefacts (commit with `[skip ci]`). Follow the existing record format — read `obsidian/models/glm-5.1.md` and `obsidian/providers/openrouter.md` first and mirror their structure. British English throughout.

- [ ] **Step 1: Write ADR 0032**

Create `obsidian/decisions/0032-premium-censored-models-via-routers.md`, Michael-Nygard style (Context / Decision / Consequences). Capture, in prose:
- **Context:** Claude and ChatGPT are the most-requested models and high quality, but censored at source. Our Provider Integration Policy governs providers we interact with directly.
- **Decision:** integrate these models **via anonymising routers only** (OpenRouter, nano-gpt) — never the vendor's direct API ("LLM-VPN"). Mark `canonical.freedomOriented = false`; the router deployment stays `freedomOrientedDeployment = true` (it routes verbatim); `effectiveFreedom` therefore resolves to `'restricted'`, surfaced as a loud **CENSORED** badge. No direct OpenAI/Anthropic endpoints.
- **Consequences:** the policy is not violated (no direct interaction with the censoring vendor); users get the quality with an honest signal; the zero-knowledge backend guarantee is unaffected (the server still never sees plaintext). Signature/thinking replay for tools is deferred (no live consumer; build-when-needed).

- [ ] **Step 2: Write the seven Claude model records**

For each `obsidian/models/claude-<id>.md`, mirror `glm-5.1.md`. Include: display name, family, provider/offering (OpenRouter slug), reasoning control (record the Task 7 measured result — steps or toggle), context window (200k), freedom judgement (`freedomOriented=false`, the LLM-VPN rationale, CENSORED), cache strategy (token-anchored breakpoints, the Task 7 cache-engagement result), and any probe notes.

- [ ] **Step 3: Write the missing nano-gpt provider record**

Create `obsidian/providers/nano-gpt.md`, mirroring `openrouter.md`: base URL `https://nano-gpt.com/api/v1`, OpenAI-compatible chat-completions, CORS hint, freedom/trust posture, and the **gpt-5.5 reasoning finding** from the spec §6.2 (top-level `reasoning_effort` with `none` as a genuine off; reasoning rolled into `completion_tokens`) so Phase B has it recorded at the provider level.

- [ ] **Step 4: Update STATUS / batch-plan**

In `obsidian/insights/2026-06-01-curation-batch-plan.md`, mark the Claude strand done (Phase A) and note Phase B (ChatGPT) pending its own plan. If a client-only STATUS section tracks curation, reflect Claude as integrated there too.

- [ ] **Step 5: Commit (doc-only)**

```bash
git add obsidian/decisions/0032-premium-censored-models-via-routers.md obsidian/models/claude-*.md obsidian/providers/nano-gpt.md obsidian/insights/2026-06-01-curation-batch-plan.md obsidian/STATUS-CLIENT-ONLY.md
git commit -m "Document Claude integration: ADR 0032, model + provider records [skip ci]"
```

---

## Definition of Done (Phase A)

- `pnpm typecheck` passes; `cd packages/llm-unified && bun test` passes (cache module, Claude adapter, builtins, offerings).
- Seven Claude offerings appear in the model picker under OpenRouter, each with a CENSORED badge (manual verification).
- The live probe confirms: core scenario passes, reasoning behaviour measured (steps or toggle recorded), cache engages on turn 2.
- ADR 0032 + seven model records + nano-gpt provider record committed.
- Squash into one feature commit per the project's squash-per-feature rule. **No Larissa gate** (changes are in `packages/llm-unified` + user-client, none in auth/sync/proxy/crypto). Awaits Chris's on-device manual verification before push.

## Self-review notes (gaps surfaced, addressed)

- **Reasoning control is provisional until probed** — Task 5 ships `steps`, Task 7 measures, Task 3-of-7 reconciles. No claim is locked before measurement.
- **Cache `ttl` passthrough is unverified** — Task 7 has an explicit fallback (drop `ttl`) if OpenRouter rejects it.
- **`streamCompletion` call shape in the probe** — flagged inline for the implementer to match the real `StreamCompletionArgs`; the suite binding already does it correctly.
- **Signature replay** — out of scope by decision (spec §5.2); `replayReasoning:false` kept honest.
- **variantLabel / ChatGPT / 4o** — Phase B, separate plan.
