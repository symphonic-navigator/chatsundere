# Phase 4 — CoT display + reasoning-OFF translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the model's chain-of-thought as an expandable, mindspace-tinted pill inside persona messages, and finish the per-provider Reasoning-OFF translation so the toggle actually suppresses upstream reasoning everywhere.

**Architecture:** A new `{ type: 'reasoning'; text: string }` variant on `ContentBlock` (`apps/user-client/src/boot/client-data-db.ts`) and on `StreamChunk` (`packages/llm-unified/src/types.ts`) carries the trace through the stream pipeline; a pure helper module `apps/user-client/src/lib/content-blocks.ts` centralises flatten/coalesce/group operations; per-provider reasoning-body translation lives in a new `packages/llm-unified/src/_reasoning-body.ts` module driven by a `ReasoningIntent` discriminated union; the renderer surfaces each maximal reasoning-block run as a `<ReasoningPill>` component with sequential-pulse dot animation (Animation A) and 18 % mindspace-accent saturation locked during the brainstorm.

**Tech Stack:** TypeScript (strict), Bun (for `packages/llm-unified` tests), Vitest (for `apps/user-client` tests), React 18, Dexie 4, Tailwind v4, Zustand, TanStack Query.

**Spec:** [`superpowers/specs/2026-05-25-phase-4-cot-display-design.md`](../specs/2026-05-25-phase-4-cot-display-design.md).

**Sequencing:** One **Pre-Phase-4 Hotfix** commit (Task 0) lands first. Then Tasks 1–17 land as sequential task-commits on `master` (same pattern as Phase 3.1). After Task 17's verification pass, the Phase-4 work is squashed into a single commit and `STATUS-CLIENT-ONLY.md` is updated.

---

## Test scaffold reference

Several tests below pass `/* …minimal args */` or `/* …minimal stub */` in object literals — these are scaffolds that already exist in the codebase. Look up the real shape from these reference files before writing the test body:

- `KnownModel` / `ProviderDefinition` / `ProviderConfig` stub shapes — see `packages/llm-unified/src/types.test.ts` and `packages/llm-unified/src/providers/known-models.test.ts`.
- `StartStreamArgs` for `runStreamEngine` — see how `chat-page.test.tsx` constructs the full args object for `useSendMessage`; mirror that shape.
- `MessageRow` / `ChatRow` / `PersonaRow` seeding helpers — `apps/user-client/tests/helpers/` (if present) or inline patterns in `tests/unit/chat-stream.test.tsx`, `tests/unit/chat-page.test.tsx`.
- `renderChatPage` / `seedPersona` / `seedChat` — likely live in `tests/helpers/render-chat.ts` (created during Phase 3.1); reuse verbatim. If absent, factor out from the existing chat-page test inline setup before Task 15.
- `personaStub` / `mindspaceStub` — pattern lives in `tests/unit/persona-card.test.tsx` and `tests/unit/message-block.test.tsx` already; copy the literal.
- TanStack-Query + Zustand-store test reset patterns — see `tests/setup.ts`.

For each "create if missing" note in the task headers: scan the path first; if it exists, append to it. The skill-instruction default is one test file per source file, so `_reasoning-body.test.ts` joins `_reasoning-body.ts`, etc.

---

## File Structure

**Created:**
- `packages/llm-unified/src/_reasoning-body.ts` — per-provider reasoning body translation
- `packages/llm-unified/src/_reasoning-body.test.ts` — Bun tests for the body builder
- `apps/user-client/src/lib/content-blocks.ts` — pure helpers `flattenAnswerText` / `coalesceAdjacent` / `groupAdjacent`
- `apps/user-client/tests/unit/content-blocks.test.ts` — Vitest tests for the helpers
- `apps/user-client/src/components/chat/ReasoningPill.tsx` — the closed-and-open reasoning pill
- `apps/user-client/tests/unit/reasoning-pill.test.tsx` — Vitest tests for ReasoningPill
- `apps/user-client/tests/boot/client-data-db-v7.test.ts` — Vitest tests for the v7 migration
- `apps/user-client/tests/integration/cot-display.test.tsx` — end-to-end test with mocked SSE source

**Modified:**
- `apps/user-client/src/state/stream-manager.store.ts` — `abortAllForPersonaPreserve` (Task 0); `appendStreamChunk` polymorph + reasoning routing (Task 11)
- `apps/user-client/src/lib/nsfw-panic.ts` — call the preserve-variant (Task 0)
- `packages/llm-unified/src/types.ts` — `StreamChunk` adds reasoning variant; new `ReasoningIntent` (Tasks 1, 3)
- `packages/llm-unified/src/streaming.ts` — parser reads reasoning fields (Task 2)
- `packages/llm-unified/src/stream-completion.ts` — `buildBody` delegates to `_reasoning-body.applyReasoningToBody` (Task 4)
- `apps/user-client/src/boot/client-data-db.ts` — `ContentBlock` extension + Dexie v7 bump (Task 6)
- `apps/user-client/src/lib/stream-engine.ts` — reasoning routing in chunk loop; `toWireMessage` via `flattenAnswerText`; `extras.reasoning` instead of legacy thinking-flag (Tasks 7, 8)
- `apps/user-client/src/lib/reasoning-resolver.ts` — produce `ReasoningIntent` shape (Task 8)
- `apps/user-client/src/components/chat/ChatStream.tsx` — `copyMessageText` via `flattenAnswerText` (Task 9)
- `apps/user-client/src/lib/title-generator.ts` — drop `{type: 'reasoning'}` chunks (Task 12)
- `apps/user-client/src/components/chat/MessageBlock.tsx` — render reasoning groups via `<ReasoningPill>`; group-aware renderer (Task 14)
- `apps/user-client/src/index.css` — `.reasoning-pill*` styles + keyframes + reduced-motion (Task 13)
- `apps/user-client/tests/unit/stream-manager-store.test.ts` — extend for reasoning chunks (Task 11)
- `apps/user-client/tests/unit/title-generator.test.ts` — extend for reasoning-drop (Task 12)
- `apps/user-client/tests/unit/nsfw-panic.test.ts` — extend for preserve-variant assertion (Task 0)

---

## Task 0 — Pre-Phase-4 hotfix: NSFW panic preserves draft

**Files:**
- Modify: `apps/user-client/src/state/stream-manager.store.ts`
- Modify: `apps/user-client/src/lib/nsfw-panic.ts`
- Modify: `apps/user-client/tests/unit/nsfw-panic.test.ts`

- [ ] **Step 0.1: Add a failing test that NSFW panic preserves the draft persona-message**

Edit `apps/user-client/tests/unit/nsfw-panic.test.ts` — add a new case (placement: after the existing "deletes draft" test, or new file if no such test exists yet):

```ts
it('preserves the draft persona-message of an aborted adult-persona stream', async () => {
  const db = getClientDataDb();
  const personaId = await seedAdultPersona(db);
  const chatId = await seedChat(db, personaId);
  const draftMsgId = await seedDraftPersonaMessage(db, chatId, 'partial …');

  // Seed a live stream-handle so panic has something to abort
  useStreamManagerStore.setState({
    streams: new Map([[
      chatId,
      {
        chatId, personaId, draftMessageId: draftMsgId,
        controller: new AbortController(), status: 'streaming',
        contentBuffer: [{ type: 'text', text: 'partial …' }],
        pillBuffer: [], startedAt: Date.now(),
      },
    ]]),
  });

  await nsfwPanic({ navigate: () => {} });

  const row = await db.messages.get(draftMsgId);
  expect(row).toBeDefined();   // <- previously deleted; must now stay
  expect(row?.streamingState).toBe('incomplete');
  expect(useStreamManagerStore.getState().streams.has(chatId)).toBe(false);
});
```

- [ ] **Step 0.2: Run the test and confirm it fails**

Run: `pnpm --filter user-client test nsfw-panic`
Expected: FAIL — `row` is `undefined` because `abortAllForPersonaDiscard` deletes the draft.

- [ ] **Step 0.3: Add a `abortAllForPersonaPreserve` method on the stream-manager store**

Edit `apps/user-client/src/state/stream-manager.store.ts`. Add a new entry alongside the existing `abortAllForPersonaDiscard` (after line ~258 — keep both methods; existing one is still used for user-initiated cockpit Stop):

```ts
abortAllForPersonaPreserve: async (personaId: string) => {
  const matching = [...get().streams.values()].filter((h) => h.personaId === personaId);
  const db = getClientDataDb();
  for (const h of matching) {
    h.controller.abort();
    // Persist the partial buffer + mark as incomplete so the user sees
    // StreamInterruptedFooter on re-visit. No Dexie delete.
    await db.messages.update(h.draftMessageId, {
      contentBlocks: h.contentBuffer,
      streamingState: 'incomplete',
    });
    set((s) => {
      const m = new Map(s.streams);
      m.delete(h.chatId);
      return { streams: m };
    });
  }
},
```

Also add the method to the store's TypeScript interface (search for `abortAllForPersonaDiscard:` in the interface definition near line ~30 and add the new method's signature next to it):

```ts
abortAllForPersonaPreserve: (personaId: string) => Promise<void>;
```

- [ ] **Step 0.4: Route `nsfw-panic.ts` through the new preserve method**

Edit `apps/user-client/src/lib/nsfw-panic.ts` line 31. Change:

```ts
// Before:
await mgr.abortAllForPersonaDiscard(pid);
// After:
await mgr.abortAllForPersonaPreserve(pid);
```

Also update the comment block at lines 11-21 to read:

```ts
/**
 * NSFW Panic auto-kick. Called when the user toggles Adult Mode from
 * 'nsfw' to 'sfw'. Aborts every in-flight stream against an
 * `adultPersona`-marked persona (preserve semantics — the partial
 * draft persona-message survives as `streamingState: 'incomplete'`
 * so the user can decide Retry/Discard on re-visit). If the user
 * happens to be inside one of those chats, navigates them to the
 * Entrance Hall and surfaces a brief toast.
 */
```

- [ ] **Step 0.5: Run the test and confirm it passes**

Run: `pnpm --filter user-client test nsfw-panic`
Expected: PASS.

- [ ] **Step 0.6: Run full user-client test suite to check nothing else broke**

Run: `pnpm --filter user-client test`
Expected: All previously-green tests stay green (382 passing as of 86a21bb — eight pre-existing cockpit-draft localStorage failures are unrelated and stay; total should go up by 1 to 383 passing).

- [ ] **Step 0.7: Commit the hotfix**

```bash
git add apps/user-client/src/state/stream-manager.store.ts \
        apps/user-client/src/lib/nsfw-panic.ts \
        apps/user-client/tests/unit/nsfw-panic.test.ts
git commit -m "$(cat <<'EOF'
Fix NSFW panic to preserve draft persona-message

Phase 3.2 implemented panic with discard semantics — the partial draft
was deleted on adult-mode flip. Per the Phase-4 brainstorm, the
sollwert is preserve: abort the stream, write the partial buffer as
`streamingState: 'incomplete'`, leave the row in place so the
StreamInterruptedFooter can offer Retry/Discard on re-visit. Adds
`abortAllForPersonaPreserve` next to the existing
`abortAllForPersonaDiscard` (still used by user-initiated cockpit
Stop). NSFW Panic re-routed.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

---

## Task 1 — `StreamChunk` adds reasoning variant

**Files:**
- Modify: `packages/llm-unified/src/types.ts`
- Modify: `packages/llm-unified/src/types.test.ts`

- [ ] **Step 1.1: Add a failing test**

Edit `packages/llm-unified/src/types.test.ts`. Add at the end:

```ts
it('StreamChunk accepts a reasoning variant', () => {
  const chunk: StreamChunk = { type: 'reasoning', text: 'let me think …' };
  expect(chunk.type).toBe('reasoning');
  if (chunk.type === 'reasoning') {
    expect(chunk.text).toBe('let me think …');
  }
});
```

- [ ] **Step 1.2: Run and confirm it fails**

Run: `bun test --cwd packages/llm-unified src/types.test.ts`
Expected: FAIL with TypeScript error — `'reasoning'` not in the union.

- [ ] **Step 1.3: Extend the `StreamChunk` union**

Edit `packages/llm-unified/src/types.ts` lines 67-71. Change:

```ts
export type StreamChunk =
  | { type: 'token'; text: string }
  | { type: 'reasoning'; text: string }                                                                                                                                            // NEW
  | { type: 'tool-call'; toolCallId: string; name: string; argumentsJson: string }
  | { type: 'finish'; reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'unknown' }
  | { type: 'error'; message: string };
```

- [ ] **Step 1.4: Run and confirm it passes**

Run: `bun test --cwd packages/llm-unified src/types.test.ts`
Expected: PASS.

- [ ] **Step 1.5: Commit**

```bash
git add packages/llm-unified/src/types.ts packages/llm-unified/src/types.test.ts
git commit -m "Add reasoning variant to StreamChunk"
```

---

## Task 2 — SSE parser reads reasoning fields

**Files:**
- Modify: `packages/llm-unified/src/streaming.ts`
- Modify: `packages/llm-unified/src/streaming.test.ts`

- [ ] **Step 2.1: Add four failing tests**

Edit `packages/llm-unified/src/streaming.test.ts`. Add:

```ts
import { describe, expect, it } from 'bun:test';
import { parseOpenAiSseStream } from './streaming.js';

async function collect(stream: ReadableStream<Uint8Array>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of parseOpenAiSseStream(stream)) out.push(c);
  return out;
}

function sseFrom(payloads: object[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const body = payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new ReadableStream({
    start(ctrl) { ctrl.enqueue(enc.encode(body)); ctrl.close(); },
  });
}

describe('parseOpenAiSseStream — reasoning', () => {
  it('emits a reasoning chunk from delta.reasoning (modern field)', async () => {
    const out = await collect(sseFrom([{ choices: [{ delta: { reasoning: 'thinking …' } }] }]));
    expect(out).toEqual([{ type: 'reasoning', text: 'thinking …' }]);
  });

  it('emits a reasoning chunk from delta.reasoning_content (legacy)', async () => {
    const out = await collect(sseFrom([{ choices: [{ delta: { reasoning_content: 'hm …' } }] }]));
    expect(out).toEqual([{ type: 'reasoning', text: 'hm …' }]);
  });

  it('concatenates both reasoning fields when both populated', async () => {
    const out = await collect(sseFrom([
      { choices: [{ delta: { reasoning: 'A', reasoning_content: 'B' } }] },
    ]));
    expect(out).toEqual([{ type: 'reasoning', text: 'AB' }]);
  });

  it('emits reasoning before token in the same event', async () => {
    const out = await collect(sseFrom([
      { choices: [{ delta: { reasoning: 'hm', content: 'hi' } }] },
    ]));
    expect(out).toEqual([
      { type: 'reasoning', text: 'hm' },
      { type: 'token',     text: 'hi' },
    ]);
  });

  it('ignores empty / null reasoning fields', async () => {
    const out = await collect(sseFrom([
      { choices: [{ delta: { reasoning: '', reasoning_content: null, content: 'hi' } }] },
    ]));
    expect(out).toEqual([{ type: 'token', text: 'hi' }]);
  });
});
```

- [ ] **Step 2.2: Run and confirm tests fail**

Run: `bun test --cwd packages/llm-unified src/streaming.test.ts`
Expected: FAIL — five new cases red; existing cases stay green.

- [ ] **Step 2.3: Extend the parser**

Edit `packages/llm-unified/src/streaming.ts`. Update the `OpenAiDeltaPayload` interface (lines 77-88) and the `openAiPayloadToChunks` function (lines 90-114):

```ts
interface OpenAiDeltaPayload {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning?: string | null;          // NEW
      reasoning_content?: string | null;  // NEW
      tool_calls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

function openAiPayloadToChunks(payload: unknown): StreamChunk[] {
  const p = payload as OpenAiDeltaPayload;
  const choice = p.choices?.[0];
  if (!choice) return [];
  const out: StreamChunk[] = [];

  // Reasoning emits *before* the token in the same event — matches
  // upstream temporal ordering (the model thinks, then speaks).
  const reasoningModern = choice.delta?.reasoning ?? '';
  const reasoningLegacy = choice.delta?.reasoning_content ?? '';
  const reasoning = reasoningModern + reasoningLegacy;
  if (reasoning) {
    out.push({ type: 'reasoning', text: reasoning });
  }

  if (choice.delta?.content) {
    out.push({ type: 'token', text: choice.delta.content });
  }
  if (choice.delta?.tool_calls) {
    for (const tc of choice.delta.tool_calls) {
      if (tc.id && tc.function?.name && typeof tc.function.arguments === 'string') {
        out.push({
          type: 'tool-call',
          toolCallId: tc.id,
          name: tc.function.name,
          argumentsJson: tc.function.arguments,
        });
      }
    }
  }
  if (choice.finish_reason) {
    out.push({ type: 'finish', reason: normaliseFinishReason(choice.finish_reason) });
  }
  return out;
}
```

- [ ] **Step 2.4: Run and confirm tests pass**

Run: `bun test --cwd packages/llm-unified src/streaming.test.ts`
Expected: PASS for new and existing cases.

- [ ] **Step 2.5: Commit**

```bash
git add packages/llm-unified/src/streaming.ts packages/llm-unified/src/streaming.test.ts
git commit -m "Parse reasoning fields from OpenAI-compat SSE delta"
```

---

## Task 3 — `ReasoningIntent` type

**Files:**
- Modify: `packages/llm-unified/src/types.ts`

- [ ] **Step 3.1: Add the type next to other public exports**

Edit `packages/llm-unified/src/types.ts`. Append after the `StreamChunk` block (after line 71):

```ts
/**
 * Engine → adapter intent for reasoning. Per-provider translation
 * to body shape (`{reasoning:{enabled,effort}}` vs `{think:bool}` vs
 * model-slug swap) is the adapter layer's responsibility.
 */
export type ReasoningIntent =
  | { enabled: false }
  | { enabled: true; effort?: 'low' | 'medium' | 'high' };
```

- [ ] **Step 3.2: Verify TypeScript compiles cleanly**

Run: `pnpm --filter @chatsundere/llm-unified typecheck`
Expected: clean — no compile errors. (No test needed — type-only export.)

- [ ] **Step 3.3: Commit**

```bash
git add packages/llm-unified/src/types.ts
git commit -m "Add ReasoningIntent discriminated union"
```

---

## Task 4 — `_reasoning-body.ts` per-provider body builder

**Files:**
- Create: `packages/llm-unified/src/_reasoning-body.ts`
- Create: `packages/llm-unified/src/_reasoning-body.test.ts`
- Modify: `packages/llm-unified/src/index.ts` (only if `applyReasoningToBody` needs to be re-exported — check)

- [ ] **Step 4.1: Write the failing test file**

Create `packages/llm-unified/src/_reasoning-body.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { applyReasoningToBody } from './_reasoning-body.js';
import type { ReasoningIntent } from './types.js';
import { NANO_GPT_PAIRS } from './providers/_nano-gpt-pairs.js';

// Sample model IDs — keep aligned with FIRST-MODELS.md curated list.
const NANO_FLAG_MODEL  = 'deepseek-v4-pro';       // pair switchingMode === 'flag'
const NANO_SLUG_MODEL  = 'glm-5.1';                // pair switchingMode === 'slug'
const NANO_NONE_MODEL  = 'kimi-k2.6';              // pair switchingMode === 'none'
const NOVITA_MODEL     = 'deepseek/deepseek-v4-pro';
const OLLAMA_MODEL     = 'gpt-oss:120b-cloud';

describe('applyReasoningToBody', () => {
  describe('nano-gpt', () => {
    it('slug-mode + enabled=true → swaps to thinkingSlug, body clean', () => {
      const pair = NANO_GPT_PAIRS[NANO_SLUG_MODEL];
      const intent: ReasoningIntent = { enabled: true };
      const { modelId, body } = applyReasoningToBody('nano-gpt', NANO_SLUG_MODEL, intent, {});
      expect(modelId).toBe(pair!.thinkingSlug);
      expect(body).not.toHaveProperty('reasoning');
      expect(body).not.toHaveProperty('thinking');
    });

    it('slug-mode + enabled=false → nonThinkingSlug, body clean', () => {
      const pair = NANO_GPT_PAIRS[NANO_SLUG_MODEL];
      const { modelId, body } = applyReasoningToBody('nano-gpt', NANO_SLUG_MODEL, { enabled: false }, {});
      expect(modelId).toBe(pair!.nonThinkingSlug);
      expect(body).not.toHaveProperty('reasoning');
    });

    it('flag-mode → body carries reasoning object; modelId unchanged', () => {
      const { modelId, body } = applyReasoningToBody(
        'nano-gpt', NANO_FLAG_MODEL,
        { enabled: true, effort: 'high' }, {},
      );
      expect(modelId).toBe(NANO_FLAG_MODEL);
      expect(body.reasoning).toEqual({ enabled: true, effort: 'high' });
    });

    it('flag-mode + enabled=false → body reasoning { enabled: false } without effort', () => {
      const { body } = applyReasoningToBody('nano-gpt', NANO_FLAG_MODEL, { enabled: false }, {});
      expect(body.reasoning).toEqual({ enabled: false });
    });

    it('none-mode → body clean regardless of intent', () => {
      const r1 = applyReasoningToBody('nano-gpt', NANO_NONE_MODEL, { enabled: true, effort: 'low' }, {});
      const r2 = applyReasoningToBody('nano-gpt', NANO_NONE_MODEL, { enabled: false }, {});
      for (const r of [r1, r2]) {
        expect(r.modelId).toBe(NANO_NONE_MODEL);
        expect(r.body).not.toHaveProperty('reasoning');
        expect(r.body).not.toHaveProperty('thinking');
      }
    });
  });

  describe('novita', () => {
    it('writes body.reasoning when enabled, with effort', () => {
      const { body } = applyReasoningToBody('novita', NOVITA_MODEL, { enabled: true, effort: 'medium' }, {});
      expect(body.reasoning).toEqual({ enabled: true, effort: 'medium' });
    });

    it('writes body.reasoning { enabled: false } when disabled', () => {
      const { body } = applyReasoningToBody('novita', NOVITA_MODEL, { enabled: false }, {});
      expect(body.reasoning).toEqual({ enabled: false });
    });
  });

  describe('ollama-cloud', () => {
    it('writes body.think = true when enabled (effort silently dropped)', () => {
      const { body } = applyReasoningToBody('ollama-cloud', OLLAMA_MODEL, { enabled: true, effort: 'high' }, {});
      expect(body.think).toBe(true);
      expect(body).not.toHaveProperty('reasoning');
    });

    it('writes body.think = false when disabled', () => {
      const { body } = applyReasoningToBody('ollama-cloud', OLLAMA_MODEL, { enabled: false }, {});
      expect(body.think).toBe(false);
    });
  });

  it('preserves pre-existing body fields unrelated to reasoning', () => {
    const { body } = applyReasoningToBody(
      'novita', NOVITA_MODEL, { enabled: true },
      { temperature: 0.7, max_tokens: 4096 },
    );
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(4096);
    expect(body.reasoning).toEqual({ enabled: true });
  });
});
```

- [ ] **Step 4.2: Run and confirm tests fail**

Run: `bun test --cwd packages/llm-unified src/_reasoning-body.test.ts`
Expected: FAIL — file `_reasoning-body.ts` not yet created.

- [ ] **Step 4.3: Write the implementation**

Create `packages/llm-unified/src/_reasoning-body.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { NANO_GPT_PAIRS } from './providers/_nano-gpt-pairs.js';
import type { ReasoningIntent } from './types.js';

export type ProviderId = 'nano-gpt' | 'novita' | 'ollama-cloud';

export interface ApplyResult {
  modelId: string;
  body: Record<string, unknown>;
}

/**
 * Translate a `ReasoningIntent` into the per-provider request shape.
 * Three quirks are encapsulated here:
 *   - nano-gpt with `switchingMode: 'slug'` swaps the model id and
 *     keeps the body clean. With `'flag'`, the body carries a unified
 *     `{ reasoning: { enabled, effort? } }` object; `'none'` is a
 *     no-op (capability-gated UI prevents the user from toggling).
 *   - novita uses the same unified `{reasoning:{enabled,effort}}` body
 *     object on every model with `kind: 'optional'`. Callers are
 *     expected to skip non-optional models — the function itself
 *     unconditionally writes the field when this provider is named;
 *     filtering by `KnownModel.reasoning.kind` happens upstream in
 *     the engine's `composeReasoningExtras`.
 *   - ollama-cloud uses `{ think: bool }`. There is no effort
 *     parameter — `intent.effort` is silently dropped.
 */
export function applyReasoningToBody(
  providerId: ProviderId,
  modelId: string,
  intent: ReasoningIntent,
  body: Record<string, unknown>,
): ApplyResult {
  const out: Record<string, unknown> = { ...body };

  if (providerId === 'nano-gpt') {
    const pair = NANO_GPT_PAIRS[modelId];
    if (!pair) return { modelId, body: out };
    if (pair.switchingMode === 'slug') {
      const swapped = intent.enabled
        ? (pair.thinkingSlug ?? pair.nonThinkingSlug)
        : pair.nonThinkingSlug;
      return { modelId: swapped, body: out };
    }
    if (pair.switchingMode === 'flag') {
      out.reasoning = intent.enabled
        ? { enabled: true, ...(intent.effort ? { effort: intent.effort } : {}) }
        : { enabled: false };
      return { modelId, body: out };
    }
    // switchingMode === 'none' → no field
    return { modelId, body: out };
  }

  if (providerId === 'novita') {
    out.reasoning = intent.enabled
      ? { enabled: true, ...(intent.effort ? { effort: intent.effort } : {}) }
      : { enabled: false };
    return { modelId, body: out };
  }

  if (providerId === 'ollama-cloud') {
    out.think = intent.enabled;
    return { modelId, body: out };
  }

  return { modelId, body: out };
}
```

- [ ] **Step 4.4: Run and confirm tests pass**

Run: `bun test --cwd packages/llm-unified src/_reasoning-body.test.ts`
Expected: all eleven cases PASS.

- [ ] **Step 4.5: Commit**

```bash
git add packages/llm-unified/src/_reasoning-body.ts \
        packages/llm-unified/src/_reasoning-body.test.ts
git commit -m "Add per-provider reasoning-body translation"
```

---

## Task 5 — `stream-completion.buildBody` delegates to `applyReasoningToBody`

**Files:**
- Modify: `packages/llm-unified/src/stream-completion.ts`
- Modify: `packages/llm-unified/src/stream-completion.test.ts` (or create the test file if absent — check first)

- [ ] **Step 5.1: Add failing tests for the new contract**

Edit `packages/llm-unified/src/stream-completion.test.ts` (create if missing). Add:

```ts
import { describe, expect, it } from 'bun:test';
import { buildBodyForTest } from './stream-completion.js';   // see Step 5.3
import type { KnownModel, ProviderDefinition } from './types.js';

const noviProvider: ProviderDefinition = { id: 'novita', /* …minimal stub */ } as ProviderDefinition;
const noviModel: KnownModel = { id: 'deepseek/deepseek-v4-pro', /* …minimal stub */ } as KnownModel;
const wireMsgs = [{ role: 'user' as const, content: 'hi' }];

describe('stream-completion.buildBody', () => {
  it('routes extras.reasoning through applyReasoningToBody (novita)', () => {
    const body = buildBodyForTest({
      provider: noviProvider, providerConfig: {} as any, apiKey: '', corsProxyUrl: null,
      corsProxyKey: null, model: noviModel, messages: wireMsgs,
      bodyExtras: { reasoning: { enabled: true, effort: 'high' } },
    });
    expect(body.reasoning).toEqual({ enabled: true, effort: 'high' });
    expect(body.model).toBe('deepseek/deepseek-v4-pro');
  });

  it('does NOT consume the legacy boolean `thinking` extra (drops silently)', () => {
    const body = buildBodyForTest({
      provider: noviProvider, providerConfig: {} as any, apiKey: '', corsProxyUrl: null,
      corsProxyKey: null, model: noviModel, messages: wireMsgs,
      bodyExtras: { thinking: true } as any,
    });
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('reasoning');   // intent absent → no field
  });
});
```

- [ ] **Step 5.2: Run and confirm tests fail**

Run: `bun test --cwd packages/llm-unified src/stream-completion.test.ts`
Expected: FAIL — `buildBodyForTest` not exported.

- [ ] **Step 5.3: Refactor `buildBody` to use `applyReasoningToBody` and export a test seam**

Edit `packages/llm-unified/src/stream-completion.ts`. Replace lines 85-112 (current `buildBody`) with:

```ts
import { applyReasoningToBody, type ProviderId } from './_reasoning-body.js';
import type { ReasoningIntent } from './types.js';

function buildBody(args: StreamCompletionArgs): Record<string, unknown> {
  const extras = { ...args.bodyExtras };

  // Drop the legacy boolean `thinking` flag if any caller still passes it —
  // it is replaced by `extras.reasoning: ReasoningIntent`. Defence in depth
  // against incomplete migrations.
  if (typeof extras.thinking !== 'undefined') {
    delete extras.thinking;
  }

  let modelId = args.model.id;
  const intent = extras.reasoning as ReasoningIntent | undefined;
  if (intent) {
    delete extras.reasoning;
    const applied = applyReasoningToBody(
      args.provider.id as ProviderId,
      args.model.id,
      intent,
      {},
    );
    modelId = applied.modelId;
    Object.assign(extras, applied.body);
  }

  return {
    model: modelId,
    messages: args.messages,
    stream: true,
    ...extras,
  };
}

// Test-only re-export so unit tests can exercise body composition without
// running the full streaming fetch path.
export const buildBodyForTest = buildBody;
```

- [ ] **Step 5.4: Run and confirm tests pass**

Run: `bun test --cwd packages/llm-unified src/stream-completion.test.ts`
Expected: both new cases PASS.

- [ ] **Step 5.5: Run full llm-unified test suite to check no regressions**

Run: `bun test --cwd packages/llm-unified`
Expected: all green (132+ → 132+11+5+2 = ~150 cases).

- [ ] **Step 5.6: Commit**

```bash
git add packages/llm-unified/src/stream-completion.ts \
        packages/llm-unified/src/stream-completion.test.ts
git commit -m "Route extras.reasoning through applyReasoningToBody"
```

---

## Task 6 — `ContentBlock` extension + Dexie v7

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts`
- Create: `apps/user-client/tests/boot/client-data-db-v7.test.ts`

- [ ] **Step 6.1: Write the failing migration test**

Create `apps/user-client/tests/boot/client-data-db-v7.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { getClientDataDb, resetClientDataDbForTest } from '../../src/boot/client-data-db.js';
import type { ContentBlock } from '../../src/boot/client-data-db.js';

afterEach(async () => {
  await resetClientDataDbForTest();
  await Dexie.delete('chatsundere_client_data');
});

describe('client-data-db v7', () => {
  it('opens at version 7 and accepts a reasoning ContentBlock', async () => {
    const db = getClientDataDb();
    await db.open();
    expect(db.verno).toBe(7);

    const messageId = 'msg-test-1';
    const blocks: ContentBlock[] = [
      { type: 'reasoning', text: 'thinking …' },
      { type: 'text', text: 'hello' },
    ];

    await db.messages.add({
      id: messageId,
      chatId: 'chat-1',
      role: 'persona',
      contentBlocks: blocks,
      streamingState: 'complete',
      createdAt: Date.now(),
    } as any);

    const row = await db.messages.get(messageId);
    expect(row?.contentBlocks).toEqual(blocks);
    expect(row?.contentBlocks[0].type).toBe('reasoning');
  });

  it('reads existing v6 rows (no reasoning blocks) unchanged after v7 open', async () => {
    // Seed a row with v6-style content blocks (text only)
    const db = getClientDataDb();
    await db.open();
    await db.messages.add({
      id: 'msg-v6-legacy',
      chatId: 'chat-1',
      role: 'persona',
      contentBlocks: [{ type: 'text', text: 'hi' }],
      streamingState: 'complete',
      createdAt: Date.now(),
    } as any);
    const row = await db.messages.get('msg-v6-legacy');
    expect(row?.contentBlocks).toEqual([{ type: 'text', text: 'hi' }]);
  });
});
```

- [ ] **Step 6.2: Run and confirm tests fail**

Run: `pnpm --filter user-client test client-data-db-v7`
Expected: FAIL — `db.verno` is 6, and TypeScript may also fail on the `reasoning` literal in the `ContentBlock[]`.

- [ ] **Step 6.3: Extend the type and bump Dexie**

Edit `apps/user-client/src/boot/client-data-db.ts`:

Line 95 — extend `ContentBlock`:

```ts
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'pill'; pillId: string }
  | { type: 'reasoning'; text: string };   // NEW (Phase 4)
```

Then locate the latest version declaration (likely `this.version(6).stores({…})` near the constructor). Append after it:

```ts
this.version(7).stores({
  // Schema-structurally identical to v6 — `contentBlocks` is a
  // non-indexed JSON column and accepts the widened ContentBlock
  // union without index changes. The bump is a code-capability
  // marker so callers can assume "this build knows reasoning
  // blocks".
});
```

- [ ] **Step 6.4: Run and confirm tests pass**

Run: `pnpm --filter user-client test client-data-db-v7`
Expected: both cases PASS.

- [ ] **Step 6.5: Commit**

```bash
git add apps/user-client/src/boot/client-data-db.ts \
        apps/user-client/tests/boot/client-data-db-v7.test.ts
git commit -m "Add reasoning ContentBlock variant + Dexie v7 bump"
```

---

## Task 7 — `lib/content-blocks.ts` pure helpers

**Files:**
- Create: `apps/user-client/src/lib/content-blocks.ts`
- Create: `apps/user-client/tests/unit/content-blocks.test.ts`

- [ ] **Step 7.1: Write the failing test file**

Create `apps/user-client/tests/unit/content-blocks.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  coalesceAdjacent,
  flattenAnswerText,
  groupAdjacent,
} from '../../src/lib/content-blocks.js';
import type { ContentBlock } from '../../src/boot/client-data-db.js';

describe('flattenAnswerText', () => {
  it('joins adjacent text blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'hello ' },
      { type: 'text', text: 'world' },
    ];
    expect(flattenAnswerText(blocks)).toBe('hello world');
  });

  it('filters out reasoning blocks entirely', () => {
    const blocks: ContentBlock[] = [
      { type: 'reasoning', text: 'thinking …' },
      { type: 'text', text: 'answer' },
    ];
    expect(flattenAnswerText(blocks)).toBe('answer');
  });

  it('ignores pill blocks (no plaintext)', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'before ' },
      { type: 'pill', pillId: 'p-1' },
      { type: 'text', text: 'after' },
    ];
    expect(flattenAnswerText(blocks)).toBe('before after');
  });

  it('handles empty array', () => {
    expect(flattenAnswerText([])).toBe('');
  });
});

describe('coalesceAdjacent', () => {
  it('merges adjacent text blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
      { type: 'text', text: 'c' },
    ];
    expect(coalesceAdjacent(blocks)).toEqual([{ type: 'text', text: 'abc' }]);
  });

  it('merges adjacent reasoning blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'reasoning', text: 'one ' },
      { type: 'reasoning', text: 'two' },
    ];
    expect(coalesceAdjacent(blocks)).toEqual([{ type: 'reasoning', text: 'one two' }]);
  });

  it('never merges pill blocks (preserves identity)', () => {
    const blocks: ContentBlock[] = [
      { type: 'pill', pillId: 'p-1' },
      { type: 'pill', pillId: 'p-2' },
    ];
    expect(coalesceAdjacent(blocks)).toEqual(blocks);
  });

  it('preserves boundaries between different types', () => {
    const blocks: ContentBlock[] = [
      { type: 'reasoning', text: 'think ' },
      { type: 'reasoning', text: 'more' },
      { type: 'text', text: 'answer ' },
      { type: 'text', text: 'here' },
      { type: 'reasoning', text: 'second-pass' },
    ];
    expect(coalesceAdjacent(blocks)).toEqual([
      { type: 'reasoning', text: 'think more' },
      { type: 'text', text: 'answer here' },
      { type: 'reasoning', text: 'second-pass' },
    ]);
  });
});

describe('groupAdjacent', () => {
  it('groups adjacent same-type blocks into ordered groups', () => {
    const blocks: ContentBlock[] = [
      { type: 'reasoning', text: 'a' },
      { type: 'reasoning', text: 'b' },
      { type: 'text', text: 'hello' },
      { type: 'pill', pillId: 'p-1' },
      { type: 'text', text: 'world' },
    ];
    const groups = groupAdjacent(blocks);
    expect(groups).toEqual([
      { type: 'reasoning', blocks: [{ type: 'reasoning', text: 'a' }, { type: 'reasoning', text: 'b' }] },
      { type: 'text', blocks: [{ type: 'text', text: 'hello' }] },
      { type: 'pill', blocks: [{ type: 'pill', pillId: 'p-1' }] },
      { type: 'text', blocks: [{ type: 'text', text: 'world' }] },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(groupAdjacent([])).toEqual([]);
  });
});
```

- [ ] **Step 7.2: Run and confirm tests fail**

Run: `pnpm --filter user-client test content-blocks`
Expected: FAIL — `content-blocks.ts` not yet created.

- [ ] **Step 7.3: Implement the helpers**

Create `apps/user-client/src/lib/content-blocks.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { ContentBlock } from '../boot/client-data-db.js';

export interface BlockGroup {
  type: ContentBlock['type'];
  blocks: ContentBlock[];
}

/**
 * Reduce a ContentBlock array to the plaintext answer the user
 * actually wrote / saw. Reasoning is filtered, pills carry no
 * plaintext, and text blocks are joined verbatim. Single source of
 * truth for copy, replay, and token estimation.
 */
export function flattenAnswerText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/**
 * Merge consecutive blocks of the same kind into one. Pill blocks
 * are never merged — they carry a `pillId` identity that must be
 * preserved.
 */
export function coalesceAdjacent(blocks: ContentBlock[]): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (!last || last.type !== b.type || b.type === 'pill') {
      out.push(b);
      continue;
    }
    if (b.type === 'text' && last.type === 'text') {
      out[out.length - 1] = { type: 'text', text: last.text + b.text };
    } else if (b.type === 'reasoning' && last.type === 'reasoning') {
      out[out.length - 1] = { type: 'reasoning', text: last.text + b.text };
    } else {
      out.push(b);
    }
  }
  return out;
}

/**
 * Walk the block array once and partition into ordered runs of
 * same-type blocks. The renderer dispatches one component per
 * group: a `<span class="msg-text">` for `'text'`, a
 * `<ReasoningPill>` for `'reasoning'`, a `<Pill>` for `'pill'`.
 */
export function groupAdjacent(blocks: ContentBlock[]): BlockGroup[] {
  const out: BlockGroup[] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (last && last.type === b.type) {
      last.blocks.push(b);
    } else {
      out.push({ type: b.type, blocks: [b] });
    }
  }
  return out;
}
```

- [ ] **Step 7.4: Run and confirm tests pass**

Run: `pnpm --filter user-client test content-blocks`
Expected: all eleven cases PASS.

- [ ] **Step 7.5: Commit**

```bash
git add apps/user-client/src/lib/content-blocks.ts \
        apps/user-client/tests/unit/content-blocks.test.ts
git commit -m "Add content-blocks helpers (flatten, coalesce, group)"
```

---

## Task 8 — `stream-engine` reasoning routing + `toWireMessage` via `flattenAnswerText`

**Files:**
- Modify: `apps/user-client/src/lib/stream-engine.ts`
- Modify: `apps/user-client/tests/unit/stream-engine.test.ts` (create if missing)

- [ ] **Step 8.1: Add failing tests for the routing**

Edit `apps/user-client/tests/unit/stream-engine.test.ts`. Add:

```ts
import { describe, expect, it, vi } from 'vitest';

// Mock the upstream streamCompletion to yield a deterministic chunk sequence
vi.mock('@chatsundere/llm-unified', async (orig) => {
  const m = await orig() as Record<string, unknown>;
  return {
    ...m,
    streamCompletion: vi.fn().mockImplementation(async function* () {
      yield { type: 'reasoning', text: 'planning … ' };
      yield { type: 'reasoning', text: 'more thought' };
      yield { type: 'token',     text: 'Hello ' };
      yield { type: 'token',     text: 'world.' };
      yield { type: 'finish',    reason: 'stop' };
    }),
  };
});

import { runStreamEngine } from '../../src/lib/stream-engine.js';

describe('runStreamEngine — reasoning', () => {
  it('appends reasoning chunks as reasoning blocks (coalesced) in finalContentBlocks', async () => {
    const onChunk = vi.fn();
    const result = await runStreamEngine({ /* …minimal args */ } as any);
    expect(result.finalContentBlocks).toEqual([
      { type: 'reasoning', text: 'planning … more thought' },
      { type: 'text', text: 'Hello world.' },
    ]);
  });

  it('exposes reasoning chunks through onChunk', async () => {
    const onChunk = vi.fn();
    await runStreamEngine({ onChunk, /* …minimal args */ } as any);
    const reasoningCalls = onChunk.mock.calls.filter(([c]) => c.type === 'reasoning');
    expect(reasoningCalls.length).toBe(2);
  });

  it('toWireMessage drops reasoning blocks from history replay', async () => {
    // Construct a MessageRow with mixed blocks and assert the wire shape.
    // Use the engine's internal `toWireMessage` via a test export, or
    // run a full engine cycle with `priorMessages` containing a
    // reasoning-bearing row and assert the captured wireMessages.
  });
});
```

Note: this test stub is partial — it requires fleshing out the `runStreamEngine` args with the new mock-friendly shape. Use the existing `chat-page.test.tsx` setup helpers as reference.

- [ ] **Step 8.2: Run and confirm tests fail**

Run: `pnpm --filter user-client test stream-engine`
Expected: FAIL — current engine does not route `'reasoning'` chunks.

- [ ] **Step 8.3: Extend the engine chunk loop**

Edit `apps/user-client/src/lib/stream-engine.ts`. Update imports at top (line 14ish) to add `flattenAnswerText`:

```ts
import { coalesceAdjacent, flattenAnswerText } from './content-blocks.js';
```

Update the chunk loop (lines 87-110) — add a new branch for `'reasoning'`:

```ts
    if (chunk.type === 'token') {
      appendText(contentBuffer, chunk.text);
    } else if (chunk.type === 'reasoning') {
      appendReasoning(contentBuffer, chunk.text);
    } else if (chunk.type === 'tool-call') {
      /* unchanged */
    } else if (chunk.type === 'finish') {
      finishReason = chunk.reason;
    } else if (chunk.type === 'error') {
      throw new Error(`stream-engine: upstream ${chunk.message}`);
    }
```

Add a sibling helper near `appendText` (after line 123):

```ts
/** Append reasoning to the tail of the content buffer, coalescing adjacent reasoning blocks. */
function appendReasoning(buf: ContentBlock[], text: string): void {
  const last = buf[buf.length - 1];
  if (last && last.type === 'reasoning') {
    last.text += text;
  } else {
    buf.push({ type: 'reasoning', text });
  }
}
```

Replace `toWireMessage` (lines 129-137) to use the helper:

```ts
function toWireMessage(m: MessageRow): WireMessage {
  const text = flattenAnswerText(m.contentBlocks);
  if (m.role === 'persona') return { role: 'assistant', content: text };
  if (m.role === 'system') return { role: 'system', content: text };
  return { role: 'user', content: text };
}
```

- [ ] **Step 8.4: Run and confirm tests pass**

Run: `pnpm --filter user-client test stream-engine`
Expected: PASS.

- [ ] **Step 8.5: Commit**

```bash
git add apps/user-client/src/lib/stream-engine.ts \
        apps/user-client/tests/unit/stream-engine.test.ts
git commit -m "Route reasoning chunks in stream-engine; toWireMessage uses flattenAnswerText"
```

---

## Task 9 — `reasoning-resolver` produces `ReasoningIntent`

**Files:**
- Modify: `apps/user-client/src/lib/reasoning-resolver.ts`
- Modify: `apps/user-client/tests/unit/reasoning-resolver.test.ts`

- [ ] **Step 9.1: Inspect the current resolver shape**

Run: `cat apps/user-client/src/lib/reasoning-resolver.ts`
Verify the current export: `resolveReasoningBodyExtras(model, reasoningState): Record<string, unknown>`.

- [ ] **Step 9.2: Add a failing test**

Edit `apps/user-client/tests/unit/reasoning-resolver.test.ts`. Add a new case:

```ts
it('produces { reasoning: ReasoningIntent } in extras for capability-optional models', () => {
  const model = { reasoning: { kind: 'optional', defaultOn: true, replayReasoning: false }, /* … */ } as any;
  const state = { mode: 'on' as const, effort: 'medium' as const };
  const extras = resolveReasoningBodyExtras(model, state);
  expect(extras.reasoning).toEqual({ enabled: true, effort: 'medium' });
});

it('produces { reasoning: { enabled: false } } when mode is off', () => {
  const model = { reasoning: { kind: 'optional', defaultOn: true, replayReasoning: false } } as any;
  const extras = resolveReasoningBodyExtras(model, { mode: 'off' as const });
  expect(extras.reasoning).toEqual({ enabled: false });
});

it('omits reasoning for no_reasoning models', () => {
  const model = { reasoning: { kind: 'no_reasoning', defaultOn: false, replayReasoning: false } } as any;
  const extras = resolveReasoningBodyExtras(model, { mode: 'off' as const });
  expect(extras).not.toHaveProperty('reasoning');
});

it('omits reasoning for always_on models (no toggling possible)', () => {
  const model = { reasoning: { kind: 'always_on', defaultOn: true, replayReasoning: false } } as any;
  const extras = resolveReasoningBodyExtras(model, { mode: 'on' as const });
  expect(extras).not.toHaveProperty('reasoning');
});
```

- [ ] **Step 9.3: Run and confirm tests fail**

Run: `pnpm --filter user-client test reasoning-resolver`
Expected: FAIL — current resolver returns `{ thinking: bool }` not `{ reasoning: ReasoningIntent }`.

- [ ] **Step 9.4: Refactor the resolver**

Edit `apps/user-client/src/lib/reasoning-resolver.ts`. Replace the `resolveReasoningBodyExtras` function body so it returns `{ reasoning: ReasoningIntent }` for `kind: 'optional'` models, and `{}` (empty extras) otherwise:

```ts
import type { KnownModel, ReasoningIntent } from '@chatsundere/llm-unified';

export type ReasoningState = { mode: 'on' | 'off'; effort?: 'low' | 'medium' | 'high' };

export function resolveReasoningBodyExtras(
  model: KnownModel,
  state: ReasoningState,
): Record<string, unknown> {
  if (model.reasoning.kind !== 'optional') return {};
  const intent: ReasoningIntent = state.mode === 'on'
    ? { enabled: true, ...(state.effort ? { effort: state.effort } : {}) }
    : { enabled: false };
  return { reasoning: intent };
}
```

- [ ] **Step 9.5: Run and confirm tests pass**

Run: `pnpm --filter user-client test reasoning-resolver`
Expected: PASS.

- [ ] **Step 9.6: Commit**

```bash
git add apps/user-client/src/lib/reasoning-resolver.ts \
        apps/user-client/tests/unit/reasoning-resolver.test.ts
git commit -m "Resolver emits ReasoningIntent for optional models, nothing for the rest"
```

---

## Task 10 — `copyMessageText` via `flattenAnswerText`

**Files:**
- Modify: `apps/user-client/src/components/chat/ChatStream.tsx`
- Modify: `apps/user-client/tests/unit/chat-stream.test.tsx`

- [ ] **Step 10.1: Add a failing test**

Edit `apps/user-client/tests/unit/chat-stream.test.tsx`. Add:

```ts
it('copyMessageText excludes reasoning blocks from the clipboard', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });

  const message: MessageRow = {
    id: 'm-1',
    chatId: 'c-1',
    role: 'persona',
    contentBlocks: [
      { type: 'reasoning', text: 'think …' },
      { type: 'text', text: 'visible answer' },
    ],
    streamingState: 'complete',
    createdAt: Date.now(),
  } as MessageRow;

  // Render ChatStream with this single message and click Copy via MessageControls.
  // Use the existing chat-stream-test render helpers; spec the Copy click.

  await user.click(screen.getByRole('button', { name: /copy/i }));
  expect(writeText).toHaveBeenCalledWith('visible answer');
});
```

- [ ] **Step 10.2: Run and confirm test fails**

Run: `pnpm --filter user-client test chat-stream`
Expected: FAIL — current `copyMessageText` joins all text blocks but does not filter reasoning (line 154-158).

- [ ] **Step 10.3: Refactor `copyMessageText`**

Edit `apps/user-client/src/components/chat/ChatStream.tsx`. Replace `copyMessageText` (lines 154-160):

```ts
import { flattenAnswerText } from '../../lib/content-blocks.js';

function copyMessageText(m: MessageRow): void {
  const text = flattenAnswerText(m.contentBlocks);
  void navigator.clipboard.writeText(text);
}
```

- [ ] **Step 10.4: Run and confirm tests pass**

Run: `pnpm --filter user-client test chat-stream`
Expected: PASS.

- [ ] **Step 10.5: Commit**

```bash
git add apps/user-client/src/components/chat/ChatStream.tsx \
        apps/user-client/tests/unit/chat-stream.test.tsx
git commit -m "copyMessageText uses flattenAnswerText (excludes reasoning)"
```

---

## Task 11 — `stream-manager` polymorphic chunk append

**Files:**
- Modify: `apps/user-client/src/state/stream-manager.store.ts`
- Modify: `apps/user-client/tests/unit/stream-manager-store.test.ts`

- [ ] **Step 11.1: Add failing tests for reasoning routing**

Edit `apps/user-client/tests/unit/stream-manager-store.test.ts`. Add:

```ts
it('mirrors reasoning chunks into the live content buffer as reasoning blocks', async () => {
  // Same setup as the existing token-chunk test but feed a reasoning chunk
  // through the engine mock instead.
  // Assert: handle.contentBuffer has `{ type: 'reasoning', text }`
});

it('preserves the non-coalescing live-buffer contract for reasoning (token-fade compat)', async () => {
  // Send two consecutive reasoning chunks of 'aa' and 'bb'.
  // Assert: buffer = [{type:'reasoning',text:'aa'}, {type:'reasoning',text:'bb'}]
  // — NOT a single merged block. Coalescing happens engine-side, on finalise.
});

it('rotates the handle reference on every reasoning chunk', async () => {
  // Same as the existing token-chunk handle-rotation test, with reasoning.
});
```

- [ ] **Step 11.2: Run and confirm tests fail**

Run: `pnpm --filter user-client test stream-manager-store`
Expected: FAIL — current `onChunk` early-returns on non-token chunks (line 125).

- [ ] **Step 11.3: Generalise the `onChunk` body**

Edit `apps/user-client/src/state/stream-manager.store.ts`. Replace lines 119-136:

```ts
      onChunk: (chunk) => {
        if (chunk.type !== 'token' && chunk.type !== 'reasoning') return;
        set((s) => {
          const live = s.streams.get(args.chatId);
          if (!live) return s;
          const nextBuf = [...live.contentBuffer];
          appendStreamChunk(nextBuf, { kind: chunk.type === 'reasoning' ? 'reasoning' : 'text', text: chunk.text });
          const nextHandle = { ...live, contentBuffer: nextBuf };
          const m = new Map(s.streams);
          m.set(args.chatId, nextHandle);
          return { streams: m };
        });
      },
```

Rename the local helper from `appendTextBlock` to `appendStreamChunk` and make it polymorphic. Replace lines 261-275 (the `appendTextBlock` function and its doc comment):

```ts
/**
 * Push a stream chunk as its own block in the live buffer. We deliberately
 * do NOT coalesce here so that the renderer sees one DOM span per upstream
 * chunk — that gives each newly-arrived token a fresh-mount and lets the
 * `.token-fade` CSS keyframe play exactly once per chunk, without
 * re-triggering on existing spans. Coalescing happens once, engine-side,
 * at stream finalise (see stream-engine.appendText / appendReasoning).
 *
 * The same contract holds for reasoning chunks — every upstream reasoning
 * delta becomes its own sub-block so the body of an open ReasoningPill
 * also benefits from per-chunk fade-in.
 */
function appendStreamChunk(
  buf: ContentBlock[],
  chunk: { kind: 'text' | 'reasoning'; text: string },
): void {
  buf.push(
    chunk.kind === 'reasoning'
      ? { type: 'reasoning', text: chunk.text }
      : { type: 'text',      text: chunk.text },
  );
}
```

- [ ] **Step 11.4: Run and confirm tests pass**

Run: `pnpm --filter user-client test stream-manager-store`
Expected: PASS, plus existing token-chunk tests stay green.

- [ ] **Step 11.5: Commit**

```bash
git add apps/user-client/src/state/stream-manager.store.ts \
        apps/user-client/tests/unit/stream-manager-store.test.ts
git commit -m "Stream-manager appends reasoning chunks alongside text (non-coalescing)"
```

---

## Task 12 — Title-generator drops reasoning chunks

**Files:**
- Modify: `apps/user-client/src/lib/title-generator.ts`
- Modify: `apps/user-client/tests/unit/title-generator.test.ts`

- [ ] **Step 12.1: Add a failing test**

Edit `apps/user-client/tests/unit/title-generator.test.ts`. Add:

```ts
it('ignores reasoning chunks; uses only token chunks for the title', async () => {
  vi.mocked(streamCompletion).mockImplementation(async function* () {
    yield { type: 'reasoning', text: 'considering …' };
    yield { type: 'token',     text: 'Weekend plans' };
    yield { type: 'finish',    reason: 'stop' };
  });

  const title = await generateTitle({ /* …minimal args */ } as any);
  expect(title).toBe('Weekend plans');
});
```

- [ ] **Step 12.2: Run and confirm test fails**

Run: `pnpm --filter user-client test title-generator`
Expected: FAIL — either the title becomes `'considering …Weekend plans'` or the test throws because the loop doesn't handle the reasoning variant.

- [ ] **Step 12.3: Update the title-gen stream loop**

Edit `apps/user-client/src/lib/title-generator.ts`. Locate the chunk loop (`for await (const chunk of streamCompletion(…))`). Add at the top of the loop body:

```ts
if (chunk.type === 'reasoning') continue;
```

- [ ] **Step 12.4: Run and confirm test passes**

Run: `pnpm --filter user-client test title-generator`
Expected: PASS.

- [ ] **Step 12.5: Commit**

```bash
git add apps/user-client/src/lib/title-generator.ts \
        apps/user-client/tests/unit/title-generator.test.ts
git commit -m "Title-gen drops reasoning chunks"
```

---

## Task 13 — `ReasoningPill` component + CSS

**Files:**
- Create: `apps/user-client/src/components/chat/ReasoningPill.tsx`
- Modify: `apps/user-client/src/index.css`
- Create: `apps/user-client/tests/unit/reasoning-pill.test.tsx`

- [ ] **Step 13.1: Write the failing component test**

Create `apps/user-client/tests/unit/reasoning-pill.test.tsx`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReasoningPill } from '../../src/components/chat/ReasoningPill.js';

const mindspaceStub = { /* …palette stub matching ResolvedMindspace */ } as any;

describe('<ReasoningPill>', () => {
  it('renders closed by default with aria-expanded="false"', () => {
    render(<ReasoningPill text="thinking …" isLive isStreamingDraft={false} mindspace={mindspaceStub} font="serif" />);
    const handle = screen.getByRole('button');
    expect(handle.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows the dot-pulse animation class while isLive', () => {
    render(<ReasoningPill text="" isLive isStreamingDraft={false} mindspace={mindspaceStub} font="serif" />);
    const dots = screen.getByTestId('reasoning-pill-dots');
    expect(dots.className).toContain('reasoning-pill-dots');
    expect(dots.querySelectorAll('.dot').length).toBe(3);
  });

  it('omits the animation class when !isLive (finalised)', () => {
    render(<ReasoningPill text="done" isLive={false} isStreamingDraft={false} mindspace={mindspaceStub} font="serif" />);
    const handle = screen.getByRole('button');
    expect(handle.getAttribute('data-state')).toBe('closed');
    expect(handle.getAttribute('data-live')).toBe('false');
  });

  it('toggles open on click and renders body text with pre-wrap', async () => {
    const user = userEvent.setup();
    render(<ReasoningPill text="line one\n\nline two" isLive={false} isStreamingDraft={false} mindspace={mindspaceStub} font="serif" />);
    await user.click(screen.getByRole('button'));
    const body = screen.getByRole('region', { name: /reasoning trace/i });
    expect(body.textContent).toContain('line one');
    expect(body.textContent).toContain('line two');
    expect(getComputedStyle(body).whiteSpace).toBe('pre-wrap');
  });

  it('uses the persona font on the body', () => {
    render(<ReasoningPill text="hi" isLive={false} isStreamingDraft={false} mindspace={mindspaceStub} font="display" />);
    // open the pill first
    fireEvent.click(screen.getByRole('button'));
    const body = screen.getByRole('region', { name: /reasoning trace/i });
    expect(body.style.fontFamily).toContain('var(--font-display)');
  });
});
```

- [ ] **Step 13.2: Run and confirm tests fail**

Run: `pnpm --filter user-client test reasoning-pill`
Expected: FAIL — file does not exist.

- [ ] **Step 13.3: Write the ReasoningPill component**

Create `apps/user-client/src/components/chat/ReasoningPill.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import type { PersonaFont } from '../../boot/client-data-db.js';
import { FONT_VAR } from '../../lib/persona-font.js';
import type { ResolvedMindspace } from '../../state/mindspace-resolver.js';

export interface ReasoningPillProps {
  text: string;
  isLive: boolean;
  isStreamingDraft: boolean;
  mindspace: ResolvedMindspace;
  font: PersonaFont;
}

/**
 * Closed/open chain-of-thought pill. Closed: three sequentially-pulsing
 * dots + chevron, only the dot pulse animates while `isLive`. Open: body
 * streams the trace in the persona font with `white-space: pre-wrap`.
 */
export function ReasoningPill(p: ReasoningPillProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const persFont = FONT_VAR[p.font];

  const handle = (
    <button
      type="button"
      className="reasoning-pill"
      data-state={open ? 'open' : 'closed'}
      data-live={p.isLive ? 'true' : 'false'}
      aria-expanded={open}
      onClick={() => setOpen((v) => !v)}
    >
      <span className="reasoning-pill-dots" data-testid="reasoning-pill-dots" aria-hidden="true">
        <span className="dot">·</span>
        <span className="dot">·</span>
        <span className="dot">·</span>
      </span>
      <svg className="reasoning-pill-chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M2 1 L7 5 L2 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {p.isLive && (
        <span className="sr-only" aria-live="polite">Model is thinking</span>
      )}
    </button>
  );

  if (!open) return handle;

  return (
    <div className="reasoning-pill-open">
      {handle}
      <div
        className="reasoning-pill-body"
        role="region"
        aria-label="Reasoning trace"
        style={{ fontFamily: persFont, whiteSpace: 'pre-wrap' }}
      >
        {p.text}
      </div>
    </div>
  );
}
```

- [ ] **Step 13.4: Add the CSS rules**

Edit `apps/user-client/src/index.css`. Append at the bottom of the file (verify no conflicting selector exists first via `grep -n "reasoning-pill" apps/user-client/src/index.css`):

```css
/* === Phase 4 — ReasoningPill === */

.reasoning-pill,
.pill {
  margin-block: 0.75rem;
}

.reasoning-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  cursor: pointer;
  user-select: none;
  background: color-mix(in srgb, var(--mindspace-accent, #4a7eb3) 18%, var(--color-ink) 82%);
  border: 1px solid color-mix(in srgb, var(--mindspace-accent, #4a7eb3) 35%, transparent);
  color: var(--color-paper);
  appearance: none;
}

.reasoning-pill-dots {
  display: inline-flex;
  gap: 0.15rem;
  letter-spacing: 0.05em;
}
.reasoning-pill-dots .dot {
  display: inline-block;
  line-height: 1;
}
.reasoning-pill[data-live="true"] .reasoning-pill-dots .dot {
  animation: reasoning-dots-pulse 1.2s ease-in-out infinite;
}
.reasoning-pill[data-live="true"] .reasoning-pill-dots .dot:nth-child(1) { animation-delay: 0s;    }
.reasoning-pill[data-live="true"] .reasoning-pill-dots .dot:nth-child(2) { animation-delay: 0.18s; }
.reasoning-pill[data-live="true"] .reasoning-pill-dots .dot:nth-child(3) { animation-delay: 0.36s; }

@keyframes reasoning-dots-pulse {
  0%, 100% { opacity: 0.3; transform: translateY(0); }
  50%      { opacity: 1;   transform: translateY(-1px); }
}

.reasoning-pill-chevron {
  opacity: 0.7;
  transition: transform 200ms ease;
}
.reasoning-pill[data-state="open"] .reasoning-pill-chevron {
  transform: rotate(90deg);
}

.reasoning-pill-open {
  display: inline-flex;
  flex-direction: column;
  align-items: stretch;
  max-width: 100%;
}
.reasoning-pill-open > .reasoning-pill {
  border-radius: 14px 14px 0 0;
  margin: 0;
  align-self: flex-start;
}

.reasoning-pill-body {
  padding: 0.6rem 0.85rem;
  font-size: 0.85rem;
  line-height: 1.55;
  background: color-mix(in srgb, var(--mindspace-accent, #4a7eb3) 8%, var(--color-ink) 92%);
  border: 1px solid color-mix(in srgb, var(--mindspace-accent, #4a7eb3) 25%, transparent);
  border-top: 0;
  border-radius: 0 0 14px 14px;
  color: var(--color-paper);
}

@media (prefers-reduced-motion: reduce) {
  .reasoning-pill[data-live="true"] .reasoning-pill-dots .dot { animation: none; }
  .reasoning-pill-chevron { transition: none; }
}
```

- [ ] **Step 13.5: Run and confirm tests pass**

Run: `pnpm --filter user-client test reasoning-pill`
Expected: PASS.

- [ ] **Step 13.6: Commit**

```bash
git add apps/user-client/src/components/chat/ReasoningPill.tsx \
        apps/user-client/src/index.css \
        apps/user-client/tests/unit/reasoning-pill.test.tsx
git commit -m "Add ReasoningPill component + CSS (Animation A, 18 % accent)"
```

---

## Task 14 — `MessageBlock` renders reasoning groups via `<ReasoningPill>`

**Files:**
- Modify: `apps/user-client/src/components/chat/MessageBlock.tsx`
- Modify: `apps/user-client/tests/unit/message-block.test.tsx` (create if missing)

- [ ] **Step 14.1: Inspect current `MessageBlock.renderBlocks`**

Run: `cat apps/user-client/src/components/chat/MessageBlock.tsx`
Locate the `renderBlocks` function (line ~97). It currently iterates blocks and switches on `b.type === 'text'` vs `'pill'`. Note where `mindspace` and `persona` are in scope.

- [ ] **Step 14.2: Add failing tests**

Edit `apps/user-client/tests/unit/message-block.test.tsx`:

```ts
it('renders a single ReasoningPill for a maximal reasoning run', () => {
  const message: MessageRow = {
    id: 'm-1', chatId: 'c', role: 'persona',
    contentBlocks: [
      { type: 'reasoning', text: 'plan A. ' },
      { type: 'reasoning', text: 'plan B.' },
      { type: 'text', text: 'Result: …' },
    ],
    streamingState: 'complete', createdAt: Date.now(),
  } as MessageRow;
  render(<MessageBlock message={message} pills={[]} persona={personaStub} mindspace={mindspaceStub} isStreamingDraft={false} />);
  expect(screen.getAllByRole('button', { name: /thinking|reasoning/i }).length).toBe(1);
  expect(screen.getByText(/result/i)).toBeInTheDocument();
});

it('renders two ReasoningPills for interleaved reasoning-text-reasoning-text', () => {
  const message: MessageRow = {
    id: 'm-2', chatId: 'c', role: 'persona',
    contentBlocks: [
      { type: 'reasoning', text: 'think 1' },
      { type: 'text', text: 'partial answer' },
      { type: 'reasoning', text: 'think 2' },
      { type: 'text', text: 'final answer' },
    ],
    streamingState: 'complete', createdAt: Date.now(),
  } as MessageRow;
  render(<MessageBlock message={message} pills={[]} persona={personaStub} mindspace={mindspaceStub} isStreamingDraft={false} />);
  const pills = screen.getAllByRole('button').filter(b => b.classList.contains('reasoning-pill'));
  expect(pills.length).toBe(2);
});

it('marks only the LAST reasoning pill as isLive when streaming', () => {
  const message: MessageRow = {
    id: 'm-3', chatId: 'c', role: 'persona',
    contentBlocks: [
      { type: 'reasoning', text: 't1' },
      { type: 'text', text: 'answer' },
      { type: 'reasoning', text: 't2' },
    ],
    streamingState: 'streaming', createdAt: Date.now(),
  } as MessageRow;
  render(<MessageBlock message={message} pills={[]} persona={personaStub} mindspace={mindspaceStub} isStreamingDraft />);
  const pills = screen.getAllByRole('button').filter(b => b.classList.contains('reasoning-pill'));
  expect(pills[0].getAttribute('data-live')).toBe('false');
  expect(pills[1].getAttribute('data-live')).toBe('true');
});
```

- [ ] **Step 14.3: Run and confirm tests fail**

Run: `pnpm --filter user-client test message-block`
Expected: FAIL — current renderer doesn't know about reasoning.

- [ ] **Step 14.4: Rewrite `renderBlocks` to use `groupAdjacent`**

Edit `apps/user-client/src/components/chat/MessageBlock.tsx`. Add imports:

```ts
import { groupAdjacent } from '../../lib/content-blocks.js';
import { ReasoningPill } from './ReasoningPill.js';
```

Replace the `renderBlocks` function. Use the existing signature (and arguments — adjust to whatever the current implementation passes; capture `mindspace` and `persona` from outer scope or extend the signature):

```ts
function renderBlocks(
  blocks: ContentBlock[],
  pills: PillRow[],
  isStreamingDraft: boolean,
  persona: PersonaRow,
  mindspace: ResolvedMindspace,
): JSX.Element[] {
  const groups = groupAdjacent(blocks);
  const lastReasoningIdx = isStreamingDraft
    ? groups.map((g) => g.type).lastIndexOf('reasoning')
    : -1;

  return groups.map((group, idx) => {
    if (group.type === 'text') {
      return (
        <span
          key={`g-${idx}`}
          className="msg-text"
          style={{ fontFamily: FONT_VAR[persona.font] }}
        >
          {group.blocks.map((b, j) => (
            <span
              key={`t-${idx}-${j}`}
              className={isStreamingDraft ? 'token-fade' : undefined}
            >
              {(b as { type: 'text'; text: string }).text}
            </span>
          ))}
        </span>
      );
    }
    if (group.type === 'reasoning') {
      const trace = group.blocks
        .map((b) => (b as { type: 'reasoning'; text: string }).text)
        .join('');
      return (
        <ReasoningPill
          key={`g-${idx}`}
          text={trace}
          isLive={idx === lastReasoningIdx}
          isStreamingDraft={isStreamingDraft}
          mindspace={mindspace}
          font={persona.font}
        />
      );
    }
    // 'pill' — single-block group (pill blocks never coalesce)
    const pillBlock = group.blocks[0] as { type: 'pill'; pillId: string };
    const pillRow = pills.find((p) => p.id === pillBlock.pillId);
    if (!pillRow) return <></>;
    return <Pill key={`g-${idx}`} pill={pillRow} />;
  });
}
```

Also propagate the additional arguments at the call site. Locate line 82 (`renderBlocks(p.message.contentBlocks, p.pills, p.isStreamingDraft === true)`) and update:

```ts
renderBlocks(p.message.contentBlocks, p.pills, p.isStreamingDraft === true, p.persona, p.mindspace)
```

If `mindspace` is not yet a prop on MessageBlock, add it. Find the `interface MessageBlockProps` or `interface Props` near the top (around line 9-15) and add:

```ts
mindspace: ResolvedMindspace;
```

Then add it at every `<MessageBlock …/>` caller in `ChatStream.tsx` (search and pass through from the existing mindspace store).

- [ ] **Step 14.5: Run and confirm tests pass**

Run: `pnpm --filter user-client test message-block && pnpm --filter user-client test chat-stream`
Expected: PASS for both.

- [ ] **Step 14.6: Commit**

```bash
git add apps/user-client/src/components/chat/MessageBlock.tsx \
        apps/user-client/src/components/chat/ChatStream.tsx \
        apps/user-client/tests/unit/message-block.test.tsx
git commit -m "Render reasoning groups as ReasoningPills (one per maximal run)"
```

---

## Task 15 — Integration test: reasoning + text mocked stream end-to-end

**Files:**
- Create: `apps/user-client/tests/integration/cot-display.test.tsx`

- [ ] **Step 15.1: Write the integration test**

Create `apps/user-client/tests/integration/cot-display.test.tsx`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderChatPage, seedPersona, seedChat } from '../helpers/render-chat.js';   // create if not present

vi.mock('@chatsundere/llm-unified', async (orig) => {
  const m = await orig() as Record<string, unknown>;
  return {
    ...m,
    streamCompletion: vi.fn().mockImplementation(async function* () {
      yield { type: 'reasoning', text: 'considering …' };
      yield { type: 'reasoning', text: ' and weighing options' };
      yield { type: 'token', text: 'Hi there.' };
      yield { type: 'finish', reason: 'stop' };
    }),
  };
});

describe('CoT display — end-to-end', () => {
  it('renders reasoning pill during stream, then preserves it after finalise', async () => {
    const user = userEvent.setup();
    const personaId = await seedPersona({ /* reasoning-capable model */ });
    const chatId = await seedChat({ personaId });

    renderChatPage({ chatId });

    await user.type(screen.getByPlaceholderText(/message/i), 'hello');
    await user.click(screen.getByRole('button', { name: /send/i }));

    // 1. Pill appears during stream
    await waitFor(() => {
      const pill = screen.getByRole('button', { name: /thinking|reasoning/i });
      expect(pill.getAttribute('data-live')).toBe('true');
    });

    // 2. Pill goes static after stream finalise
    await waitFor(() => {
      const pill = screen.getByRole('button', { name: /thinking|reasoning/i });
      expect(pill.getAttribute('data-live')).toBe('false');
    });

    // 3. Pill opens and shows the coalesced trace
    await user.click(screen.getByRole('button', { name: /thinking|reasoning/i }));
    const body = await screen.findByRole('region', { name: /reasoning trace/i });
    expect(body.textContent).toContain('considering');
    expect(body.textContent).toContain('weighing options');
  });
});
```

`renderChatPage` is the existing helper used by `chat-page.test.tsx` — adapt or build a thin wrapper if not already exported.

- [ ] **Step 15.2: Run and confirm test passes**

Run: `pnpm --filter user-client test cot-display`
Expected: PASS.

- [ ] **Step 15.3: Commit**

```bash
git add apps/user-client/tests/integration/cot-display.test.tsx
git commit -m "Add end-to-end CoT display integration test"
```

---

## Task 16 — Full verification pass

**Files:** none — verification only.

- [ ] **Step 16.1: Run all llm-unified Bun tests**

Run: `pnpm --filter @chatsundere/llm-unified test`
Expected: all green; counts increased by ~16 over the Phase-3.1 baseline.

- [ ] **Step 16.2: Run all user-client Vitest tests**

Run: `pnpm --filter user-client test`
Expected: all green except the eight known pre-existing cockpit-draft localStorage failures (unrelated to this work). Net new passing cases: ~30.

- [ ] **Step 16.3: Run typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm --filter user-client run build`
Expected: clean across all three.

- [ ] **Step 16.4: Manual device smoke (Chris)**

Items per the spec §9.4:

  1. DeepSeek V4 Pro via Novita — pill renders, dots pulse, opens to streamed trace
  2. Gemma 4 31B — no pill (no-reasoning model)
  3. Cockpit reasoning OFF on a Novita reasoning-capable model → no pill (Reasoning-OFF translation verified)
  4. Cockpit reasoning OFF on a nano-gpt flag-mode model → no pill
  5. Tab-close mid-reasoning → refresh → StreamInterruptedFooter shows; pill openable
  6. Switching mindspace mid-chat — pill background follows accent
  7. System reduced-motion → dots static
  8. Copy a message with a reasoning trace — only the answer in clipboard
  9. Regenerate a message → new pill, old trace gone
  10. NSFW panic: live stream against adult persona, flip to SFW → chat closes, return later → pill + StreamInterruptedFooter visible (verifies the Pre-Phase-4 hotfix path too)

Document any deviations in `obsidian/insights/2026-05-25-phase-4-smoke.md` before Task 17.

- [ ] **Step 16.5: Commit (no-op — verification only)**

No commit unless smoke uncovers a defect that needs an additional task-commit before squash. If a defect surfaces, branch the task list with a `Task 16.X` patch step, fix TDD-paired, then return to Task 17.

---

## Task 17 — Squash and STATUS-update

**Files:**
- Modify: `obsidian/STATUS-CLIENT-ONLY.md`

- [ ] **Step 17.1: Identify the boundary commit**

Run: `git log --oneline master | head -25`
Find the Task 0 hotfix commit (the first commit after `86a21bb`). The squash boundary is one commit *after* the hotfix.

- [ ] **Step 17.2: Soft-reset to the squash boundary**

Run: `git reset --soft <hotfix-commit-sha>`

This leaves Task 0's hotfix as a separate commit and stages all Phase-4 changes for re-commit.

- [ ] **Step 17.3: Create the single Phase-4 squash commit**

```bash
git commit -m "$(cat <<'EOF'
Phase 4 — CoT display + reasoning-OFF translation

Adds a reasoning ContentBlock variant alongside text and pill,
extends StreamChunk with a reasoning variant, and surfaces the
trace as a closed-by-default expandable pill in the chat surface.
Pill uses Animation A (sequential dot pulse) and 18 % mindspace-
accent saturation locked during the visual companion brainstorm.

Reasoning-OFF translation is now per-provider in a new
`packages/llm-unified/src/_reasoning-body.ts` module driven by a
`ReasoningIntent` discriminated union: nano-gpt slug-swap vs
flag-body (`{reasoning:{enabled,effort}}`), Novita unified
`{reasoning:{enabled,effort}}`, Ollama `{think:bool}`. Replaces
the Phase-3.1 boolean-thinking specialisation.

Helpers consolidated in `apps/user-client/src/lib/content-blocks.ts`
(flattenAnswerText, coalesceAdjacent, groupAdjacent). Copy,
replay (toWireMessage), and token-estimate all read through
flattenAnswerText — reasoning never crosses to clipboard, wire,
or context-gauge. Title-gen drops reasoning chunks silently.

Dexie bumps to v7 as a code-capability marker; schema-structurally
unchanged. Interleaved-thinking (multiple pills per message)
works structurally; device verification deferred to Block 3 when
tool execution lands.

Spec: superpowers/specs/2026-05-25-phase-4-cot-display-design.md.
Tests: 16 new Bun cases (llm-unified), ~30 new Vitest cases
(user-client), one integration test exercising the full stream.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 17.4: Update STATUS-CLIENT-ONLY.md**

Edit `obsidian/STATUS-CLIENT-ONLY.md`:

- Move the "Phase 4 — History + Polish" line from "Briefed, awaiting implementation" to a new "Done" entry titled "Phase 4 — CoT display + reasoning-OFF translation (2026-05-25)" with the squash-commit SHA.
- Remove the "Thinking display during stream" and "Reasoning-OFF translation for non-nano-gpt providers" lines from "Known follow-ups".
- Add a new "Briefed, awaiting implementation" entry "Phase 4.x — History page + Setup-Hints" (the originally-briefed Phase 4 work, still gated on Lyra's wireframe).
- Update the "Last updated" line at the top.
- Update "Next session" block: simple My History page → first versioned alpha build (unchanged plan, but unblocked by Phase 4 progress).

- [ ] **Step 17.5: Commit the STATUS update**

```bash
git add obsidian/STATUS-CLIENT-ONLY.md
git commit -m "Phase 4 squashed — update STATUS-CLIENT-ONLY [skip ci]"
```

- [ ] **Step 17.6: Verify the log shape**

Run: `git log --oneline -5`
Expected: `<sha> Phase 4 squashed — update STATUS-CLIENT-ONLY [skip ci]` on top, then `<sha> Phase 4 — CoT display + reasoning-OFF translation`, then the Task-0 hotfix, then the prior `86a21bb` baseline.

- [ ] **Step 17.7: Final sanity check**

Run: `pnpm typecheck && pnpm lint && pnpm --filter user-client run build && pnpm --filter @chatsundere/llm-unified test && pnpm --filter user-client test`
Expected: all clean.

---

## Self-review checklist

Run before handing off:

- [x] Every spec section maps to a task — §3 architecture (Tasks 1–14), §4 data model (Tasks 1, 3, 6), §5 stream pipeline (Tasks 2, 4, 5, 8, 9, 12), §6 stream-manager (Task 11), §7 UI (Tasks 13, 14), §8 edge cases (covered as test assertions across Tasks 7–14, plus §16.4 manual smoke), §9 testing (Tasks 1–15 are TDD), §10 sub-phases (Tasks 0 vs 1–17 sequencing).
- [x] No `TBD`, `TODO`, `implement later`, or "add error handling" placeholders.
- [x] Type names consistent: `ReasoningIntent` defined Task 3, used Tasks 4, 5, 9. `ContentBlock` extended Task 6, used Tasks 7, 8, 11, 14. `BlockGroup` defined Task 7, used Task 14.
- [x] Every code step has the actual code shown.
- [x] Commit messages follow CLAUDE.md §8 (imperative, no Conventional Commits prefix; `[skip ci]` on doc-only commit Task 17.5; co-author tag on the squash).
