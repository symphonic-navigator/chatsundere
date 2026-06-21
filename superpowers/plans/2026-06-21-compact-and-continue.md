# Compact and Continue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade context-overflow handling in the user-client from silent message-dropping to an intelligent, user-controlled conversation summary that keeps the last N messages verbatim.

**Architecture:** A new `apps/user-client/src/compaction/` module, parallel to `src/memory/`. Pure functions (tail selection, prompt/transcript/validation, trigger predicates) are unit-tested in isolation; a runner orchestrates the model call via the existing `runOneShotCompletion` adapter path; an apply step injects the summary into the existing `memoryContext` slot and slices the wire history to the tail. Three trigger layers: a tappable context-fill gauge + an actionable 80 % toast (manual), a 90 % background safety valve, and a visible block-and-compact failsafe with recovery.

**Tech Stack:** TypeScript (strict), React 18, Dexie, Vitest, `@chatsundere/llm-unified`.

**Spec:** `superpowers/specs/2026-06-21-compact-and-continue-design.md` (read it first).

## Global Constraints

- **British English** in all code, comments, copy, commit messages (CLAUDE.md §3/§7).
- **No `!` non-null assertions** — Biome bans them (project commit gate). Use explicit `undefined` guards, as `truncateToWindow` already does.
- **`strict: true`, `noUncheckedIndexedAccess: true`** — array access yields `T | undefined`; guard it.
- **SPDX header** on every new `.ts` file: `// SPDX-License-Identifier: AGPL-3.0-only` (matches `memory/*`).
- **IDs:** use `uuidv7()` (import as in `memory/repo.ts`).
- **Tests live under `apps/user-client/tests/**`** (not beside source).
- **Gate before every commit:** `pnpm typecheck --force` (covers tests) AND `pnpm --filter ./apps/user-client exec biome check`. The full suite baseline is **8 Node-localStorage failures** — a 9th is real.
- **Commit style:** free-form imperative; footer `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. **No `[skip ci]`** (code changes). NOT a Larissa path.
- **Reasoning OFF** on every background/one-shot model call (`bodyExtras: { ..., reasoning: { enabled: false } }`), mirroring `memory/pipeline.ts` `callModel`.
- **No `useLiveQuery`** in this project — refresh UI via `queryClient.invalidateQueries`.

### Shared types (defined here, referenced by tasks)

```ts
// Added to boot/client-data-db.ts in Task 1
export interface CompactionCheckpointRow {
  id: string;
  chatId: string;
  createdAt: number;
  modelId: string;
  summaryMarkdown: string;
  lastMessageIdBefore: string;
  tailStartMessageId: string;
  tokensBefore: number;
  tokensAfter: number;
  tailTokenCount: number;
  prevCheckpointId: string | null;
  trigger: 'manual' | 'auto' | 'overflow';
}
// ChatRow gains: activeCompactionId?: string | null;  compactionToastShown?: boolean;

// Defined in compaction/compaction-prompt.ts (Task 3)
export interface SourceMessage { role: 'user' | 'persona'; text: string; refs: string[] }
```

---

### Task 1: Dexie v29 — schema, ChatRow fields, verno sweep

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts`
- Modify (verno → 29): `apps/user-client/tests/boot/client-data-db-v21.test.ts:101,118`, `client-data-db-v22.test.ts:106,123,137`, `client-data-db-v23.test.ts:76,92`, `client-data-db-v24.test.ts:78,94`, `client-data-db-v27.test.ts:50,60`, `client-data-db-v9.test.ts:73,84`, `client-data-db-v7.test.ts:106,149`, `client-data-db.imagegen.test.ts:15`, `client-data-db.webinterfacing.test.ts:19`, `knowledge-schema.test.ts:18`, `apps/user-client/tests/unit/expert-web-migration.test.ts:15`, `artefacts-schema.test.ts:16`, `attachments-schema.test.ts:17`
- Test: `apps/user-client/tests/boot/client-data-db-v29.test.ts` (new)

**Interfaces:**
- Produces: `CompactionCheckpointRow` (see Shared types); `ChatRow.activeCompactionId?: string | null`; `ChatRow.compactionToastShown?: boolean`; `db.compactionCheckpoints` table.

- [ ] **Step 1: Write the failing migration test**

Create `apps/user-client/tests/boot/client-data-db-v29.test.ts` (mirror the structure of `client-data-db-v27.test.ts`):

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { getClientDataDb, openClientDataDb } from '../../src/boot/client-data-db.js';

describe('client-data-db v29 — compaction checkpoints', () => {
  it('opens at version 29 with the compactionCheckpoints table', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    expect(db.verno).toBe(29);
    expect(db.tables.map((t) => t.name)).toContain('compactionCheckpoints');
  });

  it('can write and read back a checkpoint row', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    await db.compactionCheckpoints.add({
      id: 'cp-1',
      chatId: 'chat-1',
      createdAt: 1,
      modelId: 'm',
      summaryMarkdown: '## Topic & Goal\n_(none)_',
      lastMessageIdBefore: 'a',
      tailStartMessageId: 'b',
      tokensBefore: 100,
      tokensAfter: 10,
      tailTokenCount: 20,
      prevCheckpointId: null,
      trigger: 'manual',
    });
    const byChat = await db.compactionCheckpoints.where('chatId').equals('chat-1').toArray();
    expect(byChat).toHaveLength(1);
    expect(byChat[0]?.summaryMarkdown).toContain('Topic & Goal');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter ./apps/user-client exec vitest run tests/boot/client-data-db-v29.test.ts`
Expected: FAIL — `db.verno` is 28 / no `compactionCheckpoints` table.

- [ ] **Step 3: Add the interface + ChatRow fields**

In `client-data-db.ts`, add the `CompactionCheckpointRow` interface (see Shared types) near the other `*Row` interfaces. In the `ChatRow` interface, add after `lastExtractedMessageId`:

```ts
  /** Active compaction checkpoint id (its summary is injected; history slices to its tail). */
  activeCompactionId?: string | null;
  /** Once-per-chat flag: the 80 % "compact?" toast has been shown. */
  compactionToastShown?: boolean;
```

- [ ] **Step 4: Add the table property**

In the `ClientDataDb` class, after `memoryBody!: Table<MemoryBodyRow, string>;`:

```ts
  compactionCheckpoints!: Table<CompactionCheckpointRow, string>;
```

- [ ] **Step 5: Add the v29 version block**

Immediately after the `this.version(28)...` block (currently ends at line ~959), add:

```ts
    // Version 29 — compact and continue. Adds the compactionCheckpoints store and
    // backfills the optional per-chat pointer/flag for tidiness (reads default via `??`).
    this.version(29)
      .stores({
        compactionCheckpoints: 'id, chatId, createdAt',
      })
      .upgrade(async (tx) => {
        await tx
          .table('chats')
          .toCollection()
          .modify((c: Record<string, unknown>) => {
            if (c.activeCompactionId === undefined) c.activeCompactionId = null;
            if (typeof c.compactionToastShown !== 'boolean') c.compactionToastShown = false;
          });
      });
```

- [ ] **Step 6: Sweep every verno assertion 28 → 29**

In each file:line listed under **Files**, change `toBe(28)` to `toBe(29)`. Verify none remain:

Run: `rg -n "toBe\(28\)" apps/user-client/tests`
Expected: no output.

- [ ] **Step 7: Run the new test + a representative existing verno test**

Run: `pnpm --filter ./apps/user-client exec vitest run tests/boot/client-data-db-v29.test.ts tests/boot/client-data-db-v27.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck + commit**

Run: `pnpm typecheck --force` (expect green).
```bash
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/tests
git commit -m "Add Dexie v29 compaction-checkpoint schema and verno sweep

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 2: config + pure tail selection

**Files:**
- Create: `apps/user-client/src/compaction/config.ts`
- Create: `apps/user-client/src/compaction/tail.ts`
- Test: `apps/user-client/tests/compaction/tail.test.ts` (new)

**Interfaces:**
- Produces: config constants (below); `selectTailStartIndex(messageTokens: number[], contextWindow: number): number` — returns the index of the first message that belongs to the verbatim tail; everything before it is compaction source.

- [ ] **Step 1: Write `config.ts`**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/** Compaction thresholds. All tunable after device testing (see spec §3, §4.1). */

/** Tail (kept verbatim): coherence floor / hard cap / fraction of the context window. */
export const TAIL_MIN_MESSAGES = 12;
export const TAIL_MAX_MESSAGES = 36;
export const TAIL_TOKEN_FRACTION = 0.2;

/** Manual precondition — below this a chat cannot usefully be compacted. */
export const PRECONDITION_MIN_MESSAGES = 12;
export const PRECONDITION_MIN_TOKENS = 4000;

/** Trigger fill ratios (per cent). 80 → actionable toast; 90 → background valve. */
export const TOAST_FILL_THRESHOLD = 80;
export const VALVE_FILL_THRESHOLD = 90;

/** Summariser call budgets. */
export const COMPACTION_MAX_OUTPUT_TOKENS = 2000;
export const COMPACTION_SAFETY_MARGIN = 1000;
/** If the source itself exceeds this fraction of the window, drop oldest source first (spec §4.5). */
export const COMPACTION_SOURCE_FRACTION = 0.7;
```

- [ ] **Step 2: Write the failing tail test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { selectTailStartIndex } from '../../src/compaction/tail.js';

describe('selectTailStartIndex', () => {
  it('returns 0 when there are fewer messages than the coherence floor', () => {
    expect(selectTailStartIndex(new Array(8).fill(10), 131072)).toBe(0);
  });

  it('keeps at least TAIL_MIN_MESSAGES (12) even when tokens are tiny', () => {
    // 40 messages, 1 token each, huge window → token fraction never binds → floor of 12.
    expect(selectTailStartIndex(new Array(40).fill(1), 131072)).toBe(40 - 12);
  });

  it('never keeps more than TAIL_MAX_MESSAGES (36)', () => {
    // 100 messages, large per-message tokens, huge window → cap at 36.
    expect(selectTailStartIndex(new Array(100).fill(5000), 131072)).toBe(100 - 36);
  });

  it('keeps ≥ 20 % of the window in tokens when that exceeds the floor', () => {
    // window 1000 → 20 % = 200 tokens; 30 messages of 50 tokens each.
    // Walking from newest: 4 msgs = 200 tokens reaches the fraction, but the
    // 12-message floor wins → keep 12.
    expect(selectTailStartIndex(new Array(30).fill(50), 1000)).toBe(30 - 12);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter ./apps/user-client exec vitest run tests/compaction/tail.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `tail.ts`**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { TAIL_MAX_MESSAGES, TAIL_MIN_MESSAGES, TAIL_TOKEN_FRACTION } from './config.js';

/**
 * Choose the verbatim-tail boundary. Walking newest → oldest, accumulate tokens
 * and count; stop when (count ≥ TAIL_MIN AND tokens ≥ 20 % of window) OR
 * (count ≥ TAIL_MAX). Returns the index of the first tail message in the
 * original order; messages before it are the compaction source.
 */
export function selectTailStartIndex(messageTokens: number[], contextWindow: number): number {
  const n = messageTokens.length;
  if (n <= TAIL_MIN_MESSAGES) return 0;
  const tokenTarget = contextWindow * TAIL_TOKEN_FRACTION;
  let kept = 0;
  let tokens = 0;
  for (let i = n - 1; i >= 0; i -= 1) {
    const t = messageTokens[i] ?? 0;
    kept += 1;
    tokens += t;
    if (kept >= TAIL_MAX_MESSAGES) break;
    if (kept >= TAIL_MIN_MESSAGES && tokens >= tokenTarget) break;
  }
  return n - kept;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter ./apps/user-client exec vitest run tests/compaction/tail.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm typecheck --force`
```bash
git add apps/user-client/src/compaction/config.ts apps/user-client/src/compaction/tail.ts apps/user-client/tests/compaction/tail.test.ts
git commit -m "Add compaction config and pure tail-boundary selection

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 3: pure compaction prompt — system prompt, transcript, validation

**Files:**
- Create: `apps/user-client/src/compaction/compaction-prompt.ts`
- Test: `apps/user-client/tests/compaction/compaction-prompt.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `COMPACTION_SYSTEM_PROMPT: string`; `COMPACTION_RETRY_REMINDER: string`; `SourceMessage` (see Shared types); `buildCompactionTranscript(source: SourceMessage[], previousSummary: string | null): string`; `validateSummary(markdown: string): { ok: boolean; missing: string[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  buildCompactionTranscript,
  validateSummary,
} from '../../src/compaction/compaction-prompt.js';

const SIX = `## Topic & Goal
x
## Established Facts
x
## Open Threads
x
## User Preferences Observed
x
## Pending References
x
## Tone & Persona Adherence
x`;

describe('validateSummary', () => {
  it('accepts a briefing with all six headings', () => {
    expect(validateSummary(SIX)).toEqual({ ok: true, missing: [] });
  });
  it('reports missing headings', () => {
    const r = validateSummary('## Topic & Goal\nx');
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('Established Facts');
  });
  it('is tolerant of heading-case variation', () => {
    expect(validateSummary(SIX.toLowerCase()).ok).toBe(true);
  });
});

describe('buildCompactionTranscript', () => {
  it('renders user/persona turns and surfaces refs, never raw tool output', () => {
    const t = buildCompactionTranscript(
      [
        { role: 'user', text: 'show me the readme', refs: ['attachment'] },
        { role: 'persona', text: 'it describes deployment', refs: [] },
      ],
      null,
    );
    expect(t).toContain('it describes deployment');
    expect(t).toContain('[attachment]');
  });
  it('folds a previous summary in as Previous Story', () => {
    const t = buildCompactionTranscript([{ role: 'user', text: 'hi', refs: [] }], 'OLD STORY');
    expect(t).toContain('Previous Story');
    expect(t).toContain('OLD STORY');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter ./apps/user-client exec vitest run tests/compaction/compaction-prompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `compaction-prompt.ts`**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

export interface SourceMessage {
  role: 'user' | 'persona';
  text: string;
  refs: string[];
}

/** Ported verbatim from chatsune (spec §4.3). */
export const COMPACTION_SYSTEM_PROMPT = `You are a conversation-compaction assistant. Below is a transcript of a conversation between a user and an AI assistant. Your job is to extract a structured briefing that allows another AI to seamlessly continue this conversation in a new context window.

Output rules:
- Output Markdown only. No preamble, no "I have summarised", no meta-commentary.
- Use the exact section headings shown below, in order.
- Be terse but complete. Aim for 5–10 % of the original token count.
- Preserve the user's language preferences, name, and any established facts about them.
- Quote critical user phrasings verbatim if they carry intent (e.g. preferences, decisions).
- Do not invent information. If a section has no content, write "_(none)_".

Required sections:

## Topic & Goal
What is this conversation about? What is the user trying to achieve?

## Established Facts
Concrete facts, decisions, names, numbers, conclusions reached. Bullet list.

## Open Threads
Questions left unanswered, things the user said they would come back to.

## User Preferences Observed
Communication style, expertise level, language preferences, anything that should shape how the next AI responds.

## Pending References
Files, URLs, artefacts, tools that the user mentioned and that the next assistant should know about. Do not paste their content — just reference them by name.

## Tone & Persona Adherence
One sentence on how the persona has been speaking (formal/informal, etc.).`;

export const COMPACTION_RETRY_REMINDER =
  '\n\nIMPORTANT: The previous attempt was missing required sections. Output MUST contain all six headings exactly as specified, in the order shown.';

const REQUIRED_SECTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/topic.+goal/i, 'Topic & Goal'],
  [/established.+facts?/i, 'Established Facts'],
  [/open.+threads?/i, 'Open Threads'],
  [/(user.+preferences?|preferences? observed)/i, 'User Preferences Observed'],
  [/pending.+references?/i, 'Pending References'],
  [/(tone.+persona|persona.+adherence)/i, 'Tone & Persona Adherence'],
];

export function validateSummary(markdown: string): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const [pattern, label] of REQUIRED_SECTIONS) {
    if (!pattern.test(markdown)) missing.push(label);
  }
  return { ok: missing.length === 0, missing };
}

/** Build the transcript fed to the summariser. Tool output is already excluded
 *  upstream (only user/persona text reaches here); refs are surfaced as hints. */
export function buildCompactionTranscript(
  source: SourceMessage[],
  previousSummary: string | null,
): string {
  const lines: string[] = [];
  if (previousSummary) {
    lines.push('## Previous Story (from earlier checkpoint)', '', previousSummary.trim(), '', '---', '', '## Conversation since the previous checkpoint', '');
  }
  for (const m of source) {
    const speaker = m.role === 'user' ? 'User' : 'Assistant';
    const refSuffix = m.refs.length ? ` ${m.refs.map((r) => `[${r}]`).join(' ')}` : '';
    lines.push(`${speaker}: ${m.text}${refSuffix}`, '');
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter ./apps/user-client exec vitest run tests/compaction/compaction-prompt.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck --force`
```bash
git add apps/user-client/src/compaction/compaction-prompt.ts apps/user-client/tests/compaction/compaction-prompt.test.ts
git commit -m "Add pure compaction prompt, transcript builder and validation

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 4: pure trigger predicates

**Files:**
- Create: `apps/user-client/src/compaction/trigger.ts`
- Test: `apps/user-client/tests/compaction/trigger.test.ts`

**Interfaces:**
- Consumes: config constants from Task 2.
- Produces: `isCompactable(messageCount: number, usedTokens: number): boolean`; `shouldShowToast(fillPct: number, alreadyShown: boolean, compactable: boolean): boolean`; `shouldFireValve(fillPct: number): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { isCompactable, shouldFireValve, shouldShowToast } from '../../src/compaction/trigger.js';

describe('isCompactable', () => {
  it('is false for tiny chats', () => {
    expect(isCompactable(5, 100000)).toBe(false);
    expect(isCompactable(50, 100)).toBe(false);
  });
  it('is true past both thresholds', () => {
    expect(isCompactable(13, 4001)).toBe(true);
  });
});

describe('shouldShowToast', () => {
  it('fires once at 80 % when compactable and not yet shown', () => {
    expect(shouldShowToast(80, false, true)).toBe(true);
  });
  it('does not re-fire once shown', () => {
    expect(shouldShowToast(95, true, true)).toBe(false);
  });
  it('stays quiet below threshold or when not compactable', () => {
    expect(shouldShowToast(79, false, true)).toBe(false);
    expect(shouldShowToast(85, false, false)).toBe(false);
  });
});

describe('shouldFireValve', () => {
  it('fires at and above 90 %', () => {
    expect(shouldFireValve(90)).toBe(true);
    expect(shouldFireValve(99)).toBe(true);
  });
  it('stays quiet below 90 %', () => {
    expect(shouldFireValve(89)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter ./apps/user-client exec vitest run tests/compaction/trigger.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `trigger.ts`**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import {
  PRECONDITION_MIN_MESSAGES,
  PRECONDITION_MIN_TOKENS,
  TOAST_FILL_THRESHOLD,
  VALVE_FILL_THRESHOLD,
} from './config.js';

/** A chat is worth compacting only past both the message-count and token floors. */
export function isCompactable(messageCount: number, usedTokens: number): boolean {
  return messageCount > PRECONDITION_MIN_MESSAGES && usedTokens > PRECONDITION_MIN_TOKENS;
}

/** Show the actionable "Compact?" toast once per chat at the warning fill. */
export function shouldShowToast(fillPct: number, alreadyShown: boolean, compactable: boolean): boolean {
  return compactable && !alreadyShown && fillPct >= TOAST_FILL_THRESHOLD;
}

/** Background safety valve: auto-compact after the send once fill is critical. */
export function shouldFireValve(fillPct: number): boolean {
  return fillPct >= VALVE_FILL_THRESHOLD;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter ./apps/user-client exec vitest run tests/compaction/trigger.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck --force`
```bash
git add apps/user-client/src/compaction/trigger.ts apps/user-client/tests/compaction/trigger.test.ts
git commit -m "Add pure compaction trigger predicates

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 5: per-chat mutex + Dexie repo

**Files:**
- Create: `apps/user-client/src/compaction/mutex.ts`
- Create: `apps/user-client/src/compaction/repo.ts`
- Test: `apps/user-client/tests/compaction/repo.test.ts`

**Interfaces:**
- Consumes: `CompactionCheckpointRow`, `ChatRow` (Task 1); `getClientDataDb` (`boot/client-data-db.js`); `uuidv7`.
- Produces:
  - mutex: `tryAcquireCompactionLock(chatId: string): boolean`, `releaseCompactionLock(chatId: string): void`, `_resetCompactionLocksForTests(): void`.
  - repo: `getActiveCheckpoint(chat: ChatRow): Promise<CompactionCheckpointRow | null>`; `listCheckpoints(chatId: string): Promise<CompactionCheckpointRow[]>`; `writeCheckpoint(checkpoint: CompactionCheckpointRow): Promise<void>` (adds the row and sets `chats.activeCompactionId`); `markCompactionToastShown(chatId: string): Promise<void>`.

- [ ] **Step 1: Write `mutex.ts`** (mirror `memory/mutex.ts`)

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/** Process-local per-chat lock. A held lock makes the next trigger drop (not
 *  queue) — compaction is idempotent-enough that a missed background tick is
 *  harmless (the next send re-evaluates fill). */
const active = new Set<string>();

export function tryAcquireCompactionLock(chatId: string): boolean {
  if (active.has(chatId)) return false;
  active.add(chatId);
  return true;
}

export function releaseCompactionLock(chatId: string): void {
  active.delete(chatId);
}

export function _resetCompactionLocksForTests(): void {
  active.clear();
}
```

- [ ] **Step 2: Write the failing repo test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { openClientDataDb, getClientDataDb } from '../../src/boot/client-data-db.js';
import {
  getActiveCheckpoint,
  listCheckpoints,
  markCompactionToastShown,
  writeCheckpoint,
} from '../../src/compaction/repo.js';

const cp = (id: string, chatId: string, prev: string | null) => ({
  id,
  chatId,
  createdAt: Date.now(),
  modelId: 'm',
  summaryMarkdown: '## Topic & Goal\n_(none)_',
  lastMessageIdBefore: 'a',
  tailStartMessageId: 'b',
  tokensBefore: 100,
  tokensAfter: 10,
  tailTokenCount: 20,
  prevCheckpointId: prev,
  trigger: 'manual' as const,
});

describe('compaction repo', () => {
  it('writeCheckpoint stores the row and points the chat at it', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    await db.chats.add({
      id: 'c1', personaId: 'p1', title: null, resolvedMindspaceId: 'm',
      createdAt: 1, lastMessageAt: 1, bookmarkedMessageCount: 0, draftInput: '', libraryIds: [],
    });
    await writeCheckpoint(cp('cp1', 'c1', null));
    const chat = await db.chats.get('c1');
    expect(chat?.activeCompactionId).toBe('cp1');
    const active = await getActiveCheckpoint(chat!); // eslint-disable-line -- test asserts presence
    expect(active?.id).toBe('cp1');
  });

  it('listCheckpoints returns all checkpoints for a chat, oldest first', async () => {
    await openClientDataDb();
    await writeCheckpoint(cp('cp2', 'c2', null));
    await writeCheckpoint(cp('cp3', 'c2', 'cp2'));
    const all = await listCheckpoints('c2');
    expect(all.map((c) => c.id)).toEqual(['cp2', 'cp3']);
  });

  it('markCompactionToastShown sets the flag', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    await db.chats.add({
      id: 'c3', personaId: 'p1', title: null, resolvedMindspaceId: 'm',
      createdAt: 1, lastMessageAt: 1, bookmarkedMessageCount: 0, draftInput: '', libraryIds: [],
    });
    await markCompactionToastShown('c3');
    expect((await db.chats.get('c3'))?.compactionToastShown).toBe(true);
  });
});
```

> NOTE: the test uses a non-null assertion in test code only; if Biome flags it, replace `chat!` with an explicit guard (`if (!chat) throw new Error('chat missing');`). **Do not use `!` in `src/`.**

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter ./apps/user-client exec vitest run tests/compaction/repo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `repo.ts`**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { ChatRow, CompactionCheckpointRow } from '../boot/client-data-db.js';
import { getClientDataDb } from '../boot/client-data-db.js';

export async function getActiveCheckpoint(chat: ChatRow): Promise<CompactionCheckpointRow | null> {
  const id = chat.activeCompactionId;
  if (!id) return null;
  const row = await getClientDataDb().compactionCheckpoints.get(id);
  return row ?? null;
}

export async function listCheckpoints(chatId: string): Promise<CompactionCheckpointRow[]> {
  const rows = await getClientDataDb().compactionCheckpoints.where('chatId').equals(chatId).toArray();
  rows.sort((a, b) => a.createdAt - b.createdAt);
  return rows;
}

export async function writeCheckpoint(checkpoint: CompactionCheckpointRow): Promise<void> {
  const db = getClientDataDb();
  await db.transaction('rw', db.compactionCheckpoints, db.chats, async () => {
    await db.compactionCheckpoints.add(checkpoint);
    await db.chats.update(checkpoint.chatId, { activeCompactionId: checkpoint.id });
  });
}

export async function markCompactionToastShown(chatId: string): Promise<void> {
  await getClientDataDb().chats.update(chatId, { compactionToastShown: true });
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter ./apps/user-client exec vitest run tests/compaction/repo.test.ts`
Expected: PASS (3 tests). Fix any Biome `!` complaint in the test per the NOTE.

- [ ] **Step 6: Typecheck + biome + commit**

Run: `pnpm typecheck --force` and `pnpm --filter ./apps/user-client exec biome check src/compaction tests/compaction`
```bash
git add apps/user-client/src/compaction/mutex.ts apps/user-client/src/compaction/repo.ts apps/user-client/tests/compaction/repo.test.ts
git commit -m "Add compaction per-chat mutex and checkpoint repo

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 6: the runner — orchestrate a compaction

**Files:**
- Create: `apps/user-client/src/compaction/runner.ts`
- Test: `apps/user-client/tests/compaction/runner.test.ts`

**Interfaces:**
- Consumes: `selectTailStartIndex` (Task 2); `COMPACTION_SYSTEM_PROMPT`, `COMPACTION_RETRY_REMINDER`, `buildCompactionTranscript`, `validateSummary`, `SourceMessage` (Task 3); `writeCheckpoint`, `getActiveCheckpoint` (Task 5); config (Task 2); `runOneShotCompletion`, `offeringToTarget`, `formatRetryEvent` (`@chatsundere/llm-unified`); `estimateTokens` (`lib/token-estimator.js`); `flattenAnswerText` (`lib/content-blocks.js`); `isContextMessage` (`lib/content-blocks.js`); `getClientDataDb`; `uuidv7`.
- Produces: `CompactionArgs` (below); `runCompaction(args: CompactionArgs): Promise<CompactionCheckpointRow | null>` (returns null when there is nothing new to compact; throws on a model/validation failure after the one retry); `messageToSource(row: MessageRow): SourceMessage`.

```ts
export interface CompactionArgs {
  chat: ChatRow;
  persona: PersonaRow;
  provider: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  offering: Offering;
  trigger: 'manual' | 'auto' | 'overflow';
}
```

- [ ] **Step 0: Confirm the `ContentBlock` union**

Run: `rg -n "type ContentBlock|interface .*Block|export type" apps/user-client/src/lib/content-blocks.ts | head -40`
Note the non-text block `type` discriminants (e.g. `'image'`, `'attachment'`, `'artefact'`, `'tool'`). Use them in `messageToSource` ref extraction below; if names differ, adjust the `refs` mapping accordingly. (Text extraction uses `flattenAnswerText`, which already exists.)

- [ ] **Step 1: Write the failing runner test** (mock the model call)

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
vi.mock('@chatsundere/llm-unified', async (orig) => {
  const actual = await orig<typeof import('@chatsundere/llm-unified')>();
  return {
    ...actual,
    runOneShotCompletion: vi.fn(async () => {
      calls.push('x');
      // First call returns an invalid (incomplete) briefing, forcing the retry;
      // the second returns a valid six-section briefing.
      return calls.length === 1
        ? '## Topic & Goal\nonly one section'
        : `## Topic & Goal\na\n## Established Facts\nb\n## Open Threads\nc\n## User Preferences Observed\nd\n## Pending References\ne\n## Tone & Persona Adherence\nf`;
    }),
  };
});

import { openClientDataDb, getClientDataDb } from '../../src/boot/client-data-db.js';
import { runCompaction } from '../../src/compaction/runner.js';
import { listCheckpoints } from '../../src/compaction/repo.js';

afterEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
});

describe('runCompaction', () => {
  it('summarises the source, retries on invalid output, and writes a checkpoint', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    const now = Date.now();
    await db.chats.add({
      id: 'rc1', personaId: 'p', title: null, resolvedMindspaceId: 'm',
      createdAt: now, lastMessageAt: now, bookmarkedMessageCount: 0, draftInput: '', libraryIds: [],
    });
    // 20 complete text messages so a tail is carved and a source remains.
    for (let i = 0; i < 20; i += 1) {
      await db.messages.add({
        id: `m${i}`, chatId: 'rc1', role: i % 2 === 0 ? 'user' : 'persona',
        contentBlocks: [{ type: 'text', text: `message ${i} with enough words to count` }] as never,
        createdAt: now + i, bookmarked: false, streamingState: 'complete',
      });
    }
    const chat = await db.chats.get('rc1');
    if (!chat) throw new Error('chat missing');
    const result = await runCompaction({
      chat,
      persona: { id: 'p', name: 'Fable' } as never,
      provider: {} as never, providerConfig: {} as never, apiKey: 'k',
      corsProxyUrl: null, corsProxyKey: null,
      offering: { context: { recommended: 131072, max: 131072 } } as never,
      trigger: 'manual',
    });
    expect(result).not.toBeNull();
    expect(calls.length).toBe(2); // one invalid + one valid retry
    const cps = await listCheckpoints('rc1');
    expect(cps).toHaveLength(1);
    expect(cps[0]?.summaryMarkdown).toContain('Established Facts');
    expect(cps[0]?.trigger).toBe('manual');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter ./apps/user-client exec vitest run tests/compaction/runner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `runner.ts`**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import {
  type Offering,
  type ProviderConfig,
  type ProviderDefinition,
  type WireMessage,
  formatRetryEvent,
  offeringToTarget,
  runOneShotCompletion,
} from '@chatsundere/llm-unified';
import { uuidv7 } from 'uuidv7';
import type { ChatRow, CompactionCheckpointRow, MessageRow, PersonaRow } from '../boot/client-data-db.js';
import { getClientDataDb } from '../boot/client-data-db.js';
import { flattenAnswerText, isContextMessage } from '../lib/content-blocks.js';
import { estimateTokens } from '../lib/token-estimator.js';
import { resolveContextWindow } from '../lib/context-window.js';
import {
  COMPACTION_MAX_OUTPUT_TOKENS,
  COMPACTION_SOURCE_FRACTION,
} from './config.js';
import {
  COMPACTION_RETRY_REMINDER,
  COMPACTION_SYSTEM_PROMPT,
  type SourceMessage,
  buildCompactionTranscript,
  validateSummary,
} from './compaction-prompt.js';
import { getActiveCheckpoint, writeCheckpoint } from './repo.js';
import { selectTailStartIndex } from './tail.js';

export interface CompactionArgs {
  chat: ChatRow;
  persona: PersonaRow;
  provider: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  offering: Offering;
  trigger: 'manual' | 'auto' | 'overflow';
}

/** Map a stored message to a transcript source line: text via the shared
 *  flattener (drops pills/tool blocks); non-text blocks become ref hints. */
export function messageToSource(row: MessageRow): SourceMessage {
  const refs: string[] = [];
  for (const block of row.contentBlocks) {
    const t = (block as { type?: string }).type;
    if (t && t !== 'text') refs.push(t);
  }
  return {
    role: row.role === 'user' ? 'user' : 'persona',
    text: flattenAnswerText(row.contentBlocks),
    refs,
  };
}

async function summarise(args: CompactionArgs, transcript: string): Promise<string> {
  const call = (system: string): Promise<string> =>
    runOneShotCompletion({
      provider: args.provider,
      providerConfig: args.providerConfig,
      apiKey: args.apiKey,
      corsProxyUrl: args.corsProxyUrl,
      corsProxyKey: args.corsProxyKey,
      target: offeringToTarget(args.offering),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: transcript },
      ] satisfies WireMessage[],
      bodyExtras: { temperature: 0.3, max_tokens: COMPACTION_MAX_OUTPUT_TOKENS, reasoning: { enabled: false } },
      onRetry: (e) => console.warn(formatRetryEvent(e)),
    });
  const first = await call(COMPACTION_SYSTEM_PROMPT);
  if (validateSummary(first).ok) return first;
  // One retry with a reminder and a slightly higher temperature (spec §4.4).
  const second = await runOneShotCompletion({
    provider: args.provider,
    providerConfig: args.providerConfig,
    apiKey: args.apiKey,
    corsProxyUrl: args.corsProxyUrl,
    corsProxyKey: args.corsProxyKey,
    target: offeringToTarget(args.offering),
    messages: [
      { role: 'system', content: COMPACTION_SYSTEM_PROMPT + COMPACTION_RETRY_REMINDER },
      { role: 'user', content: transcript },
    ] satisfies WireMessage[],
    bodyExtras: { temperature: 0.5, max_tokens: COMPACTION_MAX_OUTPUT_TOKENS, reasoning: { enabled: false } },
    onRetry: (e) => console.warn(formatRetryEvent(e)),
  });
  if (!validateSummary(second).ok) {
    throw new Error('compaction summary failed validation after retry');
  }
  return second;
}

/**
 * Compact a chat: carve the verbatim tail, summarise everything before it (since
 * the previous checkpoint, folding its summary in), and persist a checkpoint.
 * Returns null when there is nothing new to compact. Throws on model failure.
 */
export async function runCompaction(args: CompactionArgs): Promise<CompactionCheckpointRow | null> {
  const db = getClientDataDb();
  const all = (await db.messages.where('chatId').equals(args.chat.id).sortBy('createdAt')).filter(
    isContextMessage,
  );
  if (all.length === 0) return null;

  const window = resolveContextWindow(args.persona, args.offering);
  const tokens = all.map((m) => estimateTokens(flattenAnswerText(m.contentBlocks)));
  const tailStartIdx = selectTailStartIndex(tokens, window);
  if (tailStartIdx <= 0) return null; // nothing to compress yet

  const previous = await getActiveCheckpoint(args.chat);
  let sourceStartIdx = 0;
  if (previous) {
    const prevIdx = all.findIndex((m) => m.id === previous.tailStartMessageId);
    sourceStartIdx = prevIdx >= 0 ? prevIdx : 0;
  }
  let sourceSlice = all.slice(sourceStartIdx, tailStartIdx);
  if (sourceSlice.length === 0) return null; // already compacted up to the tail

  // Source-truncation guard (spec §4.5): drop oldest source until it fits.
  const sourceBudget = window * COMPACTION_SOURCE_FRACTION;
  while (
    sourceSlice.length > 1 &&
    sourceSlice.reduce((s, m) => s + estimateTokens(flattenAnswerText(m.contentBlocks)), 0) > sourceBudget
  ) {
    sourceSlice = sourceSlice.slice(1);
  }

  const source: SourceMessage[] = sourceSlice.map(messageToSource);
  const transcript = buildCompactionTranscript(source, previous?.summaryMarkdown ?? null);
  const markdown = await summarise(args, transcript);

  const tailStartMsg = all[tailStartIdx];
  const lastBeforeMsg = all[tailStartIdx - 1];
  if (!tailStartMsg || !lastBeforeMsg) return null;

  const tokensBefore = sourceSlice.reduce(
    (s, m) => s + estimateTokens(flattenAnswerText(m.contentBlocks)),
    0,
  );
  const tailTokenCount = tokens.slice(tailStartIdx).reduce((s, t) => s + t, 0);

  const checkpoint: CompactionCheckpointRow = {
    id: uuidv7(),
    chatId: args.chat.id,
    createdAt: Date.now(),
    modelId: args.offering.id ?? '',
    summaryMarkdown: markdown,
    lastMessageIdBefore: lastBeforeMsg.id,
    tailStartMessageId: tailStartMsg.id,
    tokensBefore,
    tokensAfter: estimateTokens(markdown),
    tailTokenCount,
    prevCheckpointId: previous?.id ?? null,
    trigger: args.trigger,
  };
  await writeCheckpoint(checkpoint);
  return checkpoint;
}
```

> NOTE: `args.offering.id` — confirm the Offering id field name during Step 0 (`rg -n "interface Offering|type Offering" packages/llm-unified/src`). If it is `uniqueId`/`slug`, use that. `uuidv7` import path: copy the exact import line from `apps/user-client/src/memory/repo.ts`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter ./apps/user-client exec vitest run tests/compaction/runner.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + biome + commit**

Run: `pnpm typecheck --force` and `pnpm --filter ./apps/user-client exec biome check src/compaction`
```bash
git add apps/user-client/src/compaction/runner.ts apps/user-client/tests/compaction/runner.test.ts
git commit -m "Add compaction runner orchestration

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 7: apply — inject summary + slice the tail

**Files:**
- Create: `apps/user-client/src/compaction/apply.ts`
- Test: `apps/user-client/tests/compaction/apply.test.ts`

**Interfaces:**
- Consumes: `getActiveCheckpoint` (Task 5); `ChatRow`, `MessageRow` (Task 1).
- Produces: `applyActiveCompaction(chat: ChatRow, priorMessages: MessageRow[], memoryContext: string): Promise<{ priorMessages: MessageRow[]; memoryContext: string }>` — when the chat has an active checkpoint, prepend a `<conversation_compact>` block to `memoryContext` and slice `priorMessages` to those at/after the tail boundary; otherwise return the inputs unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { openClientDataDb, getClientDataDb } from '../../src/boot/client-data-db.js';
import { writeCheckpoint } from '../../src/compaction/repo.js';
import { applyActiveCompaction } from '../../src/compaction/apply.js';

const msg = (id: string, createdAt: number) =>
  ({ id, chatId: 'a1', role: 'user', contentBlocks: [], createdAt, bookmarked: false, streamingState: 'complete' }) as never;

describe('applyActiveCompaction', () => {
  it('returns inputs unchanged when there is no active checkpoint', async () => {
    await openClientDataDb();
    const chat = { id: 'noop', activeCompactionId: null } as never;
    const prior = [msg('x', 1)];
    const out = await applyActiveCompaction(chat, prior, '<usermemory/>');
    expect(out.priorMessages).toBe(prior);
    expect(out.memoryContext).toBe('<usermemory/>');
  });

  it('slices to the tail and injects the compact block', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    await db.chats.add({
      id: 'a1', personaId: 'p', title: null, resolvedMindspaceId: 'm',
      createdAt: 1, lastMessageAt: 1, bookmarkedMessageCount: 0, draftInput: '', libraryIds: [],
    });
    await writeCheckpoint({
      id: 'cp', chatId: 'a1', createdAt: 1, modelId: 'm',
      summaryMarkdown: 'BRIEFING', lastMessageIdBefore: 'm2', tailStartMessageId: 'm3',
      tokensBefore: 1, tokensAfter: 1, tailTokenCount: 1, prevCheckpointId: null, trigger: 'manual',
    });
    const chat = await db.chats.get('a1');
    if (!chat) throw new Error('chat missing');
    const prior = [msg('m1', 1), msg('m2', 2), msg('m3', 3), msg('m4', 4)];
    const out = await applyActiveCompaction(chat, prior, '<usermemory/>');
    expect(out.priorMessages.map((m) => m.id)).toEqual(['m3', 'm4']);
    expect(out.memoryContext).toContain('<conversation_compact>');
    expect(out.memoryContext).toContain('BRIEFING');
    expect(out.memoryContext).toContain('<usermemory/>');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter ./apps/user-client exec vitest run tests/compaction/apply.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apply.ts`**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { ChatRow, MessageRow } from '../boot/client-data-db.js';
import { getActiveCheckpoint } from './repo.js';

/**
 * If the chat has an active compaction checkpoint, replace the compressed
 * prefix with its summary (injected as a distinct block before the memory
 * context) and slice the history to the verbatim tail. Otherwise a no-op.
 */
export async function applyActiveCompaction(
  chat: ChatRow,
  priorMessages: MessageRow[],
  memoryContext: string,
): Promise<{ priorMessages: MessageRow[]; memoryContext: string }> {
  const checkpoint = await getActiveCheckpoint(chat);
  if (!checkpoint) return { priorMessages, memoryContext };

  const boundary = priorMessages.find((m) => m.id === checkpoint.tailStartMessageId);
  const sliced = boundary
    ? priorMessages.filter((m) => m.createdAt >= boundary.createdAt)
    : priorMessages;

  const block = `<conversation_compact>\n${checkpoint.summaryMarkdown}\n</conversation_compact>`;
  const combined = memoryContext ? `${block}\n${memoryContext}` : block;
  return { priorMessages: sliced, memoryContext: combined };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter ./apps/user-client exec vitest run tests/compaction/apply.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck --force`
```bash
git add apps/user-client/src/compaction/apply.ts apps/user-client/tests/compaction/apply.test.ts
git commit -m "Add compaction apply: inject summary and slice tail

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 8: wire-up — apply on send + the 90 % background valve (Layer 2)

**Files:**
- Modify: `apps/user-client/src/state/stream-manager.store.ts` (memory-context site ~656-679; post-send trigger ~803; `fireMemoryPipeline` ~147-187 as the pattern)
- Modify: `apps/user-client/src/lib/stream-engine.ts` (return `usedTokens`)
- Modify: `apps/user-client/src/lib/context-window.ts` (export `wireTokens`)
- Test: extend `apps/user-client/tests/compaction/apply.test.ts` is sufficient for the pure part; the wire-up is covered by the device checklist (no brittle store test — see CLAUDE.md §13 "test structurally").

**Interfaces:**
- Consumes: `applyActiveCompaction` (Task 7); `runCompaction` (Task 6); `tryAcquireCompactionLock`/`releaseCompactionLock` (Task 5); `shouldFireValve` (Task 4); `contextUtilisation` (`lib/token-estimator.js`); `resolveContextWindow` (`lib/context-window.js`).
- Produces: `fireCompactionValve(args: StartArgs, usedTokens: number): void` (a local function in the store, mirroring `fireMemoryPipeline`).

- [ ] **Step 1: Export `wireTokens` from `context-window.ts`**

Find `function wireTokens(` in `apps/user-client/src/lib/context-window.ts` and add the `export` keyword. Confirm:

Run: `rg -n "export function wireTokens" apps/user-client/src/lib/context-window.ts`
Expected: one match.

- [ ] **Step 2: Return `usedTokens` from the stream engine**

In `apps/user-client/src/lib/stream-engine.ts`: import `wireTokens` from `./context-window.js`. After `const { messages: sentMessages } = truncateToWindow(wireMessages, budget);`, add:

```ts
  const usedTokens = sentMessages.reduce((s, m) => s + wireTokens(m), 0);
```

Add `usedTokens: number;` to the `StreamEngineResult` interface, and include `usedTokens` in the returned result object (find the `return { ... }` that builds `StreamEngineResult`).

Run: `pnpm typecheck --force`
Expected: green.

- [ ] **Step 3: Apply the checkpoint on the outgoing send**

In `stream-manager.store.ts`, locate where `memoryContext` is computed (`const memoryContext = (args.persona.useMemory ?? true) ? await loadMemoryContext(args.persona.id) : '';`, ~line 679) and where `priorMessages`/`args.priorMessages` are passed to `runStreamEngine`. Import at the top:

```ts
import { applyActiveCompaction } from '../compaction/apply.js';
```

Immediately after `memoryContext` is computed, replace the prior-messages + memory-context values used by the engine with the compacted ones:

```ts
  const compacted = await applyActiveCompaction(args.chat, args.priorMessages, memoryContext);
  // Use compacted.priorMessages and compacted.memoryContext where the engine is invoked.
```

Then pass `compacted.priorMessages` as the engine's `priorMessages` and `compacted.memoryContext` as `memoryContext`. (If the engine is invoked with `args.priorMessages` directly, thread the sliced array through.)

- [ ] **Step 4: Add `fireCompactionValve` (mirror `fireMemoryPipeline`)**

Near `fireMemoryPipeline` (~line 147), add:

```ts
function fireCompactionValve(args: StartArgs, usedTokens: number): void {
  const window = resolveContextWindow(args.persona, args.offering);
  const fillPct = contextUtilisation(usedTokens, window);
  if (!shouldFireValve(fillPct)) return;
  if (!tryAcquireCompactionLock(args.chat.id)) return;
  void runCompaction({
    chat: args.chat,
    persona: args.persona,
    provider: args.provider,
    providerConfig: args.providerConfig,
    apiKey: args.apiKey,
    corsProxyUrl: args.corsProxyUrl,
    corsProxyKey: args.corsProxyKey,
    offering: args.offering,
    trigger: 'auto',
  })
    .then((cp) => {
      if (cp) void queryClient.invalidateQueries({ queryKey: QK.chat(args.chat.id) });
    })
    .catch(() => {
      // runCompaction logs nothing user-facing; the valve is best-effort.
    })
    .finally(() => releaseCompactionLock(args.chat.id));
}
```

Add the imports at the top:

```ts
import { runCompaction } from '../compaction/runner.js';
import { releaseCompactionLock, tryAcquireCompactionLock } from '../compaction/mutex.js';
import { shouldFireValve } from '../compaction/trigger.js';
import { contextUtilisation } from '../lib/token-estimator.js';
import { resolveContextWindow } from '../lib/context-window.js';
```

> NOTE: confirm `QK.chat(chatId)` exists (`rg -n "chat:" apps/user-client/src/**/query-keys*`); if the chat query key differs, use the matching one that `useChat` reads. If none exists, invalidate the messages list key the chat view consumes.

- [ ] **Step 5: Call the valve after a successful send**

Where `runStreamEngine`'s result is awaited in the successful-send path, capture `usedTokens` from the result and, right after `fireMemoryPipeline(args);` (~line 803), add:

```ts
  fireCompactionValve(args, result.usedTokens);
```

(Use the actual variable name the store binds the engine result to.)

- [ ] **Step 6: Gate + commit**

Run: `pnpm typecheck --force` and `pnpm --filter ./apps/user-client exec vitest run tests/compaction` and `pnpm --filter ./apps/user-client exec biome check src`
Expected: compaction tests green; typecheck green.
```bash
git add apps/user-client/src/state/stream-manager.store.ts apps/user-client/src/lib/stream-engine.ts apps/user-client/src/lib/context-window.ts
git commit -m "Wire compaction apply on send and the 90% background valve

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 9: block-and-compact failsafe + recovery (Layer 3)

**Files:**
- Modify: `apps/user-client/src/state/stream-manager.store.ts` (pre-send overflow check in `start`/`runIntoDraft`)
- Create: `apps/user-client/src/compaction/overflow.ts`
- Test: `apps/user-client/tests/compaction/overflow.test.ts`

**Interfaces:**
- Consumes: config (Task 2); `estimateTokens`, `resolveContextWindow`.
- Produces: `wouldOverflow(usedTokens: number, window: number): boolean` — true when even after the normal truncation a single oversized turn cannot fit and a synchronous compaction is required before sending.

- [ ] **Step 1: Write the failing pure test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { wouldOverflow } from '../../src/compaction/overflow.js';

describe('wouldOverflow', () => {
  it('is true when used tokens meet or exceed the window', () => {
    expect(wouldOverflow(131072, 131072)).toBe(true);
    expect(wouldOverflow(200000, 131072)).toBe(true);
  });
  it('is false with headroom', () => {
    expect(wouldOverflow(100000, 131072)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter ./apps/user-client exec vitest run tests/compaction/overflow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `overflow.ts`**

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/** The send cannot fit even after normal truncation → compact synchronously
 *  first. Conservative: treats reaching the window as overflow. */
export function wouldOverflow(usedTokens: number, window: number): boolean {
  return usedTokens >= window;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter ./apps/user-client exec vitest run tests/compaction/overflow.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Block-and-compact in the send path with recovery**

In `stream-manager.store.ts` `start` (the public entry the send path calls), BEFORE the message is inserted and the stream begins, add a pre-flight: estimate the would-be used tokens for this send (sum `wireTokens` over the prospective wire messages, or reuse the existing token computation if `start` already has it). If `wouldOverflow(used, resolveContextWindow(persona, offering))`:

```ts
  if (wouldOverflow(projectedUsed, window)) {
    set({ compactingState: 'blocking' }); // drives a "Compacting…" UI with live motion
    try {
      await runCompaction({ ...compactionArgsFrom(args), trigger: 'overflow' });
    } catch {
      set({ compactingState: null });
      toastStore.show({
        message: "Couldn't compact just now — your message is kept.",
        tone: 'warn',
        durationMs: 8000,
        action: { label: 'Retry', onClick: () => void get().start(args) },
      });
      return; // typed/pasted message is preserved in the composer; do not send.
    }
    set({ compactingState: null });
  }
```

Add a `compactingState: 'blocking' | null` field to the store state + its initial value `null`, and the imports:

```ts
import { wouldOverflow } from '../compaction/overflow.js';
```

(`runCompaction`, `resolveContextWindow`, `toastStore` are already imported from Task 8 / existing code. `compactionArgsFrom` is a tiny local helper that builds `CompactionArgs` from `StartArgs` — extract the object literal already used in `fireCompactionValve`.)

> NOTE: confirm where the composer text lives so "your message is kept" is true — the send path must NOT clear `draftInput` before a failed block-compact returns. Verify the order in `start` (draft is cleared in the atomic insert ~line 224-289); move/guard the clear so it happens only after a successful (or skipped) compaction.

- [ ] **Step 6: Gate + commit**

Run: `pnpm typecheck --force` and `pnpm --filter ./apps/user-client exec vitest run tests/compaction`
```bash
git add apps/user-client/src/compaction/overflow.ts apps/user-client/src/state/stream-manager.store.ts apps/user-client/tests/compaction/overflow.test.ts
git commit -m "Add block-and-compact failsafe with message-preserving recovery

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 10: manual trigger UI — tappable gauge, confirm card, 80 % toast (Layer 1)

**Files:**
- Modify: `apps/user-client/src/components/chat/InteractionTopbar.tsx` (gauge → button; `onCompact`, `compactable` props)
- Modify: the chat page that renders `InteractionTopbar` (`rg -n "InteractionTopbar" apps/user-client/src` to find it — likely `routes/app/chat/chat-page.tsx`) — pass `onCompact`/`compactable`, host the confirm card, fire the 80 % toast.
- Create: `apps/user-client/src/components/chat/CompactConfirmCard.tsx`
- Test: `apps/user-client/tests/compaction/interaction-topbar-gauge.test.tsx` (RTL)

**Interfaces:**
- Consumes: `isCompactable`, `shouldShowToast` (Task 4); `runCompaction` (Task 6); `markCompactionToastShown` (Task 5); `contextUtilisation`.
- Produces: gauge renders as a `<button>` when `compactable`, disabled-with-title otherwise.

- [ ] **Step 1: Write the failing RTL test**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InteractionTopbar } from '../../src/components/chat/InteractionTopbar.js';

const base = {
  persona: { id: 'p', name: 'Fable' } as never,
  chat: { id: 'c' } as never,
  contextWindow: 1000,
  onExit: () => {},
  onRenameChat: () => {},
};

describe('InteractionTopbar gauge as compaction trigger', () => {
  it('invokes onCompact when the gauge is tapped and compactable', () => {
    const onCompact = vi.fn();
    render(<InteractionTopbar {...base} usedTokens={900} compactable onCompact={onCompact} />);
    fireEvent.click(screen.getByRole('button', { name: /compact/i }));
    expect(onCompact).toHaveBeenCalled();
  });

  it('is disabled with a reason when not compactable', () => {
    render(<InteractionTopbar {...base} usedTokens={100} compactable={false} onCompact={() => {}} />);
    const gauge = screen.getByRole('button', { name: /compact/i });
    expect(gauge).toBeDisabled();
    expect(gauge).toHaveAttribute('title');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter ./apps/user-client exec vitest run tests/compaction/interaction-topbar-gauge.test.tsx`
Expected: FAIL — props don't exist / no button.

- [ ] **Step 3: Make the gauge a button**

In `InteractionTopbar.tsx`, add to `Props`: `compactable?: boolean;` and `onCompact?: () => void;`. Replace the gauge `<div className="context-gauge" ...>` (lines ~143-148) with:

```tsx
          <button
            type="button"
            className="context-gauge"
            aria-label={p.compactable ? 'Compact conversation' : 'Compact conversation (unavailable)'}
            title={p.compactable ? 'Compact the conversation' : 'Nothing to compact yet — the conversation is still short'}
            disabled={!p.compactable}
            onClick={p.compactable ? p.onCompact : undefined}
          >
            <div className="context-gauge-bar">
              <div className="context-gauge-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="context-gauge-text">{pct}%</div>
          </button>
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter ./apps/user-client exec vitest run tests/compaction/interaction-topbar-gauge.test.tsx`
Expected: PASS.

- [ ] **Step 5: Confirm card + chat-page wiring**

Create `CompactConfirmCard.tsx` — a minimal-functional modal/card with the reassurance line and two buttons:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import type { JSX } from 'react';

export function CompactConfirmCard(p: {
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <div className="compact-confirm-card" role="dialog" aria-label="Compact conversation">
      <p>Compact this conversation to keep it going? Your full conversation stays in Reading Mode.</p>
      <div className="compact-confirm-actions">
        <button type="button" onClick={p.onCancel} disabled={p.busy}>Cancel</button>
        <button type="button" onClick={p.onConfirm} disabled={p.busy}>
          {p.busy ? 'Compacting…' : 'Compact'}
        </button>
      </div>
    </div>
  );
}
```

In the chat page that renders `InteractionTopbar`: compute `compactable = isCompactable(messageCount, usedTokens)`, pass `compactable` + `onCompact={() => setShowConfirm(true)}`. Render `CompactConfirmCard` when `showConfirm`, whose `onConfirm` calls `runCompaction({...args, trigger: 'manual'})` (build args from the page's persona/chat/provider context — reuse the same values the send path uses), then `invalidateQueries` the chat key and closes the card. After a successful compaction toast: `tone: 'success'`, e.g. "Conversation compacted."

For the 80 % toast: in the same place that already knows `usedTokens`/`contextWindow` post-render (or right after a send completes), compute `fillPct = contextUtilisation(usedTokens, window)` and:

```ts
  if (shouldShowToast(fillPct, chat.compactionToastShown ?? false, compactable)) {
    void markCompactionToastShown(chat.id);
    void queryClient.invalidateQueries({ queryKey: QK.chat(chat.id) });
    toastStore.show({
      message: 'This conversation is getting long. Compact it to keep it sharp?',
      tone: 'info',
      durationMs: 9000,
      action: { label: 'Compact', onClick: () => setShowConfirm(true) },
    });
  }
```

> NOTE: gate the toast so it does NOT fire during live voice (mirror how `fireMemoryPipeline`'s callers/suppression work — `rg -n "live|voice" apps/user-client/src/routes/app/chat`). Place the check where a render already has `usedTokens`; do not add a polling effect.

- [ ] **Step 6: Gate + commit**

Run: `pnpm typecheck --force` and `pnpm --filter ./apps/user-client exec vitest run tests/compaction` and `pnpm --filter ./apps/user-client exec biome check src/components/chat src/compaction`
```bash
git add apps/user-client/src/components/chat/InteractionTopbar.tsx apps/user-client/src/components/chat/CompactConfirmCard.tsx apps/user-client/src/routes/app/chat apps/user-client/tests/compaction/interaction-topbar-gauge.test.tsx
git commit -m "Add manual compaction trigger: tappable gauge, confirm card, 80% toast

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 11: marker pill + snapshot drawer

**Files:**
- Create: `apps/user-client/src/components/chat/CompactionMarker.tsx`
- Create: `apps/user-client/src/components/chat/CompactionDrawer.tsx`
- Modify: the message-list renderer (`rg -n "ChatStream" apps/user-client/src` → `components/chat/ChatStream.tsx`) to render a marker at each checkpoint boundary
- Test: `apps/user-client/tests/compaction/compaction-marker.test.tsx`

**Interfaces:**
- Consumes: `listCheckpoints` (Task 5); `CompactionCheckpointRow` (Task 1); the existing Markdown renderer used by message bubbles (`rg -n "Markdown" apps/user-client/src/components/chat`).
- Produces: `CompactionMarker` (a tappable pill, `Pill`-consistent, opening the drawer); `CompactionDrawer` (read-only briefing + refresh-line).

- [ ] **Step 1: Write the failing RTL test**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompactionMarker } from '../../src/components/chat/CompactionMarker.js';

const cp = {
  id: 'cp', chatId: 'c', createdAt: 1, modelId: 'm', summaryMarkdown: 'BRIEFING TEXT',
  lastMessageIdBefore: 'a', tailStartMessageId: 'b', tokensBefore: 87000, tokensAfter: 4000,
  tailTokenCount: 20, prevCheckpointId: null, trigger: 'manual' as const,
};

describe('CompactionMarker', () => {
  it('renders a tappable pill and opens the drawer with the briefing', () => {
    render(<CompactionMarker checkpoint={cp} />);
    const pill = screen.getByRole('button', { name: /compacted/i });
    expect(pill).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(pill);
    expect(screen.getByText(/BRIEFING TEXT/)).toBeInTheDocument();
    expect(screen.getByText(/compact again/i)).toBeInTheDocument(); // the refresh line
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter ./apps/user-client exec vitest run tests/compaction/compaction-marker.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the marker + drawer**

`CompactionMarker.tsx` (mirrors `Pill.tsx` affordance attributes):

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { type JSX, useState } from 'react';
import type { CompactionCheckpointRow } from '../../boot/client-data-db.js';
import { CompactionDrawer } from './CompactionDrawer.js';

const k = (n: number): string => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);

export function CompactionMarker({ checkpoint }: { checkpoint: CompactionCheckpointRow }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <span className="pill-wrap compaction-marker-wrap">
      <button
        type="button"
        className="pill compaction-marker"
        data-pill-expandable
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ✨ Compacted · {k(checkpoint.tokensBefore)} → {k(checkpoint.tokensAfter)} tokens
        <span className="compaction-marker-chevron" aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open ? <CompactionDrawer checkpoint={checkpoint} /> : null}
    </span>
  );
}
```

`CompactionDrawer.tsx` (read-only; reuse the message Markdown renderer — replace `MarkdownView` below with the actual component name found in Step "Interfaces"):

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import type { JSX } from 'react';
import type { CompactionCheckpointRow } from '../../boot/client-data-db.js';
// import { MarkdownView } from './MarkdownView.js'; // use the real renderer name

export function CompactionDrawer({ checkpoint }: { checkpoint: CompactionCheckpointRow }): JSX.Element {
  return (
    <div className="compaction-drawer" role="region" aria-label="Compaction briefing">
      {/* <MarkdownView source={checkpoint.summaryMarkdown} /> */}
      <div className="compaction-drawer-body">{checkpoint.summaryMarkdown}</div>
      <p className="compaction-drawer-note">
        This briefing is generated from the conversation. To refresh it, compact again.
      </p>
    </div>
  );
}
```

> NOTE: swap the placeholder `<div className="compaction-drawer-body">` for the project's real Markdown renderer so the briefing renders as Markdown (the test only checks the text is present, so it passes either way, but the spec wants Markdown rendering). Find it via `rg -n "react-markdown|Markdown" apps/user-client/src/components/chat`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter ./apps/user-client exec vitest run tests/compaction/compaction-marker.test.tsx`
Expected: PASS.

- [ ] **Step 5: Render markers in the message stream**

In `ChatStream.tsx`, load the chat's checkpoints (`listCheckpoints(chatId)` via TanStack Query, key `QK.chat`-adjacent or a new `QK.compaction(chatId)`), and when mapping messages, render a `<CompactionMarker checkpoint={cp} />` immediately before the message whose `id === cp.tailStartMessageId`. Give a freshly-arrived auto checkpoint a one-time settle by keying a CSS animation on first mount (minimal — a class that animates once).

- [ ] **Step 6: Gate + commit**

Run: `pnpm typecheck --force` and `pnpm --filter ./apps/user-client exec vitest run tests/compaction` and `pnpm --filter ./apps/user-client exec biome check src/components/chat`
```bash
git add apps/user-client/src/components/chat/CompactionMarker.tsx apps/user-client/src/components/chat/CompactionDrawer.tsx apps/user-client/src/components/chat/ChatStream.tsx apps/user-client/tests/compaction/compaction-marker.test.tsx
git commit -m "Add compaction marker pill and read-only snapshot drawer

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 12: full gate + device-verification handoff

**Files:** none (verification only).

- [ ] **Step 1: Run the full gate**

Run: `pnpm typecheck --force`
Expected: green (14/14 packages or the project's current count).

Run: `pnpm --filter ./apps/user-client exec vitest run`
Expected: the **8 Node-localStorage baseline** failures and nothing else new. Investigate any 9th.

Run: `pnpm --filter ./apps/user-client exec biome check`
Expected: clean (no `!`, no unused).

- [ ] **Step 2: Summon Laura (pre-squash UX pass)**

Per spec §13, summon Laura on the built diff to verify the flow honours the spec-pass intent (gauge-as-trigger reachable, disabled-with-tooltip below threshold, marker tappable, drawer read-only with the refresh line, block-and-compact has live motion + recovery). Fix any HARD finding; log conscious soft deferrals in `obsidian/insights/ux-deferrals.md`.

- [ ] **Step 3: Hand the device checklist to Chris**

Present spec §12 (Manual verification) for Chris to run on device — especially: 80 % toast fires once and survives reload; gauge tap → confirm (reassurance line) → marker; background valve past 90 %; block-and-compact on a huge paste with recovery; re-compact folds "Previous Story"; Reading Mode shows all originals; tool-result turn loses raw output but keeps the conclusion. The model-loop ("summary actually used next turn") is device-verified, not mock-asserted.

- [ ] **Step 4: Squash + STATUS update** (Liz only — not a subagent step)

After device-verification, squash to one feature commit, update `obsidian/STATUS-CLIENT-ONLY.md` (Current + Next), and close the build.

---

## Self-Review

**Spec coverage:** §1 motivation → whole plan. §3 three layers → Tasks 8 (Layer 2), 9 (Layer 3), 10 (Layer 1). §4 summary/tail/validation → Tasks 2, 3, 6. §4.5 source truncation → Task 6 source-budget loop. §5 orthogonality (raw messages kept, slice-not-delete) → Task 7 (slices `priorMessages`, never deletes `db.messages`). §6 injection + re-compact "Previous Story" → Tasks 3, 6, 7. §7 data model + v29 + verno sweep → Task 1. §8 UI (gauge, toast, marker via `Pill`, read-only drawer + refresh line) → Tasks 10, 11. §9 code home → all new files under `src/compaction/`. §10 deferred edit → not built (correct). §11 tests → per-task TDD + Task 12. §12 manual verification → Task 12. §13 Laura pre-squash → Task 12; no Larissa → respected.

**Placeholder scan:** Three `> NOTE` items point the implementer to confirm an existing symbol (ContentBlock union, Offering id field, QK chat key, Markdown renderer name) before use — these are real existing symbols, grounded with the exact `rg` to run, not invented placeholders. All code steps show complete code.

**Type consistency:** `CompactionCheckpointRow` fields identical across Tasks 1/5/6/7/11. `runCompaction` returns `CompactionCheckpointRow | null` consistently (Tasks 6/8/10). `applyActiveCompaction` signature identical in Tasks 7/8. `SourceMessage` defined once (Task 3), consumed in Task 6. Config constant names identical across Tasks 2/4/6/9.
