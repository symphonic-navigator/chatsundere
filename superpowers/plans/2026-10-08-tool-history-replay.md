# Tool History Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replay prior tool exchanges structurally (`assistant(tool_calls)` + `tool`) instead of as flattened text, so models stop learning to fake tool use from their own history.

**Architecture:** A pure module `apps/user-client/src/lib/tool-replay.ts` decomposes a persisted persona message plus its pills into wire messages, mints deterministic provider-neutral call ids, truncates results, applies the graded orphan policy, and provides the shared token estimator and compaction transcript lines. The stream engine, stream manager, compaction runner and context meters consume it. `llm-unified` gains the measured profile field `toolCalls.orphanReplay`, adapter serialisation tests, two suite scenarios, and a live probe script.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), React 18, Dexie, Vitest (user-client), Bun test (llm-unified), Biome.

**Spec:** `superpowers/specs/2026-10-08-tool-history-replay-design.md` — read it before your task.

## Global Constraints

- Work only in the worktree `.claude/worktrees/tool-history-replay` on branch `feat/tool-history-replay`. **Subagents never merge, push, or switch branches.** Verify your commit landed with `git branch --contains HEAD`.
- Every text artefact is British English (code, comments, test names, log strings, commit messages).
- New files start with the licence header of their package: `// SPDX-License-Identifier: AGPL-3.0-only` (user-client) or `// SPDX-License-Identifier: LGPL-3.0-only` (llm-unified).
- Biome bans the non-null assertion `!`. Use guards or `?.`/`??` instead.
- `noUncheckedIndexedAccess` is on: indexed reads are `T | undefined`; use `charAt`, `.at()`, or guards.
- Every exported function carries at least a one-line JSDoc.
- `REPLAY_RESULT_MAX_CHARS = 2000`; truncation suffix exactly `[… N characters omitted from history]`.
- Interrupted call result text exactly `The call was interrupted before it completed.`
- Replayed call ids: exactly 9 characters from `[A-Za-z0-9]`, deterministic per `pillId`.
- `toolCalls.orphanReplay` absent ⇒ `false`.
- A tool-free chat's wire output must stay byte-identical to the current builder.
- Commit messages: free-form imperative, capitalised subject, no Conventional Commits prefix, trailer `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`.
- After any change in `packages/llm-unified/src`, rebuild it (`pnpm --filter @chatsundere/llm-unified build`) before running user-client typecheck — stale `dist` causes phantom errors.

## Review Focus

1. **A persona message whose tool rounds carry no text between them** (round 1 pills, round 2 pills, then text): the blocks are indistinguishable from one parallel round and are replayed as one — accepted, but a reasoning block between rounds must split them. Pinned in Task 3.
2. **Context truncation cutting through a tool group** (`truncateToWindow` dropping an `assistant(tool_calls)` but keeping its `tool` messages) → provider 400. Expect leading orphaned `tool` messages to be dropped with it. Pinned in Task 2.
3. **Pills not yet synced to this device** (block references a missing `PillRow`): expect a quiet text-only fallback for that run, one `console.warn` on the send path, and no warn from the render-time estimators. Pinned in Task 3.
4. **A chat switched mid-way to a model without tool support or with a tool now absent**: expect today's text-only replay for exactly the affected rounds, never an HTTP 400. Pinned in Task 3 (policy) and Task 4 (policy wiring).
5. **Tool-heavy chats in the context meter**: the meter and the overflow trigger must count the same bytes the wire sends. Pinned by the parity test in Task 3 and the meter test in Task 5.

---

### Task 1: llm-unified — `orphanReplay` field, Mistral drop warnings, adapter history tests

**Files:**
- Modify: `packages/llm-unified/src/catalogue/types.ts:15`
- Modify: `packages/llm-unified/src/adapters/mistral-openai.ts:103-125` (`foldDeltaContent`) and `:224-236` (finish handler)
- Test: `packages/llm-unified/src/adapters/mistral-openai.test.ts`, `packages/llm-unified/src/adapters/ollama-native.test.ts`, `packages/llm-unified/src/adapters/anthropic-claude.test.ts`, `packages/llm-unified/src/adapters/claude-openrouter.test.ts`

**Interfaces:**
- Produces: `ModelProfile['toolCalls']` = `{ supported: boolean; streaming: boolean; concurrentWithReasoning: boolean; orphanReplay?: boolean }`.

- [ ] **Step 1: Add the profile field**

In `catalogue/types.ts` replace line 15:

```ts
  toolCalls: {
    supported: boolean;
    streaming: boolean;
    concurrentWithReasoning: boolean;
    /** The provider accepts replayed tool calls whose tool is absent from the
     *  current request's `tools` array. Measured by the `orphan-tool-replay`
     *  suite scenario; absent ⇒ false (such rounds replay as text only). */
    orphanReplay?: boolean;
  };
```

- [ ] **Step 2: Write failing tests for the Mistral warnings**

Append to `mistral-openai.test.ts` (reuse the file's existing helpers for building an adapter and feeding a parsed SSE payload into `parseChunk`; read the top of the file to match them):

```ts
describe('mistral adapter — silent drops are visible', () => {
  it('warns when delta.content carries an unknown item type', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // An item type we do not understand must not vanish silently.
    feedChunk({ choices: [{ index: 0, delta: { content: [{ type: 'image_ref', ref: 'x' }] } }] });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('image_ref'));
    warn.mockRestore();
  });

  it('warns when a tool call without id or name is dropped at finish', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    feedChunk({
      choices: [
        {
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { arguments: '{}' } }] },
          finish_reason: 'tool_calls',
        },
      ],
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped a tool call'));
    warn.mockRestore();
  });
});
```

If the test file uses Bun's test API, import `spyOn` from `bun:test` instead of `vi` and use `spyOn(console, 'warn')`. `feedChunk` stands for whatever the file already uses to push one parsed payload through `parseChunk`; if no such helper exists, write it locally in this `describe` from the adapter's `parseChunk(payload, state)` signature.

- [ ] **Step 3: Run to verify they fail**

Run: `cd packages/llm-unified && bun test src/adapters/mistral-openai.test.ts`
Expected: the two new tests FAIL (no warn called).

- [ ] **Step 4: Implement the warnings**

In `foldDeltaContent`, replace the trailing comment branch:

```ts
    } else {
      // Tool calls arrive on delta.tool_calls, never inline in content, so an
      // unknown item type is something new from upstream — surface it.
      console.warn(`[mistral] ignored unknown delta.content item type: ${String(item.type)}`);
    }
```

In the finish handler:

```ts
        for (const acc of Object.values(pending)) {
          if (acc.id && acc.name) {
            events.push({ type: 'tool-call', toolCallId: acc.id, name: acc.name, argumentsJson: acc.args });
          } else {
            console.warn(
              `[mistral] dropped a tool call lacking ${acc.id ? 'a name' : 'an id'} (args ${acc.args.length} chars)`,
            );
          }
        }
```

- [ ] **Step 5: Write the adapter history-serialisation tests**

For each of `ollama-native.test.ts`, `anthropic-claude.test.ts`, `claude-openrouter.test.ts` and `mistral-openai.test.ts`, add one test using the file's existing way of building the adapter and calling `buildRequest`:

```ts
const REPLAYED_HISTORY: WireMessage[] = [
  { role: 'system', content: 'You are helpful.' },
  { role: 'user', content: 'Draw a fox.' },
  {
    role: 'assistant',
    content: '',
    tool_calls: [
      { id: 'k3F9aZ1qP', type: 'function', function: { name: 'generate_image', arguments: '{"prompt":"a fox"}' } },
    ],
  },
  { role: 'tool', tool_call_id: 'k3F9aZ1qP', content: 'Generated 1 image(s).' },
  { role: 'assistant', content: 'Here is your fox.' },
  { role: 'user', content: 'Thanks! Another one?' },
];

it('serialises a replayed tool exchange in the middle of the history', () => {
  const wire = adapter.buildRequest({ messages: REPLAYED_HISTORY, bodyExtras: {} /* match the file's CanonicalRequest shape */ });
  const body = wire.body as { messages: Array<Record<string, unknown>> };
  expect(body.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant', 'user']);
  const call = body.messages[2];
  expect(JSON.stringify(call)).toContain('k3F9aZ1qP');
  expect(JSON.stringify(call)).toContain('generate_image');
  expect(body.messages[3]?.tool_call_id).toBe('k3F9aZ1qP');
});
```

Adapter-specific expectations:
- `ollama-native`: `tool_calls[0].function.arguments` is the parsed object `{ prompt: 'a fox' }` (not a string). Assert that explicitly.
- `anthropic-claude` / `claude-openrouter`: if `cache_control` is applied, it must not be attached to the `tool` message or to the empty-content assistant message in a way that changes `content` to an array with an empty text part. Assert `body.messages[2]?.content` is either `''` or an array without an empty `text` part. If the existing cache code violates this, fix it in `_anthropic-cache.ts` (skip messages whose content is the empty string) and add that to this task's commit.

- [ ] **Step 6: Run the package tests**

Run: `cd packages/llm-unified && bun test`
Expected: all PASS.

- [ ] **Step 7: Build and typecheck**

Run: `pnpm --filter @chatsundere/llm-unified build && pnpm typecheck --force`
Expected: success.

- [ ] **Step 8: Commit**

```bash
git add packages/llm-unified/src
git commit -m "Add orphanReplay profile field and surface Mistral silent drops

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 2: user-client — tool-call-aware `wireTokens` and group-safe `truncateToWindow`

**Files:**
- Modify: `apps/user-client/src/lib/context-window.ts:29-60`
- Test: `apps/user-client/tests/lib/context-window.test.ts`

**Interfaces:**
- Produces: `TOOL_CALL_OVERHEAD_TOKENS = 10` (exported); `wireTokens(m: WireMessage): number` now also counts `tool_calls`.

- [ ] **Step 1: Write failing tests**

Append to `tests/lib/context-window.test.ts` (add `TOOL_CALL_OVERHEAD_TOKENS` and `wireTokens` to the import):

```ts
describe('wireTokens with tool calls', () => {
  it('counts tool-call names, arguments and a per-call overhead', () => {
    const m: WireMessage = {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'a', type: 'function', function: { name: 'generate_image', arguments: '{"prompt":"a fox"}' } },
      ],
    };
    // 'generate_image' + '{"prompt":"a fox"}' = 14 + 18 = 32 chars → 8 tokens.
    expect(wireTokens(m)).toBe(8 + TOOL_CALL_OVERHEAD_TOKENS);
  });

  it('is unchanged for a plain text message', () => {
    expect(wireTokens({ role: 'user', content: 'abcdefgh' })).toBe(2);
  });
});

describe('truncateToWindow keeps tool groups intact', () => {
  it('drops the tool messages of a dropped assistant tool call', () => {
    const big = 'x'.repeat(400); // 100 tokens
    const messages: WireMessage[] = [
      { role: 'system', content: 'sys' },
      {
        role: 'assistant',
        content: big,
        tool_calls: [{ id: 'a', type: 'function', function: { name: 't', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'a', content: 'ok' },
      { role: 'assistant', content: 'after' },
      { role: 'user', content: 'now' },
    ];
    const { messages: out, trimmed } = truncateToWindow(messages, 20);
    expect(out.map((m) => m.role)).toEqual(['system', 'assistant', 'user']);
    expect(out[1]?.content).toBe('after');
    expect(trimmed).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/lib/context-window.test.ts`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

Replace `wireTokens` and extend `truncateToWindow` in `context-window.ts`:

```ts
/** Approximate wire framing of one tool call plus its answering `tool` message. */
export const TOOL_CALL_OVERHEAD_TOKENS = 10;

/** Estimated tokens of one wire message, including any tool calls it carries. */
export function wireTokens(m: WireMessage): number {
  const content = estimateTokens(typeof m.content === 'string' ? m.content : '');
  const calls = (m.tool_calls ?? []).reduce(
    (s, c) => s + estimateTokens(c.function.name + c.function.arguments) + TOOL_CALL_OVERHEAD_TOKENS,
    0,
  );
  return content + calls;
}
```

In `truncateToWindow`, after the existing `while` loop and before the `return`:

```ts
  // A `tool` message whose assistant(tool_calls) was dropped is an orphan that
  // providers reject, so it goes with the call it answered.
  while (start < history.length) {
    const head = history[start];
    if (head === undefined || head.role !== 'tool') break;
    total -= wireTokens(head);
    start += 1;
  }
```

Update the doc comment of `truncateToWindow` with one sentence: "Leading `tool` messages left without their assistant call are dropped too."

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/lib/context-window.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/context-window.ts apps/user-client/tests/lib/context-window.test.ts
git commit -m "Count tool calls in wire tokens and keep tool groups whole on truncation

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 3: user-client — the pure `tool-replay` module

**Files:**
- Create: `apps/user-client/src/lib/tool-replay.ts`
- Test: `apps/user-client/tests/lib/tool-replay.test.ts`

**Interfaces:**
- Consumes: `wireTokens` from `lib/context-window.ts` (Task 2); `MessageRow`, `PillRow` from `boot/client-data-db.ts`; `flattenAnswerText` from `lib/content-blocks.ts`.
- Produces:
  - `REPLAY_RESULT_MAX_CHARS: 2000`, `INTERRUPTED_RESULT: string`
  - `interface ReplayPolicy { toolsSupported: boolean; orphanReplay: boolean; activeToolNames: ReadonlySet<string> }`
  - `interface ReplayContext { pillsById: ReadonlyMap<string, PillRow>; policy: ReplayPolicy }`
  - `truncateReplayResult(text: string): string`
  - `replayCallId(pillId: string, salt?: number): string`
  - `createIdMinter(idFor?: (pillId: string, salt: number) => string): (pillId: string) => string`
  - `textOnlyWireMessage(m: MessageRow): WireMessage`
  - `replayHistory(rows: MessageRow[], ctx: ReplayContext | undefined): WireMessage[]`
  - `estimateReplayTokens(row: MessageRow, pillsById: ReadonlyMap<string, PillRow>): number`
  - `toolTranscriptRefs(row: MessageRow, pillsById: ReadonlyMap<string, PillRow>): string[]`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/tool-replay.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { WireMessage } from '@chatsundere/llm-unified';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentBlock, MessageRow, PillRow } from '../../src/boot/client-data-db.js';
import { flattenAnswerText } from '../../src/lib/content-blocks.js';
import { wireTokens } from '../../src/lib/context-window.js';
import {
  INTERRUPTED_RESULT,
  REPLAY_RESULT_MAX_CHARS,
  type ReplayContext,
  createIdMinter,
  estimateReplayTokens,
  replayCallId,
  replayHistory,
  textOnlyWireMessage,
  toolTranscriptRefs,
  truncateReplayResult,
} from '../../src/lib/tool-replay.js';

// Full, realistic rows — never text-only stubs (a stub once hid a pill-loss CRITICAL).
function msg(id: string, role: MessageRow['role'], contentBlocks: ContentBlock[]): MessageRow {
  return {
    id,
    chatId: 'chat-1',
    role,
    contentBlocks,
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
    bookmarked: false,
    streamingState: 'complete',
  };
}

function toolPill(
  id: string,
  name: string,
  opts: { status?: PillRow['status']; result?: string; error?: string; args?: string } = {},
): PillRow {
  return {
    id,
    messageId: 'm-p',
    kind: 'tool-call',
    positionHint: 'inline',
    status: opts.status ?? 'completed',
    payload: {
      name,
      argumentsJson: opts.args ?? '{"prompt":"a red fox in fresh snow"}',
      toolCallId: `provider-original-${id}`,
      result: opts.result ?? 'Generated 1 image(s) from your prompt.',
      error: opts.error,
      artefactIds: ['art-1'],
    },
    createdAt: 1_760_000_000_000,
  };
}

const IMAGE_RESULT_PILL: PillRow = {
  id: 'p-img',
  messageId: 'm-p',
  kind: 'image-result',
  positionHint: 'above-text',
  status: 'completed',
  payload: { artefactId: 'art-1' },
  createdAt: 1_760_000_000_000,
};

function ctx(pills: PillRow[], policy: Partial<ReplayContext['policy']> = {}): ReplayContext {
  return {
    pillsById: new Map(pills.map((p) => [p.id, p])),
    policy: {
      toolsSupported: true,
      orphanReplay: false,
      activeToolNames: new Set(['generate_image', 'write_memory', 'ask_expert']),
      ...policy,
    },
  };
}

const ID = /^[A-Za-z0-9]{9}$/;

afterEach(() => vi.restoreAllMocks());

describe('replayCallId / createIdMinter', () => {
  it('yields 9 alphanumeric characters, stable per pill id', () => {
    const a = replayCallId('0192f5c0-aaaa-7bbb-8ccc-000000000001');
    expect(a).toMatch(ID);
    expect(replayCallId('0192f5c0-aaaa-7bbb-8ccc-000000000001')).toBe(a);
    expect(replayCallId('0192f5c0-aaaa-7bbb-8ccc-000000000002')).not.toBe(a);
  });

  it('re-hashes with a salt on collision within one request', () => {
    const idFor = (pillId: string, salt: number): string => (salt === 0 ? 'AAAAAAAAA' : replayCallId(pillId, salt));
    const mint = createIdMinter(idFor);
    expect(mint('p1')).toBe('AAAAAAAAA');
    const second = mint('p2');
    expect(second).not.toBe('AAAAAAAAA');
    expect(second).toBe(replayCallId('p2', 1));
  });
});

describe('truncateReplayResult', () => {
  it('leaves a result at the limit untouched', () => {
    const s = 'a'.repeat(REPLAY_RESULT_MAX_CHARS);
    expect(truncateReplayResult(s)).toBe(s);
  });
  it('keeps the head and names the omitted count above the limit', () => {
    const s = 'a'.repeat(REPLAY_RESULT_MAX_CHARS + 5);
    expect(truncateReplayResult(s)).toBe(`${'a'.repeat(REPLAY_RESULT_MAX_CHARS)}[… 5 characters omitted from history]`);
  });
});

describe('replayHistory', () => {
  it('is byte-identical to the text-only builder for a tool-free chat', () => {
    const rows = [
      msg('m1', 'user', [{ type: 'text', text: 'Hello' }]),
      msg('m2', 'persona', [{ type: 'reasoning', text: 'think' }, { type: 'text', text: 'Hi there!' }]),
      msg('m3', 'system', [{ type: 'text', text: 'note' }]),
    ];
    const expected = rows.map(textOnlyWireMessage);
    expect(JSON.stringify(replayHistory(rows, ctx([])))).toBe(JSON.stringify(expected));
    expect(JSON.stringify(replayHistory(rows, undefined))).toBe(JSON.stringify(expected));
  });

  it('splits a message into a tool round and a closing answer, parallel calls in one assistant', () => {
    const a = toolPill('pA', 'generate_image');
    const b = toolPill('pB', 'write_memory', { result: 'Saved to memory.', args: '{"text":"likes foxes"}' });
    const row = msg('m-p', 'persona', [
      { type: 'text', text: 'One moment…' },
      { type: 'pill', pillId: 'pA' },
      { type: 'pill', pillId: 'pB' },
      { type: 'pill', pillId: 'p-img' },
      { type: 'text', text: 'Here they are!' },
    ]);
    const out = replayHistory([row], ctx([a, b, IMAGE_RESULT_PILL]));
    expect(out.map((m) => m.role)).toEqual(['assistant', 'tool', 'tool', 'assistant']);
    const call = out[0] as WireMessage;
    expect(call.content).toBe('One moment…');
    expect(call.tool_calls?.map((t) => t.function.name)).toEqual(['generate_image', 'write_memory']);
    expect(call.tool_calls?.[0]?.function.arguments).toBe('{"prompt":"a red fox in fresh snow"}');
    for (const t of call.tool_calls ?? []) expect(t.id).toMatch(ID);
    expect(out[1]?.tool_call_id).toBe(call.tool_calls?.[0]?.id);
    expect(out[2]?.tool_call_id).toBe(call.tool_calls?.[1]?.id);
    expect(out[1]?.content).toBe('Generated 1 image(s) from your prompt.');
    expect(out[3]).toEqual({ role: 'assistant', content: 'Here they are!' });
    // The provider's original id is never replayed.
    expect(JSON.stringify(out)).not.toContain('provider-original');
  });

  it('produces the same ids on every call (prompt-cache stability)', () => {
    const row = msg('m-p', 'persona', [{ type: 'pill', pillId: 'pA' }, { type: 'text', text: 'Done.' }]);
    const c = ctx([toolPill('pA', 'generate_image')]);
    expect(JSON.stringify(replayHistory([row], c))).toBe(JSON.stringify(replayHistory([row], c)));
  });

  it('a reasoning block between rounds splits them into separate assistant calls', () => {
    const row = msg('m-p', 'persona', [
      { type: 'pill', pillId: 'pA' },
      { type: 'reasoning', text: 'now the second one' },
      { type: 'pill', pillId: 'pB' },
      { type: 'text', text: 'Both done.' },
    ]);
    const out = replayHistory([row], ctx([toolPill('pA', 'generate_image'), toolPill('pB', 'generate_image')]));
    expect(out.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant', 'tool', 'assistant']);
    expect(out[0]?.tool_calls).toHaveLength(1);
    expect(out[2]?.tool_calls).toHaveLength(1);
  });

  it('replays a failed call with its error and a pending call as interrupted', () => {
    const row = msg('m-p', 'persona', [
      { type: 'pill', pillId: 'pF' },
      { type: 'pill', pillId: 'pP' },
      { type: 'text', text: 'Sorry.' },
    ]);
    const out = replayHistory(
      [row],
      ctx([
        toolPill('pF', 'ask_expert', { status: 'failed', error: 'The expert returned no answer.', result: undefined }),
        toolPill('pP', 'generate_image', { status: 'pending', result: undefined }),
      ]),
    );
    expect(out[1]?.content).toBe('The expert returned no answer.');
    expect(out[2]?.content).toBe(INTERRUPTED_RESULT);
  });

  it('truncates a long result', () => {
    const long = 'e'.repeat(REPLAY_RESULT_MAX_CHARS + 100);
    const row = msg('m-p', 'persona', [{ type: 'pill', pillId: 'pE' }, { type: 'text', text: 'Summary.' }]);
    const out = replayHistory([row], ctx([toolPill('pE', 'ask_expert', { result: long })]));
    expect(out[1]?.content).toBe(truncateReplayResult(long));
  });

  it('omits an empty closing assistant when the message ends on a tool round', () => {
    const row = msg('m-p', 'persona', [{ type: 'text', text: 'Drawing…' }, { type: 'pill', pillId: 'pA' }]);
    const out = replayHistory([row], ctx([toolPill('pA', 'generate_image')]));
    expect(out.map((m) => m.role)).toEqual(['assistant', 'tool']);
  });

  it('falls back to text-only when a pill row is missing, warning once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const row = msg('m-p', 'persona', [
      { type: 'text', text: 'Before ' },
      { type: 'pill', pillId: 'gone' },
      { type: 'pill', pillId: 'gone-too' },
      { type: 'text', text: 'after' },
    ]);
    const out = replayHistory([row], ctx([]));
    expect(out).toEqual([{ role: 'assistant', content: 'Before after' }]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('replays text-only when the offering has no tool support', () => {
    const row = msg('m-p', 'persona', [{ type: 'pill', pillId: 'pA' }, { type: 'text', text: 'Done.' }]);
    const out = replayHistory([row], ctx([toolPill('pA', 'generate_image')], { toolsSupported: false }));
    expect(out).toEqual([{ role: 'assistant', content: 'Done.' }]);
  });

  it('orphaned tool: text-only without orphanReplay, structured with it', () => {
    const row = msg('m-p', 'persona', [{ type: 'pill', pillId: 'pM' }, { type: 'text', text: 'Fetched.' }]);
    const pills = [toolPill('pM', 'mcp__weather__forecast', { result: 'Sunny.' })];
    expect(replayHistory([row], ctx(pills))).toEqual([{ role: 'assistant', content: 'Fetched.' }]);
    expect(replayHistory([row], ctx(pills, { orphanReplay: true })).map((m) => m.role)).toEqual([
      'assistant',
      'tool',
      'assistant',
    ]);
  });

  it('a partially orphaned parallel round falls back as a whole', () => {
    const row = msg('m-p', 'persona', [
      { type: 'pill', pillId: 'pA' },
      { type: 'pill', pillId: 'pM' },
      { type: 'text', text: 'Both.' },
    ]);
    const out = replayHistory([row], ctx([toolPill('pA', 'generate_image'), toolPill('pM', 'mcp__gone__x')]));
    expect(out).toEqual([{ role: 'assistant', content: 'Both.' }]);
  });

  it('ids are unique across messages within one request', () => {
    const r1 = msg('m1', 'persona', [{ type: 'pill', pillId: 'pA' }, { type: 'text', text: 'one' }]);
    const r2 = msg('m2', 'persona', [{ type: 'pill', pillId: 'pB' }, { type: 'text', text: 'two' }]);
    const out = replayHistory([r1, r2], ctx([toolPill('pA', 'generate_image'), toolPill('pB', 'generate_image')]));
    const ids = out.flatMap((m) => m.tool_calls ?? []).map((t) => t.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('estimateReplayTokens', () => {
  it('equals the estimate over the structurally replayed wire messages (parity)', () => {
    const row = msg('m-p', 'persona', [
      { type: 'text', text: 'One moment…' },
      { type: 'pill', pillId: 'pA' },
      { type: 'text', text: 'Here it is!' },
    ]);
    const pills = [toolPill('pA', 'mcp__not__active', { result: 'r'.repeat(5000) })];
    const wire = replayHistory([row], ctx(pills, { orphanReplay: true }));
    const expected = wire.reduce((s, m) => s + wireTokens(m), 0);
    expect(estimateReplayTokens(row, new Map(pills.map((p) => [p.id, p])))).toBe(expected);
  });

  it('equals the plain text estimate for a tool-free message and never warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const row = msg('m-p', 'persona', [{ type: 'text', text: 'abcdefgh' }, { type: 'pill', pillId: 'missing' }]);
    expect(estimateReplayTokens(row, new Map())).toBe(Math.ceil(flattenAnswerText(row.contentBlocks).length / 4));
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('toolTranscriptRefs', () => {
  it('renders tool calls as fact lines and keeps other refs', () => {
    const row = msg('m-p', 'persona', [
      { type: 'reasoning', text: 'hm' },
      { type: 'pill', pillId: 'pA' },
      { type: 'pill', pillId: 'pF' },
      { type: 'pill', pillId: 'pP' },
      { type: 'pill', pillId: 'p-img' },
      { type: 'text', text: 'Done.' },
    ]);
    const pills = [
      toolPill('pA', 'generate_image', { args: '{"prompt":"a fox in snow"}' }),
      toolPill('pF', 'ask_expert', { status: 'failed', error: 'The expert returned no answer.', args: '{"question":"q"}' }),
      toolPill('pP', 'generate_image', { status: 'pending', args: '{"prompt":"x"}' }),
      IMAGE_RESULT_PILL,
    ];
    expect(toolTranscriptRefs(row, new Map(pills.map((p) => [p.id, p])))).toEqual([
      'reasoning',
      'tool generate_image {"prompt":"a fox in snow"} → Generated 1 image(s) from your prompt.',
      'tool ask_expert {"question":"q"} → failed: The expert returned no answer.',
      'tool generate_image {"prompt":"x"} → interrupted',
      'pill',
    ]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/lib/tool-replay.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the module**

Create `apps/user-client/src/lib/tool-replay.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { WireMessage, WireToolCall } from '@chatsundere/llm-unified';
import type { MessageRow, PillRow } from '../boot/client-data-db.js';
import { flattenAnswerText } from './content-blocks.js';
import { wireTokens } from './context-window.js';
import { estimateTokens } from './token-estimator.js';

/** Upper bound on one replayed tool result; the head is kept (spec §4). */
export const REPLAY_RESULT_MAX_CHARS = 2000;

/** Result replayed for a call whose stream ended before it produced one. */
export const INTERRUPTED_RESULT = 'The call was interrupted before it completed.';

const FAILED_FALLBACK = 'The tool call failed.';

/** Which recorded tool rounds may go on the wire structurally (spec §5.2). */
export interface ReplayPolicy {
  toolsSupported: boolean;
  orphanReplay: boolean;
  activeToolNames: ReadonlySet<string>;
}

/** Everything the replay needs beyond the message rows themselves. */
export interface ReplayContext {
  pillsById: ReadonlyMap<string, PillRow>;
  policy: ReplayPolicy;
}

/** Estimation counts every recorded round structurally — the upper bound. */
const PERMISSIVE: ReplayPolicy = { toolsSupported: true, orphanReplay: true, activeToolNames: new Set() };

interface ToolCallPayload {
  name: string;
  argumentsJson: string;
  result?: unknown;
  error?: unknown;
}

function payloadOf(pill: PillRow): ToolCallPayload {
  return pill.payload as ToolCallPayload;
}

/** Cap a replayed tool result at REPLAY_RESULT_MAX_CHARS, naming what was cut. */
export function truncateReplayResult(text: string): string {
  if (text.length <= REPLAY_RESULT_MAX_CHARS) return text;
  const omitted = text.length - REPLAY_RESULT_MAX_CHARS;
  return `${text.slice(0, REPLAY_RESULT_MAX_CHARS)}[… ${omitted} characters omitted from history]`;
}

function resultText(pill: PillRow): string {
  const p = payloadOf(pill);
  if (pill.status === 'pending') return INTERRUPTED_RESULT;
  if (pill.status === 'failed') {
    return truncateReplayResult(typeof p.error === 'string' && p.error ? p.error : FAILED_FALLBACK);
  }
  return truncateReplayResult(typeof p.result === 'string' ? p.result : '');
}

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function fnv1a(input: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Deterministic, provider-neutral tool-call id for a replayed pill: 9 characters
 * of [A-Za-z0-9]. Deterministic so the same history yields the same bytes on
 * every request (prompt cache); never the provider's original id, which a
 * different provider may reject after a mid-chat model switch (Mistral does).
 */
export function replayCallId(pillId: string, salt = 0): string {
  const key = salt === 0 ? pillId : `${pillId}#${salt}`;
  let a = fnv1a(key, 0);
  let b = fnv1a(key, 0x9e3779b9);
  let out = '';
  for (let i = 0; i < 9; i++) {
    if (i < 5) {
      out += ID_ALPHABET.charAt(a % 62);
      a = Math.floor(a / 62);
    } else {
      out += ID_ALPHABET.charAt(b % 62);
      b = Math.floor(b / 62);
    }
  }
  return out;
}

/** An id source unique within one request: a collision re-hashes with a salt. */
export function createIdMinter(
  idFor: (pillId: string, salt: number) => string = replayCallId,
): (pillId: string) => string {
  const used = new Set<string>();
  return (pillId) => {
    let salt = 0;
    let id = idFor(pillId, salt);
    while (used.has(id)) {
      salt += 1;
      id = idFor(pillId, salt);
    }
    used.add(id);
    return id;
  };
}

/** The pre-replay mapping: one message, text only. Kept for tool-free rows. */
export function textOnlyWireMessage(m: MessageRow): WireMessage {
  const text = flattenAnswerText(m.contentBlocks);
  if (m.role === 'persona') return { role: 'assistant', content: text };
  if (m.role === 'system') return { role: 'system', content: text };
  return { role: 'user', content: text };
}

type Segment = { kind: 'text'; text: string } | { kind: 'run'; pills: PillRow[] };

/** Walk a persona message once into text segments and maximal tool-call runs.
 *  A reasoning block ends a run: it marks the start of a later loop round. */
function segment(row: MessageRow, pillsById: ReadonlyMap<string, PillRow>): {
  segments: Segment[];
  missing: boolean;
} {
  const segments: Segment[] = [];
  let missing = false;
  for (const b of row.contentBlocks) {
    const last = segments.at(-1);
    if (b.type === 'text') {
      if (last?.kind === 'text') last.text += b.text;
      else segments.push({ kind: 'text', text: b.text });
    } else if (b.type === 'reasoning') {
      if (last?.kind === 'run') segments.push({ kind: 'text', text: '' });
    } else {
      const pill = pillsById.get(b.pillId);
      if (!pill) {
        missing = true;
        continue;
      }
      if (pill.kind !== 'tool-call') continue;
      if (last?.kind === 'run') last.pills.push(pill);
      else segments.push({ kind: 'run', pills: [pill] });
    }
  }
  return { segments, missing };
}

function structured(pills: PillRow[], policy: ReplayPolicy): boolean {
  if (!policy.toolsSupported) return false;
  if (policy.orphanReplay) return true;
  // A partly orphaned parallel round falls back whole: splitting it would
  // fabricate a history that never happened.
  return pills.every((p) => policy.activeToolNames.has(payloadOf(p).name));
}

function replayPersona(
  row: MessageRow,
  ctx: ReplayContext,
  mint: (pillId: string) => string,
  warnOnMissing: boolean,
): WireMessage[] {
  const { segments, missing } = segment(row, ctx.pillsById);
  if (missing && warnOnMissing) {
    console.warn(`[tool-replay] message ${row.id}: a pill row is missing; replaying without it`);
  }
  const out: WireMessage[] = [];
  let text = '';
  let endedOnRun = false;
  for (const s of segments) {
    if (s.kind === 'text') {
      text += s.text;
      if (s.text !== '') endedOnRun = false;
      continue;
    }
    // Text-only fallback: the round vanishes and its text keeps accumulating,
    // exactly as the pre-replay builder did.
    if (!structured(s.pills, ctx.policy)) continue;
    const calls: WireToolCall[] = s.pills.map((p) => ({
      id: mint(p.id),
      type: 'function',
      function: { name: payloadOf(p).name, arguments: payloadOf(p).argumentsJson },
    }));
    out.push({ role: 'assistant', content: text, tool_calls: calls });
    s.pills.forEach((p, i) => {
      const call = calls[i];
      if (call) out.push({ role: 'tool', tool_call_id: call.id, content: resultText(p) });
    });
    text = '';
    endedOnRun = true;
  }
  if (text !== '' || !endedOnRun) out.push({ role: 'assistant', content: text });
  return out;
}

/**
 * Replay prior context messages for the wire. Persona messages with recorded
 * tool rounds expand into assistant(tool_calls) + tool messages (spec §3);
 * everything else maps 1:1 as before. Without a context, text only.
 */
export function replayHistory(rows: MessageRow[], ctx: ReplayContext | undefined): WireMessage[] {
  if (!ctx) return rows.map(textOnlyWireMessage);
  const mint = createIdMinter();
  return rows.flatMap((r) => (r.role === 'persona' ? replayPersona(r, ctx, mint, true) : [textOnlyWireMessage(r)]));
}

/** Estimated tokens one message costs on the wire once replayed (spec §6.1).
 *  Built on the same decomposition as the replay, so counter and wire agree. */
export function estimateReplayTokens(row: MessageRow, pillsById: ReadonlyMap<string, PillRow>): number {
  if (row.role !== 'persona') return estimateTokens(flattenAnswerText(row.contentBlocks));
  return replayPersona(row, { pillsById, policy: PERMISSIVE }, createIdMinter(), false).reduce(
    (s, m) => s + wireTokens(m),
    0,
  );
}

/** Compaction transcript hints for one message: a readable fact line per tool
 *  call, the block type for everything else that is not text (spec §6.2). */
export function toolTranscriptRefs(row: MessageRow, pillsById: ReadonlyMap<string, PillRow>): string[] {
  const refs: string[] = [];
  for (const b of row.contentBlocks) {
    if (b.type === 'text') continue;
    if (b.type === 'reasoning') {
      refs.push('reasoning');
      continue;
    }
    const pill = pillsById.get(b.pillId);
    if (!pill || pill.kind !== 'tool-call') {
      refs.push('pill');
      continue;
    }
    const p = payloadOf(pill);
    const outcome =
      pill.status === 'pending'
        ? 'interrupted'
        : pill.status === 'failed'
          ? `failed: ${resultText(pill)}`
          : resultText(pill);
    refs.push(`tool ${p.name} ${p.argumentsJson} → ${outcome}`);
  }
  return refs;
}
```

Note on the missing-pill test: the expected output `Before after` relies on the text segments merging across the skipped pills — `segment` merges consecutive text because skipped pills push nothing.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/lib/tool-replay.test.ts`
Expected: PASS. If the `estimateReplayTokens` tool-free test fails because `wireTokens` of a single text message differs from `Math.ceil(len/4)`, the bug is in Task 2's `wireTokens`, not the test.

- [ ] **Step 5: Biome**

Run: `pnpm biome check apps/user-client/src/lib/tool-replay.ts apps/user-client/tests/lib/tool-replay.test.ts`
Expected: clean (fix formatting with `pnpm biome check --write` on those two paths).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/lib/tool-replay.ts apps/user-client/tests/lib/tool-replay.test.ts
git commit -m "Add the pure tool history replay module

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 4: user-client — wire replay into the engine and the stream manager

**Files:**
- Create: `apps/user-client/src/lib/replay-pills.ts`
- Modify: `apps/user-client/src/lib/stream-engine.ts:25`, `:28-64` (`StartStreamArgs`), `:120-125`, `:237-270`
- Modify: `apps/user-client/src/state/stream-manager.store.ts:384-395` and `:916` / `:956-970`
- Test: `apps/user-client/tests/unit/stream-engine.test.ts`, `apps/user-client/tests/unit/stream-manager-store.test.ts`

**Interfaces:**
- Consumes: `replayHistory`, `estimateReplayTokens`, `ReplayContext` (Task 3); `ModelProfile['toolCalls'].orphanReplay` (Task 1).
- Produces:
  - `loadReplayPills(messageIds: string[]): Promise<Map<string, PillRow>>` in `lib/replay-pills.ts`
  - `buildEngineWireMessages(systemPrompt, priorMessages, userContent, toolExchange, replay?: ReplayContext)`
  - `StartStreamArgs.replay?: ReplayContext`

- [ ] **Step 1: Write failing engine tests**

Append to `tests/unit/stream-engine.test.ts` (reuse its existing imports and row helpers if present; otherwise build rows like Task 3's `msg`/`toolPill`):

```ts
describe('buildEngineWireMessages — tool history replay', () => {
  it('replays a prior tool round structurally when a replay context is given', () => {
    const pill: PillRow = {
      id: 'pA',
      messageId: 'm2',
      kind: 'tool-call',
      positionHint: 'inline',
      status: 'completed',
      payload: { name: 'generate_image', argumentsJson: '{"prompt":"fox"}', toolCallId: 'orig', result: 'Generated 1 image(s).' },
      createdAt: 1,
    };
    const prior: MessageRow[] = [
      { id: 'm1', chatId: 'c', role: 'user', contentBlocks: [{ type: 'text', text: 'Draw a fox' }], createdAt: 1, updatedAt: 1, bookmarked: false, streamingState: 'complete' },
      { id: 'm2', chatId: 'c', role: 'persona', contentBlocks: [{ type: 'pill', pillId: 'pA' }, { type: 'text', text: 'Here!' }], createdAt: 2, updatedAt: 2, bookmarked: false, streamingState: 'complete' },
    ];
    const out = buildEngineWireMessages('sys', prior, 'Another?', [], {
      pillsById: new Map([['pA', pill]]),
      policy: { toolsSupported: true, orphanReplay: false, activeToolNames: new Set(['generate_image']) },
    });
    expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant', 'user']);
  });

  it('stays text-only without a replay context', () => {
    const prior: MessageRow[] = [
      { id: 'm2', chatId: 'c', role: 'persona', contentBlocks: [{ type: 'pill', pillId: 'pA' }, { type: 'text', text: 'Here!' }], createdAt: 2, updatedAt: 2, bookmarked: false, streamingState: 'complete' },
    ];
    const out = buildEngineWireMessages('sys', prior, 'Another?', []);
    expect(out).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'assistant', content: 'Here!' },
      { role: 'user', content: 'Another?' },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify the first fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/unit/stream-engine.test.ts`
Expected: the structured test FAILS (5th param ignored / wrong roles).

- [ ] **Step 3: Implement the engine change**

In `stream-engine.ts`:
- Import `{ type ReplayContext, replayHistory } from './tool-replay.js'`.
- Add to `StartStreamArgs` after `toolExchange`:

```ts
  /** Pills + policy for replaying prior tool rounds structurally (spec §3/§5).
   *  Absent ⇒ history replays as text only (opener, background jobs). */
  replay?: ReplayContext;
```

- Pass `args.replay` as the 5th argument of `buildEngineWireMessages` at line ~120.
- Replace `buildEngineWireMessages` and delete `toWireMessage`:

```ts
/**
 * Assemble the wire message list for one engine pass: system prompt, replayed
 * history, the active user turn, then any accumulated tool exchange from prior
 * loop rounds. Prior persona turns replay their recorded tool rounds as
 * assistant(tool_calls) + tool messages when a replay context is given (see
 * `tool-replay.ts`); prior-turn attachments are still not replayed.
 */
export function buildEngineWireMessages(
  systemPrompt: string,
  priorMessages: MessageRow[],
  userContent: string | WireContentPart[],
  toolExchange: WireMessage[],
  replay?: ReplayContext,
): WireMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    ...replayHistory(priorMessages.filter(isContextMessage), replay),
    { role: 'user', content: userContent },
    ...toolExchange,
  ];
}
```

- Remove `flattenAnswerText` from the `content-blocks` import only if it becomes unused (it is still used by `resolveOpenerContext` — keep it).

- [ ] **Step 4: Create the pill loader**

`apps/user-client/src/lib/replay-pills.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { type PillRow, getClientDataDb } from '../boot/client-data-db.js';

/** Load the pills of the given messages in one indexed query, keyed by pill id. */
export async function loadReplayPills(messageIds: string[]): Promise<Map<string, PillRow>> {
  if (messageIds.length === 0) return new Map();
  const rows = await getClientDataDb().pills.where('messageId').anyOf(messageIds).toArray();
  return new Map(rows.map((p) => [p.id, p]));
}
```

- [ ] **Step 5: Wire the stream manager**

In `state/stream-manager.store.ts`:
- Import `loadReplayPills` and `{ estimateReplayTokens, type ReplayContext }`.
- Overflow projection (lines ~387-395):

```ts
    const projected = await applyActiveCompaction(args.chat, args.priorMessages, '');
    const projectedPills = await loadReplayPills(projected.priorMessages.map((m) => m.id));
    const projectedUsed =
      projected.priorMessages.reduce((sum, m) => sum + estimateReplayTokens(m, projectedPills), 0) +
      estimateTokens(projected.memoryContext) +
      estimateTokens(args.userText);
```

- In `runIntoDraft`, right after `const compacted = await applyActiveCompaction(...)` (line ~916), and after `activeToolDefs` is known:

```ts
  // The forced-answer pass sends no tools, but the policy uses the turn's
  // active set: the live exchange already carries those calls (spec §5.2).
  const replay: ReplayContext = {
    pillsById: await loadReplayPills(compacted.priorMessages.map((m) => m.id)),
    policy: {
      toolsSupported: toolsActive,
      orphanReplay: args.offering.profile.toolCalls.orphanReplay ?? false,
      activeToolNames: new Set(activeToolDefs.map((d) => d.name)),
    },
  };
```

- Add `replay,` to the `runStreamEngine({...})` argument object inside `streamOnce`.
- Remove the now-unused `flattenAnswerText` import from the store only if Biome reports it unused.
- Update the NOTE comment above `resolveUserContent` (line ~640-647): replace "(which currently flattens history to text-only)" with "(which replays prior tool rounds but not prior attachments)".

- [ ] **Step 6: Add a stream-manager test for the policy wiring**

In `tests/unit/stream-manager-store.test.ts`, follow the file's existing pattern for capturing what `runStreamEngine` receives (it mocks `../../src/lib/stream-engine.js` or captures args — read the file). Add one test: with an offering whose `profile.toolCalls` is `{ supported: true, ..., orphanReplay: true }`, a prior persona message with a `tool-call` pill seeded in the fake Dexie, start a send and assert the captured `replay` has `policy.orphanReplay === true`, `policy.toolsSupported === true`, and `pillsById.has(<that pill id>)`. A second assertion with `orphanReplay` absent expects `false`.

- [ ] **Step 7: Run the touched suites, then the full user-client suite**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/unit/stream-engine.test.ts tests/unit/stream-manager-store.test.ts tests/unit/stream-engine-multimodal.test.ts tests/lib/stream-engine-opener.test.ts`
Expected: PASS.
Run: `pnpm --filter @chatsundere/user-client test`
Expected: everything passes except the known Node-localStorage baseline of exactly 8 failures; a 9th is real — investigate (`stream-manager-store` is a known flake: re-run it in isolation before concluding).

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm typecheck --force`
Expected: success.

```bash
git add apps/user-client/src/lib/stream-engine.ts apps/user-client/src/lib/replay-pills.ts apps/user-client/src/state/stream-manager.store.ts apps/user-client/tests/unit/stream-engine.test.ts apps/user-client/tests/unit/stream-manager-store.test.ts
git commit -m "Replay prior tool rounds structurally on every chat send

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 5: user-client — compaction transcript, compaction estimates, context meters

**Files:**
- Modify: `apps/user-client/src/compaction/runner.ts:54-66`, `:120-160`
- Modify: `apps/user-client/src/compaction/compaction-prompt.ts:9-19`, `:60-61`
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx:426-434`
- Modify: `apps/user-client/src/components/chat/ChatStream.tsx:136-144`
- Test: `apps/user-client/tests/compaction/runner.test.ts`, `apps/user-client/tests/compaction/compaction-prompt.test.ts`

**Interfaces:**
- Consumes: `estimateReplayTokens`, `toolTranscriptRefs` (Task 3); `loadReplayPills` (Task 4).
- Produces: `messageToSource(row: MessageRow, pillsById: ReadonlyMap<string, PillRow>): SourceMessage`.

- [ ] **Step 1: Write failing tests**

In `tests/compaction/runner.test.ts` add (adapt row construction to the file's helpers):

```ts
describe('messageToSource with tool calls', () => {
  it('turns tool-call pills into readable fact refs', () => {
    const pill: PillRow = {
      id: 'pA', messageId: 'm', kind: 'tool-call', positionHint: 'inline', status: 'completed',
      payload: { name: 'generate_image', argumentsJson: '{"prompt":"a fox in snow"}', toolCallId: 'o', result: 'Generated 1 image(s).' },
      createdAt: 1,
    };
    const row: MessageRow = {
      id: 'm', chatId: 'c', role: 'persona',
      contentBlocks: [{ type: 'pill', pillId: 'pA' }, { type: 'text', text: 'Here you go.' }],
      createdAt: 1, updatedAt: 1, bookmarked: false, streamingState: 'complete',
    };
    expect(messageToSource(row, new Map([['pA', pill]]))).toEqual({
      role: 'persona',
      text: 'Here you go.',
      refs: ['tool generate_image {"prompt":"a fox in snow"} → Generated 1 image(s).'],
    });
  });
});
```

In `tests/compaction/compaction-prompt.test.ts` add:

```ts
it('instructs the summariser to record tool calls as facts', () => {
  expect(COMPACTION_SYSTEM_PROMPT).toContain('[tool NAME ARGS → RESULT]');
  expect(COMPACTION_SYSTEM_PROMPT).toContain('Established Facts');
});
```

If an existing test asserts the prompt verbatim (snapshot or `toBe`), update that expectation in this task.

Also update every existing call of `messageToSource(row)` in `tests/compaction/*.ts` to `messageToSource(row, new Map())`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/compaction`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement compaction changes**

`runner.ts`:

```ts
/** Map a stored message to a transcript source line: text via the shared
 *  flattener; tool calls become readable fact refs, other non-text blocks
 *  plain type hints (`toolTranscriptRefs`). */
export function messageToSource(row: MessageRow, pillsById: ReadonlyMap<string, PillRow>): SourceMessage {
  return {
    role: row.role === 'user' ? 'user' : 'persona',
    text: flattenAnswerText(row.contentBlocks),
    refs: toolTranscriptRefs(row, pillsById),
  };
}
```

In `runCompaction`, after `if (all.length === 0) return null;`:

```ts
  const pillsById = await loadReplayPills(all.map((m) => m.id));
  const tokenOf = (m: MessageRow): number => estimateReplayTokens(m, pillsById);
```

Replace the three `estimateTokens(flattenAnswerText(m.contentBlocks))` sites (`tokens`, the source-truncation guard, `tokensBefore`) with `tokenOf(m)`, and `sourceSlice.map(messageToSource)` with `sourceSlice.map((m) => messageToSource(m, pillsById))`. Fix imports (`PillRow` type, `loadReplayPills`, `estimateReplayTokens`, `toolTranscriptRefs`); drop unused ones.

`compaction-prompt.ts` — add to "Output rules" after the "Do not invent information" line:

```
- Lines carrying "[tool NAME ARGS → RESULT]" record real tool calls the assistant made. Record each as a fact under Established Facts (e.g. "the assistant generated an image of a fox in snow with the image tool"). Never describe a tool's output as though the assistant had written it in prose.
```

and change the `buildCompactionTranscript` doc comment to: "Build the transcript fed to the summariser. Tool calls arrive as readable refs (`toolTranscriptRefs`); full tool output never does." Also update the `COMPACTION_SYSTEM_PROMPT` doc comment from "Ported verbatim from chatsune (spec §4.3)." to "Ported from chatsune (spec §4.3), plus the tool-fact rule (tool history replay spec §6.2)."

- [ ] **Step 4: Implement the meters**

`chat-page.tsx` (lines ~426-434):

```tsx
    // Openers never reach the wire (isContextMessage), so they don't count here.
    // Tool rounds count as they are replayed (estimateReplayTokens), so the
    // gauge reads what the wire sends.
    const pillsById = new Map((chatQuery.data?.pills ?? []).map((p) => [p.id, p]));
    const historyTokens = (chatQuery.data?.messages ?? [])
      .filter(isContextMessage)
      .reduce((s, m) => s + estimateReplayTokens(m, pillsById), 0);
    const systemTokens = estimateTokens(sys);
    return { usedTokens: systemTokens + historyTokens, systemTokens };
  }, [offering, effectivePersona, settingsQuery.data, chatQuery.data?.messages, chatQuery.data?.pills]);
```

`ChatStream.tsx` (line ~140): `sorted.map((m) => estimateReplayTokens(m, pillMap))`. Drop now-unused imports.

- [ ] **Step 5: Meter test**

In `tests/compaction/interaction-topbar-gauge.test.tsx` or the nearest existing test that renders the chat page gauge, add: a chat with one persona message containing a `tool-call` pill whose result is 4000 characters shows a higher used-token figure than the same chat without the pill. If no existing test renders `chat-page.tsx`'s gauge, instead add a unit assertion in `tests/lib/tool-replay.test.ts`: `estimateReplayTokens` of that message exceeds the text-only estimate by at least `Math.ceil(REPLAY_RESULT_MAX_CHARS / 4)` (the result is capped) — and note in your report which option you used.

- [ ] **Step 6: Run tests, full suite, typecheck**

Run: `pnpm --filter @chatsundere/user-client exec vitest run tests/compaction tests/lib`
Expected: PASS.
Run: `pnpm --filter @chatsundere/user-client test` — baseline of exactly 8 known failures.
Run: `pnpm typecheck --force` — success.

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/compaction apps/user-client/src/routes/app/chat/chat-page.tsx apps/user-client/src/components/chat/ChatStream.tsx apps/user-client/tests
git commit -m "Count replayed tool rounds in compaction and the context gauge

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 6: llm-unified curation — replay scenarios and the live probe script

**Files:**
- Create: `packages/llm-unified/curation/conversation-suite/scenarios/tool-replay.ts`
- Modify: `packages/llm-unified/curation/conversation-suite/index.ts`
- Create: `packages/llm-unified/curation/run-tool-replay-suite.ts`
- Test: `packages/llm-unified/curation/conversation-suite/runner.test.ts`

The scenarios live in their own file rather than in `core.ts` (deviation from spec §5.3, approved by Liz): `orphan-tool-replay` needs a binding without tools and is informational, so it must not count against `core`'s pass/fail.

**Interfaces:**
- Produces: `toolReplayScenario: ConversationScenario`, `orphanReplayScenario: ConversationScenario`, `REPLAYED_TOOL_HISTORY: WireMessage[]`.

- [ ] **Step 1: Write the failing runner test**

In `runner.test.ts`, using its existing fake-binding pattern:

```ts
describe('tool replay scenarios', () => {
  it('replayed-tool-history passes when the model calls the tool from a replayed history', async () => {
    const seen: WireMessage[][] = [];
    const binding: RunnerBinding = {
      offeringRef: 'fake:model',
      async runTurn(messages) {
        seen.push(messages);
        return assembleOutcome(200, [
          { type: 'tool-call', toolCallId: 'call1', name: 'generate_image', argumentsJson: '{"prompt":"a lighthouse at dusk"}' },
          { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
          { type: 'finish', reason: 'tool_calls' },
        ]);
      },
      toolResultFor: (c) => ({ role: 'tool', tool_call_id: c.id, content: '{"ok":true}' }),
    };
    const run = await runSuite(toolReplayScenario, [{ label: 'default', intent: { enabled: false } }], binding);
    const results = run.permutations[0]?.turns[0]?.results ?? [];
    expect(results.every((r) => r.status === 'pass')).toBe(true);
    // The replayed exchange is on the wire before the new user turn.
    expect(seen[0]?.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'user']);
  });

  it('replayed-tool-history fails when the model answers in prose', async () => {
    const binding: RunnerBinding = {
      offeringRef: 'fake:model',
      async runTurn() {
        return assembleOutcome(200, [{ type: 'token', text: 'Here is a lighthouse glowing at dusk…' }]);
      },
      toolResultFor: (c) => ({ role: 'tool', tool_call_id: c.id, content: '{"ok":true}' }),
    };
    const run = await runSuite(toolReplayScenario, [{ label: 'default', intent: { enabled: false } }], binding);
    const results = run.permutations[0]?.turns[0]?.results ?? [];
    expect(results.find((r) => r.assertion === 'tool-call-fired:generate_image')?.status).toBe('fail');
  });
});
```

Match the `NormalisedUsage` shape in `src/types.ts` exactly (read it; adjust the usage literal's field names if they differ).

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/llm-unified && bun test curation/conversation-suite/runner.test.ts`
Expected: FAIL (scenario not exported).

- [ ] **Step 3: Implement the scenarios**

`scenarios/tool-replay.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { WireMessage } from '../../../src/types.js';
import {
  assertNoHttpError,
  assertNoStreamError,
  assertNotToolShaped,
  assertTextPresent,
  assertToolArgsValidJson,
  assertToolCallFired,
} from '../assertions.js';
import type { ConversationScenario } from '../scenario.js';

/**
 * A history exactly as the client replays it (tool history replay spec §3): an
 * earlier generate_image round with a provider-neutral 9-character id, its
 * result, and the persona's prose answer.
 */
export const REPLAYED_TOOL_HISTORY: WireMessage[] = [
  { role: 'user', content: 'Please create an image of a red fox in the snow.' },
  {
    role: 'assistant',
    content: '',
    tool_calls: [
      {
        id: 'k3F9aZ1qP',
        type: 'function',
        function: { name: 'generate_image', arguments: '{"prompt":"a red fox standing in fresh snow"}' },
      },
    ],
  },
  {
    role: 'tool',
    tool_call_id: 'k3F9aZ1qP',
    content:
      'Generated 1 image(s) from your prompt. They are already displayed to the user — refer to them in prose; do not output URLs, file paths, or markdown images.',
  },
  { role: 'assistant', content: 'Here is your fox in the snow — I hope you like its winter coat!' },
];

/**
 * Gate: after a replayed tool round, a DIRECT instruction must produce a real
 * call on the tool channel. Directness keeps this a pipe check (design D8): a
 * working pipe always yields the call, and a poisoned history is precisely what
 * makes a model answer in prose instead (Mistral Large 4, 2026-10-07).
 */
export const toolReplayScenario: ConversationScenario = {
  id: 'tool-replay',
  description: 'A replayed tool round in history; the model must still call the tool.',
  turns: [
    {
      id: 'replayed-tool-history',
      send: [
        ...REPLAYED_TOOL_HISTORY,
        { role: 'user', content: 'Now call generate_image again with the prompt "a lighthouse at dusk".' },
      ],
      expectToolCall: 'generate_image',
      assertions: [
        assertNoHttpError,
        assertNoStreamError,
        assertToolCallFired('generate_image'),
        assertToolArgsValidJson('generate_image'),
        assertNotToolShaped,
      ],
    },
  ],
};

/**
 * Informational, not a gate: run with a binding that offers NO tools. A 2xx
 * plus a text reply means the provider accepts orphaned replayed calls
 * (`toolCalls.orphanReplay: true`); an HTTP 400 means it does not (keep false).
 */
export const orphanReplayScenario: ConversationScenario = {
  id: 'orphan-tool-replay',
  description: 'Replayed tool round whose tool is absent from the request (sets orphanReplay).',
  turns: [
    {
      id: 'orphan-tool-replay',
      send: [
        ...REPLAYED_TOOL_HISTORY,
        { role: 'user', content: 'In one short sentence: what did you make for me earlier?' },
      ],
      assertions: [assertNoHttpError, assertNoStreamError, assertTextPresent],
    },
  ],
};
```

`index.ts`: add `export { REPLAYED_TOOL_HISTORY, orphanReplayScenario, toolReplayScenario } from './scenarios/tool-replay.js';`

- [ ] **Step 4: Write the live probe script**

`curation/run-tool-replay-suite.ts` (never run in CI; it reads `keys/`):

```ts
// SPDX-License-Identifier: LGPL-3.0-only
//
// Live verification for tool history replay (spec 2026-10-08 §5.5). Run via the
// /curate skill, NEVER in CI — it reads keys/. For each target it runs:
//   - tool-replay (gate): with tools, the model must call generate_image from a
//     replayed history;
//   - orphan-tool-replay (informational): WITHOUT tools; PASS ⇒ set
//     `toolCalls.orphanReplay: true` on that offering, an HTTP 400 ⇒ keep false.
// Run targets ONE AT A TIME and read every report in full.
//
//   bun run curation/run-tool-replay-suite.ts                 (all targets, serially)
//   bun run curation/run-tool-replay-suite.ts nano-gpt        (provider-id filter)
//   bun run curation/run-tool-replay-suite.ts nano-gpt claude (provider-id + slug substring)
import { readFileSync } from 'node:fs';
import type { ToolDef } from '../src/adapter-contract.js';
import { getAdapter } from '../src/adapter-registry.js';
import type { Offering } from '../src/catalogue/types.js';
import { chutes } from '../src/providers/chutes.js';
import { mistral } from '../src/providers/mistral.js';
import { nanoGpt } from '../src/providers/nano-gpt.js';
import { novita } from '../src/providers/novita.js';
import { ollamaCloud } from '../src/providers/ollama-cloud.js';
import { openrouter } from '../src/providers/openrouter.js';
import { registerBuiltinProviders } from '../src/providers/_register-builtins.js';
import { tensorix } from '../src/providers/tensorix.js';
import { wafer } from '../src/providers/wafer.js';
import type { ProviderDefinition } from '../src/types.js';
import {
  makeLiveBinding,
  orphanReplayScenario,
  permutationsForReasoning,
  renderSuiteReport,
  runSuite,
  toolReplayScenario,
} from './conversation-suite/index.js';

registerBuiltinProviders();

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

// One representative per provider, plus Claude on nano-gpt (an Anthropic
// backend behind an OpenAI surface — the strictest about tool history).
// xAI is not listed: there is no keys/.xai-test-key.
const TARGETS: { provider: ProviderDefinition; keyFile: string; slug: string }[] = [
  { provider: mistral, keyFile: '.mistral-test-key', slug: 'mistral-large-4' },
  { provider: nanoGpt, keyFile: '.nano-test-key', slug: 'mistralai/mistral-large-4' },
  { provider: nanoGpt, keyFile: '.nano-test-key', slug: 'claude-haiku-4-5-20251001' },
  { provider: chutes, keyFile: '.chutes-test-key', slug: 'zai-org/GLM-5.2-TEE' },
  { provider: novita, keyFile: '.novita-test-key', slug: 'moonshotai/kimi-k2.6' },
  { provider: ollamaCloud, keyFile: '.ollama-test-key', slug: 'glm-5.2:cloud' },
  { provider: openrouter, keyFile: '.or-test-key', slug: 'anthropic/claude-sonnet-5' },
  { provider: tensorix, keyFile: '.tensorix-test-key', slug: 'z-ai/glm-5.2' },
  { provider: wafer, keyFile: '.wafer-test-key', slug: 'GLM-5.2' },
];

function readKey(file: string): string {
  return readFileSync(new URL(`../../../keys/${file}`, import.meta.url), 'utf8').trim();
}

const providerFilter = process.argv[2];
const slugFilter = process.argv[3]?.toLowerCase();

for (const t of TARGETS) {
  if (providerFilter && !t.provider.id.includes(providerFilter)) continue;
  if (slugFilter && !t.slug.toLowerCase().includes(slugFilter)) continue;
  const offering = (t.provider.offerings as Offering[]).find((o) => o.upstreamSlug === t.slug);
  if (!offering) throw new Error(`No offering ${t.provider.id}:${t.slug}`);
  if (offering.adapter.kind !== 'catalogue') throw new Error(`${t.slug} has no catalogue adapter`);
  const adapter = getAdapter(offering.adapter.adapterId);
  if (!adapter) throw new Error(`Adapter ${offering.adapter.adapterId} not registered`);

  const ref = `${t.provider.id}:${t.slug}`;
  const common = {
    offeringRef: ref,
    providerConfig: { baseUrl: t.provider.baseUrl, routing: { kind: 'direct' as const } },
    apiKey: readKey(t.keyFile),
    adapter,
  };
  // One permutation the offering actually supports; reasoning is orthogonal here.
  const perm = permutationsForReasoning(offering.profile.reasoning).slice(0, 1);

  console.log(`\n${'='.repeat(72)}\nOFFERING ${ref}\n${'='.repeat(72)}`);
  console.log(renderSuiteReport(await runSuite(toolReplayScenario, perm, makeLiveBinding({ ...common, tools }))));
  console.log(renderSuiteReport(await runSuite(orphanReplayScenario, perm, makeLiveBinding(common))));
}

console.log('\nDONE.');
```

Before committing, verify against the source: the `ProviderDefinition` fields used (`id`, `baseUrl`, `offerings`), the `routing` shape of `ProviderConfig`, the `registerBuiltinProviders` export name, and every slug in `TARGETS` (each must match an `upstreamSlug` exactly — `bun run` the script with a bogus provider filter like `zzz` to load all modules without network calls, then fix any import error). Do NOT run the live targets — Liz runs them in Task 7.

- [ ] **Step 5: Run tests, typecheck, Biome**

Run: `cd packages/llm-unified && bun test && cd ../.. && pnpm typecheck --force && pnpm biome check packages/llm-unified/curation`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/llm-unified/curation
git commit -m "Add tool replay suite scenarios and live probe script

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 7 (Liz, not a subagent): live probes, catalogue flags, Curation Records, `/curate` step

Live probes cost money and must be read in full, one at a time — Liz runs them herself.

- [ ] **Step 1:** For each of the nine targets, serially: `cd packages/llm-unified && bun run curation/run-tool-replay-suite.ts <provider> <slug-substring>`. Read both reports in full. Record per target: `tool-replay` PASS/FAIL (with the detail), `orphan-tool-replay` PASS or the HTTP status + body.
- [ ] **Step 2:** A `tool-replay` FAIL is a real defect: stop, invoke systematic-debugging, and fix before continuing (do not mark the feature done).
- [ ] **Step 3:** For every target whose `orphan-tool-replay` passed, set `orphanReplay: true` in that offering's `toolCalls` profile in `packages/llm-unified/src/providers/<provider>.ts`. Only the probed offerings get the flag — other offerings on the same provider may route to a different upstream backend; they stay `false` until their next curation pass. Rebuild the package and run `bun test` (catalogue tests may pin profiles).
- [ ] **Step 4:** Add a dated "Tool history replay (2026-10-08)" section to each probed model's Curation Record in `obsidian/models/` (both outcomes, verbatim error for a 400).
- [ ] **Step 5:** In `.claude/skills/curate/references/conversation-suite.md` and `model-curation.md`, add the mandatory step "Determine `orphanReplay`: run `curation/run-tool-replay-suite.ts` (or add the offering to its TARGETS), record both scenario outcomes in the Curation Record, set `toolCalls.orphanReplay: true` only on PASS."
- [ ] **Step 6:** Commit: `Record tool replay probes and orphanReplay flags` (code + docs → no `[skip ci]`).

### Task 8 (Liz): gate, Larissa, squash

- [ ] **Step 1:** In the worktree: `pnpm --filter @chatsundere/llm-unified build`, `pnpm typecheck --force` (expect 0 cached), `pnpm run build`, full user-client Vitest (exactly 8 baseline failures), `cd packages/llm-unified && bun test`, Biome clean.
- [ ] **Step 2:** Summon Larissa with absolute worktree paths: the diff, spec §7, the question whether `tool`-role + 2000-char truncation suffices against persistent MCP prompt injection. Fix or log deferrals in `obsidian/insights/security-deferrals.md`.
- [ ] **Step 3:** Squash to one commit `Replay tool history structurally to stop history poisoning` via a throwaway master worktree; verify file count and diff against the branch; scan staged names for leaked scratch reports; typecheck on master.
- [ ] **Step 4:** Update `obsidian/STATUS-CLIENT-ONLY.md` (Current + Next: Chris's §10 device checks), mark the follow-up row in `obsidian/insights/follow-ups-index.md` as done, commit `[skip ci]` after the squash.
