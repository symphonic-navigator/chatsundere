# Third-Party Chat Import (ChatGPT & Grok) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client-only "Import chats from ChatGPT or Grok…" control in the persona hub that parses a ChatGPT export (`.zip` or raw `conversations.json`) or a Grok export (`.json`) in a Web Worker, lets the user select conversations, and writes them into the persona's history as ordinary synced chats.

**Architecture:** Two pure parsers (`chatgpt.ts`, `grok.ts`) emit a shared intermediate format; a content-based detector (`parse-export.ts`, zip via fflate) dispatches to them inside a dedicated Web Worker so parsing is cancellable; a writer (`data/third-party-import.ts`) mirrors the proven `importChatsuneSessions` pattern (Dexie tx, `importedFrom` idempotency, `enqueueSync`); one overlay component hosts the pick → select → import flow.

**Tech Stack:** TypeScript strict, React 18, Dexie, TanStack Query, fflate (new), Vitest + fake-indexeddb, Tailwind classes matching the cs-dialog convention.

**Spec:** `superpowers/specs/2026-07-18-third-party-chat-import-design.md` — read it before starting; it is the authority on flow, copy, and edge cases.

## Global Constraints

- Every artefact is **British English** (code, comments, copy, commit messages).
- Every new source file starts with `// SPDX-License-Identifier: AGPL-3.0-only`.
- TypeScript `strict: true` + `noUncheckedIndexedAccess: true`; **Biome bans non-null assertions (`!`)** — never write one.
- No `any` without an inline comment explaining why.
- Every package-public function carries at least a one-line JSDoc.
- **No Dexie version bump** — no stores or indexes change; touch `client-data-db.ts` for nothing.
- Mobile-first: the overlay must hold at **380 px**; single `lg` breakpoint.
- UI copy verbatim from the spec (§3, §9) — do not paraphrase.
- Execution happens in a dedicated worktree (`.claude/worktrees/third-party-import`, branch `feat/third-party-import`); the main tree stays on `master`. **Subagents never merge, push, or switch branches.**
- Commit style: free-form imperative subject + `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`.
- Run tests from `apps/user-client/`: `pnpm vitest run <path>`.
- The repo-wide gate is `pnpm typecheck --force` (from the repo root) — run it in Task 8, not per task.

---

### Task 1: Shared types and timestamp helpers

**Files:**
- Create: `apps/user-client/src/lib/third-party-import/types.ts`
- Create: `apps/user-client/src/lib/third-party-import/time.ts`
- Test: `apps/user-client/tests/unit/third-party-time.test.ts`

**Interfaces:**
- Consumes: `DroppedCounts` from `src/lib/chatsune-import/dropped-hint.js` (existing: `{ images, toolCalls, attachments, artefacts, knowledgeLookups }`, all numbers).
- Produces: all types below, plus `chatGptSecondsToMs(v: unknown): number | null`, `parseGrokTimestamp(v: unknown): number | null`, `zeroDropped(): DroppedCounts`, `isRecord(v: unknown): v is Record<string, unknown>`. Later tasks import exactly these names.

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/tests/unit/third-party-time.test.ts
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  chatGptSecondsToMs,
  parseGrokTimestamp,
} from '../../src/lib/third-party-import/time.js';

describe('chatGptSecondsToMs', () => {
  it('converts float unix seconds to ms', () => {
    expect(chatGptSecondsToMs(1721300000.5)).toBe(1721300000500);
  });
  it('returns null for non-numbers', () => {
    expect(chatGptSecondsToMs('1721300000')).toBeNull();
    expect(chatGptSecondsToMs(null)).toBeNull();
    expect(chatGptSecondsToMs(Number.NaN)).toBeNull();
  });
});

describe('parseGrokTimestamp', () => {
  it('accepts epoch milliseconds as a number', () => {
    expect(parseGrokTimestamp(1721300000000)).toBe(1721300000000);
  });
  it('accepts ISO-8601 strings', () => {
    expect(parseGrokTimestamp('2026-07-18T12:00:00.000Z')).toBe(
      Date.parse('2026-07-18T12:00:00.000Z'),
    );
  });
  it('accepts numeric strings as epoch ms', () => {
    expect(parseGrokTimestamp('1721300000000')).toBe(1721300000000);
  });
  it('accepts Mongo $date string notation', () => {
    expect(parseGrokTimestamp({ $date: '2026-07-18T12:00:00.000Z' })).toBe(
      Date.parse('2026-07-18T12:00:00.000Z'),
    );
  });
  it('accepts Mongo $date/$numberLong notation', () => {
    expect(parseGrokTimestamp({ $date: { $numberLong: '1721300000000' } })).toBe(1721300000000);
    expect(parseGrokTimestamp({ $date: { $numberLong: 1721300000000 } })).toBe(1721300000000);
  });
  it('returns null for garbage', () => {
    expect(parseGrokTimestamp(undefined)).toBeNull();
    expect(parseGrokTimestamp('not a date')).toBeNull();
    expect(parseGrokTimestamp({})).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/unit/third-party-time.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/third-party-import/time.js`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/user-client/src/lib/third-party-import/types.ts
// SPDX-License-Identifier: AGPL-3.0-only

import type { DroppedCounts } from '../chatsune-import/dropped-hint.js';

export type ThirdPartySource = 'chatgpt' | 'grok';

export interface ThirdPartyBlock {
  type: 'text' | 'reasoning';
  text: string;
}

export interface ThirdPartyMessage {
  role: 'user' | 'persona';
  /** Epoch ms; 0 when the source carried no usable timestamp (writer synthesises order). */
  createdAt: number;
  blocks: ThirdPartyBlock[];
  /** What this message lost on import; all-zero when nothing was dropped. */
  dropped: DroppedCounts;
}

export interface ThirdPartyConversation {
  /** Namespaced dedup key: "chatgpt/<id>" | "grok/<id>" (spec §7). */
  sourceId: string;
  source: ThirdPartySource;
  title: string | null;
  createdAt: number;
  lastMessageAt: number;
  /** Linear (flattened) order; empty ⇒ "Nothing importable" in the UI. */
  messages: ThirdPartyMessage[];
}

/** A conversation the parser could not process; listed disabled in the UI (spec §9). */
export interface FailedConversation {
  title: string | null;
  reason: string;
}

export interface ParseResult {
  source: ThirdPartySource;
  conversations: ThirdPartyConversation[];
  failures: FailedConversation[];
}

/** Runtime type guard shared by both parsers. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** A fresh all-zero DroppedCounts. */
export function zeroDropped(): DroppedCounts {
  return { images: 0, toolCalls: 0, attachments: 0, artefacts: 0, knowledgeLookups: 0 };
}
```

```ts
// apps/user-client/src/lib/third-party-import/time.ts
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from './types.js';

/** ChatGPT exports stamp unix seconds (float) — convert to epoch ms, or null. */
export function chatGptSecondsToMs(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) : null;
}

/**
 * Grok timestamps appear as epoch ms, ISO-8601 strings, numeric strings, or
 * MongoDB `$date` notation (spec §6). Returns epoch ms, or null.
 */
export function parseGrokTimestamp(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof v === 'string') {
    const iso = Date.parse(v);
    if (Number.isFinite(iso)) return iso;
    const n = Number(v);
    return v.trim() !== '' && Number.isFinite(n) ? Math.round(n) : null;
  }
  if (isRecord(v) && '$date' in v) {
    const inner = v.$date;
    if (typeof inner === 'string') return parseGrokTimestamp(inner);
    if (isRecord(inner) && '$numberLong' in inner) {
      const raw = inner.$numberLong;
      if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
      if (typeof raw === 'string') {
        const n = Number(raw);
        return Number.isFinite(n) ? Math.round(n) : null;
      }
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/unit/third-party-time.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/third-party-import/ apps/user-client/tests/unit/third-party-time.test.ts
git commit -m "Add third-party import shared types and timestamp helpers"
```

---

### Task 2: ChatGPT parser

**Files:**
- Create: `apps/user-client/src/lib/third-party-import/chatgpt.ts`
- Test: `apps/user-client/tests/unit/third-party-chatgpt.test.ts`

**Interfaces:**
- Consumes: `chatGptSecondsToMs` (Task 1), `isRecord`, `zeroDropped`, and the Task 1 types.
- Produces: `parseChatGptExport(raw: unknown): ParseResult`. Throws `TypeError('not a ChatGPT export')` when `raw` is not an array. Task 4 calls exactly this.

**Parsing rules (spec §5 — port of chatsune's `_parser.py`):**
- Linearise: walk the parent chain from `current_node` to the root (visited-set cycle guard; skip nodes without a `message`), then reverse. Dead branches are never visited.
- Keep a message iff `author.role ∈ {user, assistant}` AND `status ∈ {null/undefined, 'finished_successfully'}` AND `content.content_type ∈ {'text', 'user_editable_context'}` AND NOT `metadata.is_visually_hidden_from_conversation === true` (exception: `user_editable_context` is kept even when hidden).
- `user_editable_context` → synthetic first user message from `content.user_profile` / `content.user_instructions` as `[User Profile]` / `[Custom Instructions]` blocks, stamped 1000 ms before the conversation `create_time`.
- Text = the string entries of `content.parts` joined with `\n\n`, trimmed; non-string parts count as dropped images.
- Non-keepable non-hidden messages contribute to dropped counts: content types containing `image` → `images`, role `tool` → `toolCalls`, everything else non-text → `attachments`. Accumulated counts attach to the **next kept message** (leftovers to the last kept message; a conversation with no kept messages simply ends up with `messages: []`).
- Conversation id: `conversation_id ?? id`; missing both, or missing/non-record `mapping` → a `FailedConversation` with reason `'Unreadable conversation structure'`.
- Timestamps: conversation `create_time`/`update_time` and message `create_time` via `chatGptSecondsToMs`, falling back to 0.

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/tests/unit/third-party-chatgpt.test.ts
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { parseChatGptExport } from '../../src/lib/third-party-import/chatgpt.js';

/** Minimal node builder for the mapping graph. */
function node(
  id: string,
  parent: string | null,
  message: Record<string, unknown> | null,
): [string, Record<string, unknown>] {
  return [id, { id, parent, message }];
}

function msg(
  role: string,
  parts: unknown[],
  opts: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    author: { role },
    status: 'finished_successfully',
    create_time: 1721300000,
    content: { content_type: 'text', parts },
    ...opts,
  };
}

/** A branched conversation: root → u1 → a1 (dead) / a2 (regenerated, current). */
const BRANCHED = {
  conversation_id: 'conv-1',
  title: 'Branched',
  create_time: 1721300000,
  update_time: 1721303600,
  current_node: 'a2',
  mapping: Object.fromEntries([
    node('root', null, null),
    node('u1', 'root', msg('user', ['hello'])),
    node('a1', 'u1', msg('assistant', ['dead branch answer'])),
    node('a2', 'u1', msg('assistant', ['regenerated answer'])),
  ]),
};

describe('parseChatGptExport', () => {
  it('rejects non-arrays', () => {
    expect(() => parseChatGptExport({})).toThrow('not a ChatGPT export');
  });

  it('flattens to the current_node branch only', () => {
    const r = parseChatGptExport([BRANCHED]);
    expect(r.source).toBe('chatgpt');
    expect(r.failures).toEqual([]);
    expect(r.conversations).toHaveLength(1);
    const conv = r.conversations[0];
    expect(conv?.sourceId).toBe('chatgpt/conv-1');
    expect(conv?.title).toBe('Branched');
    expect(conv?.createdAt).toBe(1721300000000);
    expect(conv?.lastMessageAt).toBe(1721303600000);
    const texts = conv?.messages.map((m) => m.blocks.map((b) => b.text).join('|'));
    expect(texts).toEqual(['hello', 'regenerated answer']);
    expect(conv?.messages.map((m) => m.role)).toEqual(['user', 'persona']);
  });

  it('drops system/tool/hidden and counts non-text as dropped on the next kept message', () => {
    const r = parseChatGptExport([
      {
        conversation_id: 'conv-2',
        title: 'Filtered',
        create_time: 1721300000,
        update_time: 1721300100,
        current_node: 'a1',
        mapping: Object.fromEntries([
          node('root', null, null),
          node('sys', 'root', msg('system', ['system prompt'])),
          node(
            'hidden',
            'sys',
            msg('user', ['hidden'], { metadata: { is_visually_hidden_from_conversation: true } }),
          ),
          node('img', 'hidden', {
            author: { role: 'user' },
            status: 'finished_successfully',
            content: { content_type: 'multimodal_text', parts: [{ content_type: 'image_asset_pointer' }, 'look at this'] },
          }),
          node('u1', 'img', msg('user', ['real question'])),
          node('a1', 'u1', msg('assistant', ['answer'])),
        ]),
      },
    ]);
    const conv = r.conversations[0];
    expect(conv?.messages).toHaveLength(2);
    expect(conv?.messages[0]?.blocks[0]?.text).toBe('real question');
    // system + hidden + the multimodal message were dropped; the image counts.
    expect(conv?.messages[0]?.dropped.images).toBe(1);
    expect(conv?.messages[1]?.dropped.images).toBe(0);
  });

  it('turns user_editable_context into a synthetic first user message', () => {
    const r = parseChatGptExport([
      {
        conversation_id: 'conv-3',
        title: 'Context',
        create_time: 1721300000,
        update_time: 1721300100,
        current_node: 'a1',
        mapping: Object.fromEntries([
          node('root', null, null),
          node('ctx', 'root', {
            author: { role: 'user' },
            status: null,
            metadata: { is_visually_hidden_from_conversation: true },
            content: {
              content_type: 'user_editable_context',
              user_profile: 'I am Chris.',
              user_instructions: 'Be concise.',
            },
          }),
          node('u1', 'ctx', msg('user', ['hi'])),
          node('a1', 'u1', msg('assistant', ['hello'])),
        ]),
      },
    ]);
    const conv = r.conversations[0];
    expect(conv?.messages).toHaveLength(3);
    const first = conv?.messages[0];
    expect(first?.role).toBe('user');
    expect(first?.blocks[0]?.text).toContain('[User Profile]');
    expect(first?.blocks[0]?.text).toContain('I am Chris.');
    expect(first?.blocks[0]?.text).toContain('[Custom Instructions]');
    expect(first?.blocks[0]?.text).toContain('Be concise.');
    expect(first?.createdAt).toBe(1721300000000 - 1000);
  });

  it('survives a mapping cycle without hanging', () => {
    const r = parseChatGptExport([
      {
        conversation_id: 'conv-4',
        title: 'Cycle',
        create_time: 1721300000,
        update_time: 1721300100,
        current_node: 'b',
        mapping: Object.fromEntries([
          node('a', 'b', msg('user', ['a'])),
          node('b', 'a', msg('assistant', ['b'])),
        ]),
      },
    ]);
    expect(r.conversations).toHaveLength(1);
    expect(r.conversations[0]?.messages.length).toBe(2);
  });

  it('reports an unreadable conversation as a failure, not a crash', () => {
    const r = parseChatGptExport([{ title: 'Broken', mapping: 'nonsense' }, BRANCHED]);
    expect(r.failures).toEqual([{ title: 'Broken', reason: 'Unreadable conversation structure' }]);
    expect(r.conversations).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/unit/third-party-chatgpt.test.ts`
Expected: FAIL — cannot resolve `chatgpt.js`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/user-client/src/lib/third-party-import/chatgpt.ts
// SPDX-License-Identifier: AGPL-3.0-only

import type { DroppedCounts } from '../chatsune-import/dropped-hint.js';
import { chatGptSecondsToMs } from './time.js';
import {
  type FailedConversation,
  type ParseResult,
  type ThirdPartyConversation,
  type ThirdPartyMessage,
  isRecord,
  zeroDropped,
} from './types.js';

const KEEPABLE_ROLES = new Set(['user', 'assistant']);
const KEEPABLE_STATUS = new Set([null, undefined, 'finished_successfully']);

function addDropped(into: DroppedCounts, from: DroppedCounts): void {
  into.images += from.images;
  into.toolCalls += from.toolCalls;
  into.attachments += from.attachments;
  into.artefacts += from.artefacts;
  into.knowledgeLookups += from.knowledgeLookups;
}

/** Walk the parent chain from current_node to the root; reverse to root→leaf. */
function linearise(
  mapping: Record<string, unknown>,
  currentNodeId: unknown,
): Record<string, unknown>[] {
  const chain: Record<string, unknown>[] = [];
  const visited = new Set<string>();
  let nodeId: unknown = currentNodeId;
  while (typeof nodeId === 'string' && nodeId !== '' && !visited.has(nodeId)) {
    visited.add(nodeId);
    const node = mapping[nodeId];
    if (!isRecord(node)) break;
    if (isRecord(node.message)) chain.push(node.message);
    nodeId = node.parent;
  }
  return chain.reverse();
}

/** String parts joined; non-string parts (image pointers etc.) count as images. */
function extractParts(parts: unknown): { text: string; droppedImages: number } {
  if (!Array.isArray(parts)) return { text: '', droppedImages: 0 };
  const texts: string[] = [];
  let droppedImages = 0;
  for (const p of parts) {
    if (typeof p === 'string') {
      if (p.trim() !== '') texts.push(p);
    } else {
      droppedImages++;
    }
  }
  return { text: texts.join('\n\n').trim(), droppedImages };
}

function syntheticContextText(content: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof content.user_profile === 'string' && content.user_profile.trim() !== '')
    parts.push(`[User Profile]\n${content.user_profile.trim()}`);
  if (typeof content.user_instructions === 'string' && content.user_instructions.trim() !== '')
    parts.push(`[Custom Instructions]\n${content.user_instructions.trim()}`);
  return parts.join('\n\n');
}

/** What a skipped message contributes to the dropped tally: its non-string
 *  parts count as images (multimodal), else the whole message counts once. */
function droppedForSkipped(role: string, contentType: string, parts: unknown): DroppedCounts {
  const d = zeroDropped();
  const { droppedImages } = extractParts(parts);
  if (droppedImages > 0) d.images = droppedImages;
  else if (contentType.includes('image')) d.images = 1;
  else if (role === 'tool') d.toolCalls = 1;
  else if (contentType !== 'text') d.attachments = 1;
  return d;
}

function parseConversation(
  raw: Record<string, unknown>,
): ThirdPartyConversation | FailedConversation {
  const title = typeof raw.title === 'string' && raw.title.trim() !== '' ? raw.title : null;
  const id =
    typeof raw.conversation_id === 'string' && raw.conversation_id !== ''
      ? raw.conversation_id
      : typeof raw.id === 'string' && raw.id !== ''
        ? raw.id
        : null;
  if (id === null || !isRecord(raw.mapping)) {
    return { title, reason: 'Unreadable conversation structure' };
  }

  const createdAt = chatGptSecondsToMs(raw.create_time) ?? 0;
  const lastMessageAt = chatGptSecondsToMs(raw.update_time) ?? createdAt;
  const messages: ThirdPartyMessage[] = [];
  const pendingDropped = zeroDropped();

  for (const m of linearise(raw.mapping, raw.current_node)) {
    const author = isRecord(m.author) ? m.author : {};
    const role = typeof author.role === 'string' ? author.role : '';
    const content = isRecord(m.content) ? m.content : {};
    const contentType = typeof content.content_type === 'string' ? content.content_type : '';
    const meta = isRecord(m.metadata) ? m.metadata : {};
    const hidden = meta.is_visually_hidden_from_conversation === true;
    const statusOk = KEEPABLE_STATUS.has(m.status as string | null | undefined);

    if (contentType === 'user_editable_context') {
      const text = syntheticContextText(content);
      if (text !== '') {
        messages.push({
          role: 'user',
          createdAt: createdAt > 0 ? createdAt - 1000 : 0,
          blocks: [{ type: 'text', text }],
          dropped: zeroDropped(),
        });
      }
      continue;
    }

    const keepable =
      KEEPABLE_ROLES.has(role) && statusOk && contentType === 'text' && !hidden;
    if (!keepable) {
      // Hidden text messages vanish silently (chatsune behaviour); everything
      // else non-keepable feeds the dropped tally for the next kept message.
      if (!hidden) addDropped(pendingDropped, droppedForSkipped(role, contentType, content.parts));
      continue;
    }

    const { text, droppedImages } = extractParts(content.parts);
    pendingDropped.images += droppedImages;
    if (text === '') continue;

    const dropped = pendingDropped;
    Object.assign(pendingDropped, zeroDropped());
    messages.push({
      role: role === 'assistant' ? 'persona' : 'user',
      createdAt: chatGptSecondsToMs(m.create_time) ?? 0,
      blocks: [{ type: 'text', text }],
      dropped: { ...dropped },
    });
  }

  // Leftover dropped counts attach to the last kept message.
  const last = messages[messages.length - 1];
  if (last) addDropped(last.dropped, pendingDropped);

  return {
    sourceId: `chatgpt/${id}`,
    source: 'chatgpt',
    title,
    createdAt,
    lastMessageAt,
    messages,
  };
}

/** Parse a ChatGPT `conversations.json` payload (top-level array) — spec §5. */
export function parseChatGptExport(raw: unknown): ParseResult {
  if (!Array.isArray(raw)) throw new TypeError('not a ChatGPT export');
  const conversations: ThirdPartyConversation[] = [];
  const failures: FailedConversation[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      failures.push({ title: null, reason: 'Unreadable conversation structure' });
      continue;
    }
    const parsed = parseConversation(item);
    if ('sourceId' in parsed) conversations.push(parsed);
    else failures.push(parsed);
  }
  return { source: 'chatgpt', conversations, failures };
}
```

Note: `Object.assign(pendingDropped, zeroDropped())` resets the accumulator in place after snapshotting it — do not replace with a reassignment; `pendingDropped` is `const`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/unit/third-party-chatgpt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/third-party-import/chatgpt.ts apps/user-client/tests/unit/third-party-chatgpt.test.ts
git commit -m "Add ChatGPT export parser for third-party chat import"
```

---

### Task 3: Grok parser

**Files:**
- Create: `apps/user-client/src/lib/third-party-import/grok.ts`
- Test: `apps/user-client/tests/unit/third-party-grok.test.ts`

**Interfaces:**
- Consumes: `parseGrokTimestamp` (Task 1), Task 1 types/helpers.
- Produces: `parseGrokExport(raw: unknown): ParseResult`. Throws `TypeError('not a Grok export')` when `raw` is not a record with a `conversations` array. Task 4 calls exactly this.

**Parsing rules (spec §6):**
- Read only `raw.conversations`; each item `{ conversation, responses }`.
- Skip responses with `partial === true`, and responses that are not records.
- Flatten: choose the non-partial response with the **newest** parsed `create_time` (ties: last wins); walk its `parent_response_id` chain to the root (cycle-guarded); reverse. Regenerated alternatives are discarded.
- Role: `sender` lower-cased `=== 'human'` → `user`; anything else → `persona`.
- Blocks: reasoning first (from `thinking_trace`, else the non-empty `agent_thinking_traces[].thinking_trace` values joined with `\n\n`), then text from `message`. A response yielding neither block is skipped.
- Dropped: non-empty `file_attachments` array → `attachments += length`; non-empty `generated_image_urls` array → `images += length`.
- Conversation id from `conversation.id`; missing → `FailedConversation` with reason `'Unreadable conversation structure'`. `sourceId = "grok/<id>"`.
- `createdAt` from `conversation.create_time`, `lastMessageAt` from `conversation.modify_time` (fallbacks: 0 / `createdAt`), both via `parseGrokTimestamp`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/tests/unit/third-party-grok.test.ts
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { parseGrokExport } from '../../src/lib/third-party-import/grok.js';

function resp(
  id: string,
  parent: string | null,
  sender: string,
  message: string,
  createTime: number,
  extra: Record<string, unknown> = {},
): { response: Record<string, unknown> } {
  return {
    response: {
      _id: id,
      parent_response_id: parent,
      sender,
      message,
      create_time: createTime,
      ...extra,
    },
  };
}

const T0 = 1721300000000;

/** Branched: u1 → a1 (old) / a2 (regenerated, newer) → u2 → a3 (newest). */
const BRANCHED = {
  conversations: [
    {
      conversation: {
        id: 'g-1',
        title: 'Branched',
        create_time: { $date: '2026-07-18T10:00:00.000Z' },
        modify_time: { $date: '2026-07-18T11:00:00.000Z' },
      },
      responses: [
        resp('u1', null, 'human', 'hello', T0),
        resp('a1', 'u1', 'ASSISTANT', 'old answer', T0 + 1000),
        resp('a2', 'u1', 'grok-4', 'regenerated answer', T0 + 2000, {
          thinking_trace: 'let me think',
        }),
        resp('u2', 'a2', 'human', 'follow-up', T0 + 3000),
        resp('a3', 'u2', 'grok-4-auto', 'newest answer', T0 + 4000),
        resp('p1', 'a3', 'grok-4', 'half-written', T0 + 5000, { partial: true }),
      ],
    },
  ],
  projects: [],
  tasks: [],
  media_posts: [],
};

describe('parseGrokExport', () => {
  it('rejects payloads without a conversations array', () => {
    expect(() => parseGrokExport({ nope: true })).toThrow('not a Grok export');
    expect(() => parseGrokExport([])).toThrow('not a Grok export');
  });

  it('flattens to the newest branch, skipping partial responses', () => {
    const r = parseGrokExport(BRANCHED);
    expect(r.source).toBe('grok');
    expect(r.failures).toEqual([]);
    const conv = r.conversations[0];
    expect(conv?.sourceId).toBe('grok/g-1');
    expect(conv?.createdAt).toBe(Date.parse('2026-07-18T10:00:00.000Z'));
    expect(conv?.lastMessageAt).toBe(Date.parse('2026-07-18T11:00:00.000Z'));
    const texts = conv?.messages.map((m) =>
      m.blocks.map((b) => `${b.type}:${b.text}`).join('|'),
    );
    expect(texts).toEqual([
      'text:hello',
      'reasoning:let me think|text:regenerated answer',
      'text:follow-up',
      'text:newest answer',
    ]);
    expect(conv?.messages.map((m) => m.role)).toEqual(['user', 'persona', 'user', 'persona']);
  });

  it('joins agent_thinking_traces into one reasoning block', () => {
    const r = parseGrokExport({
      conversations: [
        {
          conversation: { id: 'g-2', title: 'Traces', create_time: T0, modify_time: T0 },
          responses: [
            resp('u1', null, 'human', 'question', T0),
            resp('a1', 'u1', 'assistant', 'answer', T0 + 1000, {
              agent_thinking_traces: [
                { agent_id: { rollout_id: 'r1' }, thinking_trace: 'step one' },
                { agent_id: { rollout_id: 'r2' }, thinking_trace: 'step two' },
              ],
            }),
          ],
        },
      ],
    });
    const reply = r.conversations[0]?.messages[1];
    expect(reply?.blocks[0]).toEqual({ type: 'reasoning', text: 'step one\n\nstep two' });
  });

  it('counts attachments and generated images as dropped', () => {
    const r = parseGrokExport({
      conversations: [
        {
          conversation: { id: 'g-3', title: 'Media', create_time: T0, modify_time: T0 },
          responses: [
            resp('u1', null, 'human', 'look', T0, { file_attachments: [{ id: 'f1' }] }),
            resp('a1', 'u1', 'assistant', 'made you an image', T0 + 1000, {
              generated_image_urls: ['https://x.example/img.png'],
            }),
          ],
        },
      ],
    });
    expect(r.conversations[0]?.messages[0]?.dropped.attachments).toBe(1);
    expect(r.conversations[0]?.messages[1]?.dropped.images).toBe(1);
  });

  it('reports a conversation without an id as a failure', () => {
    const r = parseGrokExport({
      conversations: [{ conversation: { title: 'No id' }, responses: [] }],
    });
    expect(r.failures).toEqual([{ title: 'No id', reason: 'Unreadable conversation structure' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/unit/third-party-grok.test.ts`
Expected: FAIL — cannot resolve `grok.js`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/user-client/src/lib/third-party-import/grok.ts
// SPDX-License-Identifier: AGPL-3.0-only

import { parseGrokTimestamp } from './time.js';
import {
  type FailedConversation,
  type ParseResult,
  type ThirdPartyBlock,
  type ThirdPartyConversation,
  type ThirdPartyMessage,
  isRecord,
  zeroDropped,
} from './types.js';

interface GrokNode {
  id: string;
  parent: string | null;
  raw: Record<string, unknown>;
  createdAt: number;
}

function collectNodes(responses: unknown): GrokNode[] {
  if (!Array.isArray(responses)) return [];
  const nodes: GrokNode[] = [];
  for (const envelope of responses) {
    if (!isRecord(envelope) || !isRecord(envelope.response)) continue;
    const r = envelope.response;
    if (r.partial === true) continue;
    if (typeof r._id !== 'string' || r._id === '') continue;
    nodes.push({
      id: r._id,
      parent: typeof r.parent_response_id === 'string' ? r.parent_response_id : null,
      raw: r,
      createdAt: parseGrokTimestamp(r.create_time) ?? 0,
    });
  }
  return nodes;
}

/** Newest-branch flatten: chain from the newest response up to the root. */
function lineariseNewestBranch(nodes: GrokNode[]): GrokNode[] {
  if (nodes.length === 0) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let newest = nodes[0];
  for (const n of nodes) {
    if (newest === undefined || n.createdAt >= newest.createdAt) newest = n;
  }
  const chain: GrokNode[] = [];
  const visited = new Set<string>();
  let cursor: GrokNode | undefined = newest;
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    chain.push(cursor);
    cursor = cursor.parent !== null ? byId.get(cursor.parent) : undefined;
  }
  return chain.reverse();
}

function reasoningText(r: Record<string, unknown>): string {
  if (typeof r.thinking_trace === 'string' && r.thinking_trace.trim() !== '')
    return r.thinking_trace.trim();
  if (Array.isArray(r.agent_thinking_traces)) {
    const parts = r.agent_thinking_traces
      .map((t) => (isRecord(t) && typeof t.thinking_trace === 'string' ? t.thinking_trace.trim() : ''))
      .filter((t) => t !== '');
    return parts.join('\n\n');
  }
  return '';
}

function toMessage(node: GrokNode): ThirdPartyMessage | null {
  const r = node.raw;
  const blocks: ThirdPartyBlock[] = [];
  const reasoning = reasoningText(r);
  if (reasoning !== '') blocks.push({ type: 'reasoning', text: reasoning });
  const text = typeof r.message === 'string' ? r.message.trim() : '';
  if (text !== '') blocks.push({ type: 'text', text });
  if (blocks.length === 0) return null;

  const dropped = zeroDropped();
  if (Array.isArray(r.file_attachments)) dropped.attachments = r.file_attachments.length;
  if (Array.isArray(r.generated_image_urls)) dropped.images = r.generated_image_urls.length;

  const sender = typeof r.sender === 'string' ? r.sender.toLowerCase() : '';
  return {
    role: sender === 'human' ? 'user' : 'persona',
    createdAt: node.createdAt,
    blocks,
    dropped,
  };
}

function parseConversation(
  item: Record<string, unknown>,
): ThirdPartyConversation | FailedConversation {
  const meta = isRecord(item.conversation) ? item.conversation : {};
  const title = typeof meta.title === 'string' && meta.title.trim() !== '' ? meta.title : null;
  const id = typeof meta.id === 'string' && meta.id !== '' ? meta.id : null;
  if (id === null) return { title, reason: 'Unreadable conversation structure' };

  const createdAt = parseGrokTimestamp(meta.create_time) ?? 0;
  const lastMessageAt = parseGrokTimestamp(meta.modify_time) ?? createdAt;
  const messages: ThirdPartyMessage[] = [];
  for (const node of lineariseNewestBranch(collectNodes(item.responses))) {
    const m = toMessage(node);
    if (m) messages.push(m);
  }
  return { sourceId: `grok/${id}`, source: 'grok', title, createdAt, lastMessageAt, messages };
}

/** Parse a Grok export payload (object with a conversations array) — spec §6. */
export function parseGrokExport(raw: unknown): ParseResult {
  if (!isRecord(raw) || !Array.isArray(raw.conversations))
    throw new TypeError('not a Grok export');
  const conversations: ThirdPartyConversation[] = [];
  const failures: FailedConversation[] = [];
  for (const item of raw.conversations) {
    if (!isRecord(item)) {
      failures.push({ title: null, reason: 'Unreadable conversation structure' });
      continue;
    }
    const parsed = parseConversation(item);
    if ('sourceId' in parsed) conversations.push(parsed);
    else failures.push(parsed);
  }
  return { source: 'grok', conversations, failures };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/unit/third-party-grok.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/third-party-import/grok.ts apps/user-client/tests/unit/third-party-grok.test.ts
git commit -m "Add Grok export parser for third-party chat import"
```

---

### Task 4: Format detection with zip support (fflate)

**Files:**
- Modify: `apps/user-client/package.json` (add dependency `fflate`)
- Create: `apps/user-client/src/lib/third-party-import/parse-export.ts`
- Test: `apps/user-client/tests/unit/third-party-parse-export.test.ts`

**Interfaces:**
- Consumes: `parseChatGptExport` (Task 2), `parseGrokExport` (Task 3); `unzipSync`, `strFromU8`, `strToU8`, `zipSync` from `fflate`.
- Produces: `parseExportBytes(bytes: Uint8Array): ParseResult` and `class UnrecognisedExportError extends Error`. Task 5's worker calls exactly these.

**Detection rules (spec §4):** `PK` magic → zip → extract the sole `conversations.json` entry (any depth) and parse as ChatGPT; JSON top-level array → ChatGPT; JSON object with a `conversations` array → Grok; anything else → `UnrecognisedExportError`. An empty top-level array is a valid ChatGPT export with zero conversations.

- [ ] **Step 1: Add the dependency**

Run: `cd apps/user-client && pnpm add fflate`
Expected: `fflate` appears under `dependencies` in `apps/user-client/package.json`.

- [ ] **Step 2: Write the failing test**

```ts
// apps/user-client/tests/unit/third-party-parse-export.test.ts
// SPDX-License-Identifier: AGPL-3.0-only

import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  UnrecognisedExportError,
  parseExportBytes,
} from '../../src/lib/third-party-import/parse-export.js';

const CHATGPT_JSON = JSON.stringify([
  {
    conversation_id: 'c1',
    title: 'Zip test',
    create_time: 1721300000,
    update_time: 1721300100,
    current_node: 'a1',
    mapping: {
      root: { id: 'root', parent: null, message: null },
      u1: {
        id: 'u1',
        parent: 'root',
        message: {
          author: { role: 'user' },
          status: 'finished_successfully',
          create_time: 1721300000,
          content: { content_type: 'text', parts: ['hi'] },
        },
      },
      a1: {
        id: 'a1',
        parent: 'u1',
        message: {
          author: { role: 'assistant' },
          status: 'finished_successfully',
          create_time: 1721300050,
          content: { content_type: 'text', parts: ['hello'] },
        },
      },
    },
  },
]);

const GROK_JSON = JSON.stringify({
  conversations: [
    {
      conversation: { id: 'g1', title: 'Grok', create_time: 1721300000000, modify_time: 1721300100000 },
      responses: [
        { response: { _id: 'u1', parent_response_id: null, sender: 'human', message: 'hi', create_time: 1721300000000 } },
      ],
    },
  ],
});

describe('parseExportBytes', () => {
  it('detects a ChatGPT zip and parses conversations.json inside it', () => {
    const zipped = zipSync({ 'conversations.json': strToU8(CHATGPT_JSON), 'user.json': strToU8('{}') });
    const r = parseExportBytes(zipped);
    expect(r.source).toBe('chatgpt');
    expect(r.conversations[0]?.sourceId).toBe('chatgpt/c1');
  });

  it('finds conversations.json in a subdirectory of the zip', () => {
    const zipped = zipSync({ 'export/conversations.json': strToU8(CHATGPT_JSON) });
    expect(parseExportBytes(zipped).conversations).toHaveLength(1);
  });

  it('rejects a zip without conversations.json', () => {
    const zipped = zipSync({ 'other.json': strToU8('{}') });
    expect(() => parseExportBytes(zipped)).toThrow(UnrecognisedExportError);
  });

  it('detects raw ChatGPT conversations.json', () => {
    expect(parseExportBytes(strToU8(CHATGPT_JSON)).source).toBe('chatgpt');
  });

  it('accepts an empty ChatGPT export (zero conversations)', () => {
    const r = parseExportBytes(strToU8('[]'));
    expect(r.source).toBe('chatgpt');
    expect(r.conversations).toEqual([]);
  });

  it('detects a Grok export', () => {
    const r = parseExportBytes(strToU8(GROK_JSON));
    expect(r.source).toBe('grok');
    expect(r.conversations[0]?.sourceId).toBe('grok/g1');
  });

  it('rejects junk with UnrecognisedExportError', () => {
    expect(() => parseExportBytes(strToU8('not json at all'))).toThrow(UnrecognisedExportError);
    expect(() => parseExportBytes(strToU8('{"foo": 1}'))).toThrow(UnrecognisedExportError);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/unit/third-party-parse-export.test.ts`
Expected: FAIL — cannot resolve `parse-export.js`.

- [ ] **Step 4: Write the implementation**

```ts
// apps/user-client/src/lib/third-party-import/parse-export.ts
// SPDX-License-Identifier: AGPL-3.0-only

import { strFromU8, unzipSync } from 'fflate';
import { parseChatGptExport } from './chatgpt.js';
import { parseGrokExport } from './grok.js';
import { type ParseResult, isRecord } from './types.js';

/** The picked file is not a ChatGPT or Grok export (spec §9 copy lives in the UI). */
export class UnrecognisedExportError extends Error {}

/**
 * Content-based format detection + dispatch (spec §4): zip magic → ChatGPT zip;
 * top-level JSON array → ChatGPT conversations.json; object with a
 * conversations array → Grok. Pure and synchronous — runs inside the worker.
 */
export function parseExportBytes(bytes: Uint8Array): ParseResult {
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const entries = unzipSync(bytes, {
      filter: (f) => f.name === 'conversations.json' || f.name.endsWith('/conversations.json'),
    });
    const name = Object.keys(entries)[0];
    const inner = name === undefined ? undefined : entries[name];
    if (inner === undefined)
      throw new UnrecognisedExportError('zip contains no conversations.json');
    return parseChatGptExport(parseJson(strFromU8(inner)));
  }

  const parsed = parseJson(strFromU8(bytes));
  if (Array.isArray(parsed)) return parseChatGptExport(parsed);
  if (isRecord(parsed) && Array.isArray(parsed.conversations)) return parseGrokExport(parsed);
  throw new UnrecognisedExportError('neither a ChatGPT nor a Grok export');
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new UnrecognisedExportError('file is not valid JSON');
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/unit/third-party-parse-export.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/package.json pnpm-lock.yaml apps/user-client/src/lib/third-party-import/parse-export.ts apps/user-client/tests/unit/third-party-parse-export.test.ts
git commit -m "Add content-based export detection with fflate zip reading"
```

---

### Task 5: Web Worker and cancellable host

**Files:**
- Create: `apps/user-client/src/lib/third-party-import/import.worker.ts`
- Create: `apps/user-client/src/lib/third-party-import/worker-host.ts`
- Test: `apps/user-client/tests/unit/third-party-worker-host.test.ts`

**Interfaces:**
- Consumes: `parseExportBytes` / `UnrecognisedExportError` (Task 4).
- Produces (Task 7 consumes exactly these):

```ts
export type ParseErrorKind = 'unrecognised' | 'parse-failed' | 'worker-crashed' | 'cancelled';
export class ParseExportError extends Error { readonly kind: ParseErrorKind }
export interface ParseHandle { result: Promise<ParseResult>; cancel: () => void }
export function parseThirdPartyExport(file: Blob, spawnWorker?: () => Worker): ParseHandle
```

The optional `spawnWorker` parameter exists so tests can inject a fake worker (jsdom has no real `Worker`). The worker pattern mirrors the existing precedent `src/tools/sandbox-host.ts:16` (`new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' })` — Vite bundles this natively).

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/tests/unit/third-party-worker-host.test.ts
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import {
  ParseExportError,
  parseThirdPartyExport,
} from '../../src/lib/third-party-import/worker-host.js';

/** Minimal fake Worker capturing handlers so the test drives the protocol. */
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  postMessage(data: unknown): void {
    this.posted.push(data);
  }
  terminate(): void {
    this.terminated = true;
  }
}

function fileOf(text: string): Blob {
  return new Blob([text], { type: 'application/json' });
}

describe('parseThirdPartyExport', () => {
  it('resolves with the worker result and terminates the worker', async () => {
    const fake = new FakeWorker();
    const handle = parseThirdPartyExport(fileOf('[]'), () => fake as unknown as Worker);
    await vi.waitFor(() => expect(fake.posted).toHaveLength(1));
    const payload = { source: 'chatgpt', conversations: [], failures: [] };
    fake.onmessage?.({ data: { ok: true, result: payload } } as MessageEvent);
    await expect(handle.result).resolves.toEqual(payload);
    expect(fake.terminated).toBe(true);
  });

  it('rejects with the reported error kind', async () => {
    const fake = new FakeWorker();
    const handle = parseThirdPartyExport(fileOf('junk'), () => fake as unknown as Worker);
    await vi.waitFor(() => expect(fake.posted).toHaveLength(1));
    fake.onmessage?.({
      data: { ok: false, kind: 'unrecognised', message: 'nope' },
    } as MessageEvent);
    await expect(handle.result).rejects.toMatchObject({ kind: 'unrecognised' });
  });

  it('maps a worker crash to worker-crashed', async () => {
    const fake = new FakeWorker();
    const handle = parseThirdPartyExport(fileOf('[]'), () => fake as unknown as Worker);
    await vi.waitFor(() => expect(fake.posted).toHaveLength(1));
    fake.onerror?.({});
    await expect(handle.result).rejects.toMatchObject({ kind: 'worker-crashed' });
    expect(fake.terminated).toBe(true);
  });

  it('cancel terminates the worker and rejects with cancelled', async () => {
    const fake = new FakeWorker();
    const handle = parseThirdPartyExport(fileOf('[]'), () => fake as unknown as Worker);
    handle.cancel();
    await expect(handle.result).rejects.toMatchObject({ kind: 'cancelled' });
    expect(fake.terminated).toBe(true);
    expect(handle.result).toBeInstanceOf(Promise);
    expect(new ParseExportError('cancelled', 'x').kind).toBe('cancelled');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/unit/third-party-worker-host.test.ts`
Expected: FAIL — cannot resolve `worker-host.js`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/user-client/src/lib/third-party-import/import.worker.ts
// SPDX-License-Identifier: AGPL-3.0-only

import { UnrecognisedExportError, parseExportBytes } from './parse-export.js';

/** Worker protocol: receives an ArrayBuffer, posts {ok:true,result}|{ok:false,kind,message}. */
self.onmessage = (e: MessageEvent<ArrayBuffer>) => {
  try {
    const result = parseExportBytes(new Uint8Array(e.data));
    self.postMessage({ ok: true, result });
  } catch (err) {
    self.postMessage({
      ok: false,
      kind: err instanceof UnrecognisedExportError ? 'unrecognised' : 'parse-failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
```

```ts
// apps/user-client/src/lib/third-party-import/worker-host.ts
// SPDX-License-Identifier: AGPL-3.0-only

import type { ParseResult } from './types.js';

export type ParseErrorKind = 'unrecognised' | 'parse-failed' | 'worker-crashed' | 'cancelled';

/** Typed failure from the parse worker; `kind` drives the UI copy (spec §9). */
export class ParseExportError extends Error {
  readonly kind: ParseErrorKind;
  constructor(kind: ParseErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface ParseHandle {
  result: Promise<ParseResult>;
  /** Terminates the worker; `result` rejects with kind 'cancelled'. */
  cancel: () => void;
}

function defaultSpawn(): Worker {
  return new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
}

/**
 * Parse a picked export file off the main thread (spec §3): unzip + JSON.parse
 * + flatten all run in a dedicated worker, so Cancel genuinely works and an
 * out-of-memory kill hits the worker, not the tab (spec §9).
 */
export function parseThirdPartyExport(
  file: Blob,
  spawnWorker: () => Worker = defaultSpawn,
): ParseHandle {
  const worker = spawnWorker();
  let settled = false;
  let rejectFn: (e: Error) => void = () => undefined;

  const result = new Promise<ParseResult>((resolve, reject) => {
    rejectFn = reject;
    worker.onmessage = (e: MessageEvent) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      const d = e.data as
        | { ok: true; result: ParseResult }
        | { ok: false; kind: 'unrecognised' | 'parse-failed'; message: string };
      if (d.ok) resolve(d.result);
      else reject(new ParseExportError(d.kind, d.message));
    };
    worker.onerror = () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new ParseExportError('worker-crashed', 'The import worker crashed.'));
    };
    file
      .arrayBuffer()
      .then((buf) => {
        if (!settled) worker.postMessage(buf, [buf]);
      })
      .catch((e: unknown) => {
        if (settled) return;
        settled = true;
        worker.terminate();
        reject(new ParseExportError('parse-failed', e instanceof Error ? e.message : 'read failed'));
      });
  });
  // A cancelled parse is an expected, handled outcome — never an unhandled rejection.
  result.catch(() => undefined);

  return {
    result,
    cancel: () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      rejectFn(new ParseExportError('cancelled', 'Cancelled.'));
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/unit/third-party-worker-host.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/third-party-import/import.worker.ts apps/user-client/src/lib/third-party-import/worker-host.ts apps/user-client/tests/unit/third-party-worker-host.test.ts
git commit -m "Run third-party export parsing in a cancellable Web Worker"
```

---

### Task 6: Dexie writer

**Files:**
- Create: `apps/user-client/src/data/third-party-import.ts`
- Test: `apps/user-client/tests/data/third-party-import.test.ts`

**Interfaces:**
- Consumes: Task 1 types; existing `getClientDataDb`, `enqueueSync`/`isLinkedForSync` (`src/sync/enqueue.js`), `scheduleClass1Sync` (`src/sync/triggers.js`), `buildDroppedHint` (`src/lib/chatsune-import/dropped-hint.js`), `uuidv7`.
- Produces (Task 7 consumes exactly these):

```ts
export async function listAlreadyImported(personaId: string): Promise<Set<string>>
export async function importThirdPartyConversations(
  personaId: string,
  conversations: ThirdPartyConversation[],
): Promise<{ imported: number; skipped: number }>
```

`listAlreadyImported` returns the set of `importedFrom` values already present on the persona's chats (the UI marks matching rows "Already imported"). The importer mirrors `importChatsuneSessions` (`src/data/chatsune-import.ts:58-127`): same transaction shape, same enqueue pattern, same mindspace resolution. **Do not modify `client-data-db.ts`.**

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/tests/data/third-party-import.test.ts
// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  importThirdPartyConversations,
  listAlreadyImported,
} from '../../src/data/third-party-import.js';
import type { ThirdPartyConversation } from '../../src/lib/third-party-import/types.js';

const ZERO = { images: 0, toolCalls: 0, attachments: 0, artefacts: 0, knowledgeLookups: 0 };
const T0 = 1721300000000;

function conv(overrides: Partial<ThirdPartyConversation> = {}): ThirdPartyConversation {
  return {
    sourceId: 'chatgpt/c1',
    source: 'chatgpt',
    title: 'Imported',
    createdAt: T0,
    lastMessageAt: T0 + 5000,
    messages: [
      { role: 'user', createdAt: T0, blocks: [{ type: 'text', text: 'hi' }], dropped: { ...ZERO } },
      {
        role: 'persona',
        createdAt: T0 + 1000,
        blocks: [
          { type: 'reasoning', text: 'thinking' },
          { type: 'text', text: 'hello' },
        ],
        dropped: { ...ZERO, images: 2 },
      },
    ],
    ...overrides,
  };
}

describe('third-party import writer', () => {
  let personaId: string;

  beforeEach(async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    const now = Date.now();
    await db.mindspaces.add({
      id: 'ms1',
      name: 'Default',
      instructions: '',
      createdAt: now,
      updatedAt: now,
    } as never);
    await db.settings.put({ id: 1, defaultMindspaceId: 'ms1' } as never);
    personaId = 'p1';
    await db.personas.add({ id: personaId, name: 'Fable', createdAt: now, updatedAt: now } as never);
  });

  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('writes chat + messages with importedFrom, blocks and dropped hint', async () => {
    const r = await importThirdPartyConversations(personaId, [conv()]);
    expect(r).toEqual({ imported: 1, skipped: 0 });

    const db = getClientDataDb();
    const chats = await db.chats.where('personaId').equals(personaId).toArray();
    expect(chats).toHaveLength(1);
    expect(chats[0]?.importedFrom).toBe('chatgpt/c1');
    expect(chats[0]?.title).toBe('Imported');
    expect(chats[0]?.createdAt).toBe(T0);

    const chatId = chats[0]?.id ?? '';
    const messages = await db.messages.where('chatId').equals(chatId).sortBy('createdAt');
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('user');
    expect(messages[1]?.contentBlocks[0]).toEqual({ type: 'reasoning', text: 'thinking' });
    expect(messages[1]?.contentBlocks[1]).toEqual({ type: 'text', text: 'hello' });
    // The dropped hint rides as a trailing text block.
    expect(messages[1]?.contentBlocks[2]).toEqual({
      type: 'text',
      text: '[2 images from the original message were not imported.]',
    });
    expect(messages.every((m) => m.streamingState === 'complete')).toBe(true);
    // Memory extraction cursor untouched (spec §8).
    expect(chats[0]?.lastExtractedMessageId).toBeUndefined();
  });

  it('is idempotent by sourceId and reported by listAlreadyImported', async () => {
    await importThirdPartyConversations(personaId, [conv()]);
    const again = await importThirdPartyConversations(personaId, [conv()]);
    expect(again).toEqual({ imported: 0, skipped: 1 });
    const seen = await listAlreadyImported(personaId);
    expect(seen.has('chatgpt/c1')).toBe(true);
    expect(seen.has('grok/other')).toBe(false);
  });

  it('enforces strictly increasing createdAt under equal source timestamps', async () => {
    const equal = conv({
      sourceId: 'grok/equal',
      messages: [
        { role: 'user', createdAt: T0, blocks: [{ type: 'text', text: 'a' }], dropped: { ...ZERO } },
        { role: 'persona', createdAt: T0, blocks: [{ type: 'text', text: 'b' }], dropped: { ...ZERO } },
        { role: 'user', createdAt: 0, blocks: [{ type: 'text', text: 'c' }], dropped: { ...ZERO } },
      ],
    });
    await importThirdPartyConversations(personaId, [equal]);
    const db = getClientDataDb();
    // No importedFrom index exists (and adding one would be a Dexie bump) — filter.
    const chat = await db.chats.filter((c) => c.importedFrom === 'grok/equal').first();
    const ordered = await db.messages
      .where('chatId')
      .equals(chat?.id ?? '')
      .sortBy('createdAt');
    expect(ordered.map((m) => (m.contentBlocks[0] as { text: string }).text)).toEqual([
      'a',
      'b',
      'c',
    ]);
    const times = ordered.map((m) => m.createdAt);
    expect(times[1]).toBeGreaterThan(times[0] ?? 0);
    expect(times[2]).toBeGreaterThan(times[1] ?? 0);
  });

  it('skips conversations with no messages', async () => {
    const r = await importThirdPartyConversations(personaId, [
      conv({ sourceId: 'chatgpt/empty', messages: [] }),
    ]);
    expect(r).toEqual({ imported: 0, skipped: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/data/third-party-import.test.ts`
Expected: FAIL — cannot resolve `third-party-import.js`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/user-client/src/data/third-party-import.ts
// SPDX-License-Identifier: AGPL-3.0-only

import { uuidv7 } from 'uuidv7';
import { type ContentBlock, getClientDataDb } from '../boot/client-data-db.js';
import { buildDroppedHint } from '../lib/chatsune-import/dropped-hint.js';
import type { ThirdPartyConversation } from '../lib/third-party-import/types.js';
import { enqueueSync, isLinkedForSync } from '../sync/enqueue.js';
import { scheduleClass1Sync } from '../sync/triggers.js';

/** The importedFrom keys already present on this persona's chats (spec §3 "Already imported"). */
export async function listAlreadyImported(personaId: string): Promise<Set<string>> {
  const existing = await getClientDataDb().chats.where('personaId').equals(personaId).toArray();
  return new Set(existing.map((c) => c.importedFrom).filter((v): v is string => !!v));
}

/**
 * Write selected third-party conversations into a persona's history (spec §8).
 * Mirrors importChatsuneSessions: one rw transaction, fresh uuids, importedFrom
 * idempotency, Class-1 sync enqueue. The memory-extraction cursor stays unset.
 */
export async function importThirdPartyConversations(
  personaId: string,
  conversations: ThirdPartyConversation[],
): Promise<{ imported: number; skipped: number }> {
  const db = getClientDataDb();
  const persona = await db.personas.get(personaId);
  if (!persona) throw new Error(`importThirdPartyConversations: persona ${personaId} not found`);
  const settings = await db.settings.get(1);
  const resolvedMindspaceId = persona.mindspaceId ?? settings?.defaultMindspaceId;
  if (!resolvedMindspaceId)
    throw new Error('importThirdPartyConversations: no mindspace to snapshot');

  const now = Date.now();
  let imported = 0;
  let skipped = 0;
  const linked = isLinkedForSync();

  await db.transaction('rw', [db.chats, db.messages, db.syncOutbox], async (tx) => {
    const existing = await db.chats.where('personaId').equals(personaId).toArray();
    const seen = new Set(existing.map((c) => c.importedFrom).filter((v): v is string => !!v));

    for (const conv of conversations) {
      if (seen.has(conv.sourceId) || conv.messages.length === 0) {
        skipped++;
        continue;
      }
      seen.add(conv.sourceId);
      const chatId = uuidv7();
      const createdAt = conv.createdAt > 0 ? conv.createdAt : now;

      // Strictly increasing createdAt preserves the linear order under the
      // [chatId+createdAt] index even when source timestamps are equal/missing.
      let lastStamp = 0;
      const rows = conv.messages.map((m) => {
        const stamp = Math.max(m.createdAt > 0 ? m.createdAt : createdAt, lastStamp + 1);
        lastStamp = stamp;
        const contentBlocks: ContentBlock[] = m.blocks.map((b) => ({ type: b.type, text: b.text }));
        const hint = buildDroppedHint(m.dropped);
        if (hint) contentBlocks.push({ type: 'text', text: hint });
        return {
          id: uuidv7(),
          chatId,
          role: m.role,
          contentBlocks,
          createdAt: stamp,
          updatedAt: stamp,
          bookmarked: false,
          streamingState: 'complete' as const,
        };
      });

      await db.chats.add({
        id: chatId,
        personaId,
        title: conv.title,
        resolvedMindspaceId,
        createdAt,
        updatedAt: createdAt,
        lastMessageAt: Math.max(conv.lastMessageAt, lastStamp),
        bookmarkedMessageCount: 0,
        draftInput: '',
        libraryIds: [],
        importedFrom: conv.sourceId,
      });
      if (linked) enqueueSync(tx, 'chats', chatId, 'upsert');

      for (const row of rows) {
        await db.messages.add(row);
        if (linked) enqueueSync(tx, 'messages', row.id, 'upsert');
      }
      imported++;
    }
  });
  if (linked) scheduleClass1Sync();

  return { imported, skipped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/data/third-party-import.test.ts`
Expected: PASS. If the `beforeEach` seeding fails on required row fields, copy the exact seeding shape from `tests/data/chatsune-import.test.ts` (it seeds the same tables for the same writer pattern) rather than inventing one.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/data/third-party-import.ts apps/user-client/tests/data/third-party-import.test.ts
git commit -m "Add third-party conversation writer with importedFrom dedup"
```

---

### Task 7: Import overlay component

**Files:**
- Create: `apps/user-client/src/components/persona-editor/ThirdPartyImportOverlay.tsx`
- Test: `apps/user-client/tests/unit/third-party-import-overlay.test.tsx`

**Interfaces:**
- Consumes: `parseThirdPartyExport` / `ParseExportError` / `ParseHandle` (Task 5), `listAlreadyImported` / `importThirdPartyConversations` (Task 6), Task 1 types, `QK` from `src/data/queryKeys.js`, `useQueryClient` from `@tanstack/react-query`, `useNavigate` from `react-router-dom`.
- Produces: `ThirdPartyImportOverlay({ personaId, personaName, onClose, parseFile? })` — Task 8 mounts exactly this. `parseFile?: (file: File) => ParseHandle` defaults to `parseThirdPartyExport` and exists for tests.

**Behaviour (spec §3 + §9 — copy verbatim from the spec):**
- Overlay shell mirrors `components/transfer/ExportOverlay.tsx`: `cs-dialog-root` / `cs-dialog-backdrop` / `cs-dialog-card cs-zoom-in`, `role="dialog"` + `aria-modal` + `aria-label="Import chats"`, Escape closes (except during the write), backdrop click closes.
- **Pick state:** hidden file input `accept=".zip,.json"`, a visible button "Choose a file", helper copy: "Pick the .zip you downloaded from ChatGPT, or the .json file from Grok." plus "These arrive as chats with ‹personaName› and continue in their voice."
- **Parsing state:** spinner text "Reading your export…" + a **Cancel** button wired to `handle.cancel()` (returns to Pick).
- **Select state:** after parse, load `listAlreadyImported(personaId)`; build rows = parsed conversations + parser `failures`. Row status:
  - importable (checkbox enabled),
  - "Already imported" (`sourceId` in the set — disabled),
  - "Nothing importable" (`messages.length === 0` — disabled),
  - failures render disabled with their `reason`.
  - Title search input (visible when total rows > 10) filters by case-insensitive substring; **"Select all N matches"** while a search is active, **"Select all N"** otherwise — operating only on enabled+visible rows; deselect never touches rows outside the filter.
  - "Pick a different file" button returns to Pick (state reset) without closing the overlay.
- **Import:** footer button "Import N chats" (singular "Import 1 chat"); at zero selected disabled with `title="Select at least one chat to import."` and the same reason visible as helper text. On click: `importThirdPartyConversations` with the selected conversations, then `queryClient.invalidateQueries({ queryKey: QK.chats })`. Progress text "Importing…" while awaiting.
- **Done state:** "Imported N chats." with **Done** (closes) and **View history** (navigate to `/app/history?personaId=${personaId}` and close).
- **Errors (spec §9):** `ParseExportError.kind === 'unrecognised'` → "That doesn't look like a ChatGPT or Grok export. Pick the .zip you downloaded from ChatGPT, or the .json file from Grok."; `'worker-crashed'` or `'parse-failed'` → "This export is very large — importing on a computer is more reliable." Both render in the Pick state with the picker usable. `'cancelled'` renders nothing. Zero conversations AND zero failures → "This export contains no conversations." in Pick. A write failure renders "Nothing was imported — that didn't work. Try again." in Select with the selection preserved.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/user-client/tests/unit/third-party-import-overlay.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { ThirdPartyImportOverlay } from '../../src/components/persona-editor/ThirdPartyImportOverlay.js';
import type { ParseResult } from '../../src/lib/third-party-import/types.js';

const ZERO = { images: 0, toolCalls: 0, attachments: 0, artefacts: 0, knowledgeLookups: 0 };
const T0 = 1721300000000;

function convOf(sourceId: string, title: string, messageCount = 1): ParseResult['conversations'][number] {
  return {
    sourceId,
    source: 'chatgpt',
    title,
    createdAt: T0,
    lastMessageAt: T0,
    messages: Array.from({ length: messageCount }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('persona' as const),
      createdAt: T0 + i,
      blocks: [{ type: 'text' as const, text: `m${i}` }],
      dropped: { ...ZERO },
    })),
  };
}

function renderOverlay(result: ParseResult): void {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ThirdPartyImportOverlay
          personaId="p1"
          personaName="Fable"
          onClose={() => undefined}
          parseFile={() => ({ result: Promise.resolve(result), cancel: () => undefined })}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function pickFile(): Promise<void> {
  const input = document.querySelector('input[type="file"]');
  expect(input).not.toBeNull();
  fireEvent.change(input as HTMLInputElement, {
    target: { files: [new File(['x'], 'conversations.json')] },
  });
  await waitFor(() => expect(screen.queryByText('Reading your export…')).toBeNull());
}

describe('ThirdPartyImportOverlay', () => {
  beforeEach(async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    const now = Date.now();
    await db.mindspaces.add({ id: 'ms1', name: 'D', instructions: '', createdAt: now, updatedAt: now } as never);
    await db.settings.put({ id: 1, defaultMindspaceId: 'ms1' } as never);
    await db.personas.add({ id: 'p1', name: 'Fable', createdAt: now, updatedAt: now } as never);
  });

  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('names the persona in the pick state', () => {
    renderOverlay({ source: 'chatgpt', conversations: [], failures: [] });
    expect(
      screen.getByText('These arrive as chats with Fable and continue in their voice.'),
    ).toBeInTheDocument();
  });

  it('lists conversations with disabled reasons and gates the import button', async () => {
    const db = getClientDataDb();
    const now = Date.now();
    await db.chats.add({
      id: 'c-old',
      personaId: 'p1',
      title: 'Old',
      resolvedMindspaceId: 'ms1',
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
      importedFrom: 'chatgpt/done',
    });
    renderOverlay({
      source: 'chatgpt',
      conversations: [
        convOf('chatgpt/new', 'Fresh one'),
        convOf('chatgpt/done', 'Old one'),
        convOf('chatgpt/empty', 'Empty one', 0),
      ],
      failures: [{ title: 'Broken one', reason: 'Unreadable conversation structure' }],
    });
    await pickFile();

    expect(await screen.findByText('Fresh one')).toBeInTheDocument();
    expect(screen.getByText('Already imported')).toBeInTheDocument();
    expect(screen.getByText('Nothing importable')).toBeInTheDocument();
    expect(screen.getByText('Unreadable conversation structure')).toBeInTheDocument();

    const importBtn = screen.getByRole('button', { name: /Import 0 chats/ });
    expect(importBtn).toBeDisabled();
    expect(importBtn).toHaveAttribute('title', 'Select at least one chat to import.');

    fireEvent.click(screen.getByRole('button', { name: 'Select all 1' }));
    expect(screen.getByRole('button', { name: 'Import 1 chat' })).toBeEnabled();
  });

  it('scopes select-all to the active search filter', async () => {
    renderOverlay({
      source: 'chatgpt',
      conversations: Array.from({ length: 12 }, (_, i) =>
        convOf(`chatgpt/c${i}`, i < 3 ? `Recipe ${i}` : `Other ${i}`),
      ),
      failures: [],
    });
    await pickFile();
    const search = await screen.findByPlaceholderText('Search by title');
    fireEvent.change(search, { target: { value: 'recipe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Select all 3 matches' }));
    expect(screen.getByRole('button', { name: 'Import 3 chats' })).toBeEnabled();
  });

  it('imports the selection and offers View history', async () => {
    renderOverlay({
      source: 'chatgpt',
      conversations: [convOf('chatgpt/one', 'Only one', 2)],
      failures: [],
    });
    await pickFile();
    fireEvent.click(await screen.findByRole('button', { name: 'Select all 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 chat' }));

    expect(await screen.findByText('Imported 1 chat.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View history' })).toBeInTheDocument();
    const chats = await getClientDataDb().chats.where('personaId').equals('p1').toArray();
    expect(chats.map((c) => c.importedFrom)).toEqual(['chatgpt/one']);
  });

  it('shows the constructive error for an unrecognised file and keeps the picker', async () => {
    const qc = new QueryClient();
    const { ParseExportError } = await import(
      '../../src/lib/third-party-import/worker-host.js'
    );
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ThirdPartyImportOverlay
            personaId="p1"
            personaName="Fable"
            onClose={() => undefined}
            parseFile={() => ({
              result: Promise.reject(new ParseExportError('unrecognised', 'nope')),
              cancel: () => undefined,
            })}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await pickFile();
    expect(
      await screen.findByText(
        "That doesn't look like a ChatGPT or Grok export. Pick the .zip you downloaded from ChatGPT, or the .json file from Grok.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose a file' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/unit/third-party-import-overlay.test.tsx`
Expected: FAIL — cannot resolve `ThirdPartyImportOverlay.js`.

- [ ] **Step 3: Write the component**

Follow `components/transfer/ExportOverlay.tsx` for the dialog shell (root/backdrop/card classes, Escape handling, biome-ignore comments as used there) and `ChatsuneImportControl.tsx` for button/text styling classes. Skeleton (fill styling from those two files — classes, not new CSS):

```tsx
// apps/user-client/src/components/persona-editor/ThirdPartyImportOverlay.tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QK } from '../../data/queryKeys.js';
import {
  importThirdPartyConversations,
  listAlreadyImported,
} from '../../data/third-party-import.js';
import type {
  FailedConversation,
  ParseResult,
  ThirdPartyConversation,
} from '../../lib/third-party-import/types.js';
import {
  type ParseHandle,
  ParseExportError,
  parseThirdPartyExport,
} from '../../lib/third-party-import/worker-host.js';

type Phase =
  | { kind: 'pick'; error: string | null }
  | { kind: 'parsing'; handle: ParseHandle }
  | { kind: 'select'; result: ParseResult; already: Set<string>; error: string | null }
  | { kind: 'importing' }
  | { kind: 'done'; imported: number };

const ERR_UNRECOGNISED =
  "That doesn't look like a ChatGPT or Grok export. Pick the .zip you downloaded from ChatGPT, or the .json file from Grok.";
const ERR_TOO_LARGE = 'This export is very large — importing on a computer is more reliable.';
const ERR_EMPTY = 'This export contains no conversations.';
const ERR_WRITE = "Nothing was imported — that didn't work. Try again.";

/** Spec §3: pick → select → import overlay for ChatGPT/Grok chat imports. */
export function ThirdPartyImportOverlay({
  personaId,
  personaName,
  onClose,
  parseFile = parseThirdPartyExport,
}: {
  personaId: string;
  personaName: string;
  onClose: () => void;
  /** Injectable for tests; defaults to the Web Worker host. */
  parseFile?: (file: File) => ParseHandle;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>({ kind: 'pick', error: null });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  // Escape closes except while writing (mirror ExportOverlay's listener).
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && phase.kind !== 'importing') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [phase.kind, onClose]);

  async function onPick(file: File): Promise<void> {
    const handle = parseFile(file);
    setPhase({ kind: 'parsing', handle });
    try {
      const result = await handle.result;
      if (result.conversations.length === 0 && result.failures.length === 0) {
        setPhase({ kind: 'pick', error: ERR_EMPTY });
        return;
      }
      const already = await listAlreadyImported(personaId);
      setSelected(new Set());
      setSearch('');
      setPhase({ kind: 'select', result, already, error: null });
    } catch (e) {
      if (e instanceof ParseExportError && e.kind === 'cancelled') {
        setPhase({ kind: 'pick', error: null });
      } else if (e instanceof ParseExportError && e.kind === 'unrecognised') {
        setPhase({ kind: 'pick', error: ERR_UNRECOGNISED });
      } else {
        setPhase({ kind: 'pick', error: ERR_TOO_LARGE });
      }
    }
  }

  // …render per phase; the decisive derivations for the select state:
  // const importable = result.conversations.filter(
  //   (c) => c.messages.length > 0 && !already.has(c.sourceId));
  // const visible = search.trim() === ''
  //   ? importable
  //   : importable.filter((c) => (c.title ?? 'Untitled chat')
  //       .toLowerCase().includes(search.trim().toLowerCase()));
  // Select-all button label: search active ? `Select all ${visible.length} matches`
  //                                        : `Select all ${importable.length}`;
  // onSelectAll adds every visible sourceId to `selected` (never removes others).
  // Import button: const n = selected.size;
  //   label `Import ${n} ${n === 1 ? 'chat' : 'chats'}`;
  //   disabled n === 0 with title="Select at least one chat to import." and the
  //   same sentence as visible helper text below the button.
  // onImport: setPhase({kind:'importing'}); try {
  //   const chosen = result.conversations.filter((c) => selected.has(c.sourceId));
  //   const { imported } = await importThirdPartyConversations(personaId, chosen);
  //   void qc.invalidateQueries({ queryKey: QK.chats });
  //   setPhase({ kind: 'done', imported });
  // } catch { setPhase({ kind: 'select', result, already, error: ERR_WRITE }); }
  // Done state: `Imported ${imported} ${imported === 1 ? 'chat' : 'chats'}.`
  //   [Done → onClose] [View history → navigate(`/app/history?personaId=${personaId}`); onClose()]
}
```

The full render is the implementer's to write against the tests: pick state (choose-a-file button + two helper lines + error line), parsing state ("Reading your export…" + Cancel → `phase.handle.cancel()`), select state (search input `placeholder="Search by title"` when rows > 10, row list with checkboxes/disabled reasons — disabled rows show their reason as row meta text, "Pick a different file" button resetting to pick, select-all + import footer), done state. Rows for `failures: FailedConversation[]` render title (or "Untitled chat") + reason, always disabled. Keep the whole card scrollable (`max-h` + `overflow-y-auto` on the list) so it holds at 380 px.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/unit/third-party-import-overlay.test.tsx`
Expected: PASS (all five).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/persona-editor/ThirdPartyImportOverlay.tsx apps/user-client/tests/unit/third-party-import-overlay.test.tsx
git commit -m "Add third-party import overlay with selection and constructive errors"
```

---

### Task 8: Hub wiring, copy, and full gates

**Files:**
- Modify: `apps/user-client/src/routes/app/persona/hub.tsx` (the Import section, around lines 572-584)
- Test: extend `apps/user-client/tests/unit/third-party-import-overlay.test.tsx` is NOT needed; hub gating is covered by the existing hub page tests — extend the hub test file that renders the Import section (find it via `rg -l "Bring in a Chatsune" apps/user-client/tests`) with the two assertions below.

**Interfaces:**
- Consumes: `ThirdPartyImportOverlay` (Task 7).
- Produces: the user-reachable entry point (spec §3).

- [ ] **Step 1: Extend the hub test**

Locate the hub test that asserts the Import section (`rg -l "Bring in a Chatsune\|Import a persona" apps/user-client/tests`). Add:

```tsx
it('offers the third-party chat import entry point', async () => {
  // …existing hub render helper…
  expect(await screen.findByText('Just the conversations — text and reasoning.')).toBeInTheDocument();
  const btn = screen.getByRole('button', { name: 'Import chats from ChatGPT or Grok…' });
  fireEvent.click(btn);
  expect(await screen.findByRole('dialog', { name: 'Import chats' })).toBeInTheDocument();
});
```

If no hub test renders that section today, create `apps/user-client/tests/unit/persona-hub-import-section.test.tsx` using the render pattern of the nearest existing hub test (`rg -l "hub" apps/user-client/tests/unit`).

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/user-client && pnpm vitest run <the test file>`
Expected: FAIL — button not found.

- [ ] **Step 3: Wire the hub**

In `hub.tsx`: import the overlay (`import { ThirdPartyImportOverlay } from '../../../components/persona-editor/ThirdPartyImportOverlay.js';` — adjust the relative depth to match the file's existing imports), add state `const [showThirdPartyImport, setShowThirdPartyImport] = useState(false);`, broaden the section intro, and mount the control after `ChatsuneImportControl`:

```tsx
{/* inside the Import <section>, replacing the intro <p> */}
<p className="mb-2 text-[11px] text-paper-soft">
  Bring things in from elsewhere: a Chatsune or Chatsundere persona export, or your
  chat history from ChatGPT or Grok.
</p>
<ChatsuneImportControl … unchanged … />
<p className="mb-2 mt-3 text-[11px] text-paper-soft">
  Just the conversations — text and reasoning.
</p>
<button
  type="button"
  onClick={() => setShowThirdPartyImport(true)}
  className="rounded-md border border-paper-soft/30 px-3 py-1 text-xs uppercase tracking-wider text-paper-soft hover:text-paper"
>
  Import chats from ChatGPT or Grok…
</button>
```

```tsx
{/* beside the other overlays at the bottom of the component; id is the route param */}
{showThirdPartyImport && id ? (
  <ThirdPartyImportOverlay
    personaId={id}
    personaName={persona.name}
    onClose={() => setShowThirdPartyImport(false)}
  />
) : null}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run <the test file>`
Expected: PASS.

- [ ] **Step 5: Full gates**

Run from the repo root, in this order:

1. `pnpm typecheck --force` — expected **14/14, 0 cached** (never trust a cached pass).
2. `pnpm build` — expected 9/9.
3. `cd apps/user-client && pnpm vitest run` — full suite; expected: the known **8** Node-localStorage baseline failures and nothing else new (a 9th failure is real — investigate, do not wave through).
4. `pnpm biome check apps/user-client/src/lib/third-party-import apps/user-client/src/data/third-party-import.ts apps/user-client/src/components/persona-editor/ThirdPartyImportOverlay.tsx apps/user-client/src/routes/app/persona/hub.tsx` — clean.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/routes/app/persona/hub.tsx <the hub test file>
git commit -m "Wire third-party chat import into the persona hub"
```

---

## After the build (controller duties — NOT for task subagents)

1. Whole-branch review (opus) over the feature branch.
2. **Laura pre-squash pass** (light): verify the built flow honours the spec-pass intent — the folded findings of spec §13 are her checklist.
3. Squash to one feature unit on `master` ("Add third-party chat import for ChatGPT and Grok"), verify the squash captured the full tree (`git diff` file-count check + `pnpm typecheck --force` on master).
4. Update `obsidian/STATUS-CLIENT-ONLY.md`; STATUS commit after any tag, never before.
5. Chris's device verification: spec §12 (real ChatGPT zip, real Grok json, re-import dedup, junk file, cancel-mid-parse, sync to second device). **Restart the dev stack before testing** (Vite HMR ignores `packages/*`; a fresh boot also picks up the worker bundle cleanly).
6. Not a Larissa path (client-only; no crypto/auth/sync/proxy service change — the sync touch is the existing Class-1 enqueue pattern).

## Manual verification

See spec §12 — it is the authoritative checklist Chris runs on device.
