# Memory improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tune the memory pipeline, give personas an active `write_memory_entry` tool, sort the Circle by last interaction, and carry the auto-greeting into the system prompt.

**Architecture:** Six independent tasks over the existing client memory subsystem, the llm-unified prompt builder, and the user-client send path. Tasks 1–4 touch memory; Task 5 touches the prompt builder + stream engine; Task 6 touches the persona data model + Circle. Each task is self-contained and ends with a green test cycle.

**Tech Stack:** TypeScript (strict), Vitest, Dexie (IndexedDB), TanStack Query, React 18, Turborepo/pnpm.

## Global Constraints

- **British English everywhere** in code, comments, copy, commit messages (CLAUDE.md §3.7).
- **TypeScript strict**, `noUncheckedIndexedAccess`; no `any` without an inline justification (CLAUDE.md §10).
- **No `!` non-null assertion** — Biome bans it (pre-commit). Use explicit guards.
- **Quality gate is `pnpm typecheck --force`** (Turbo caches typecheck; force it) plus the relevant Vitest run. Run both yourself before committing — pre-commit runs Biome only.
- **Vitest baseline is 8 Node-localStorage failures** — expect exactly 8 pre-existing failures in the full user-client run; a 9th is real.
- **No `useLiveQuery`** in this project — background writes refresh the UI via explicit `queryClient.invalidateQueries`.
- **Subagents never merge, push, or switch branches.** Commit on the current branch only.
- Spec: `superpowers/specs/2026-06-21-memory-improvements-design.md`.

---

### Task 1: Lower the auto-consolidation thresholds

**Files:**
- Modify: `apps/user-client/src/memory/config.ts:7,9`
- Test: `apps/user-client/tests/memory/pipeline.test.ts` (verify only)

**Interfaces:**
- Produces: `AUTO_COMMIT_THRESHOLD = 10`, `DREAM_THRESHOLD = 12` (unchanged names/types).

- [ ] **Step 1: Edit the constants**

In `config.ts` change:
```ts
export const AUTO_COMMIT_THRESHOLD = 10;
// ...
export const DREAM_THRESHOLD = 12;
```
Leave `EXTRACTION_MIN_NEW_MESSAGES`, `EXTRACTION_WINDOW_CAP`, `UNCOMMITTED_CAP`, `AUTO_COMMIT_KEEP_RECENT`, the token caps, and the "Tunable after device testing" comment untouched.

- [ ] **Step 2: Verify the pipeline tests read the constants (no hard-coded 15/20)**

Run: `cd apps/user-client && pnpm vitest run tests/memory/pipeline.test.ts`
Expected: PASS. `pipeline.test.ts` loops to `DREAM_THRESHOLD`/`AUTO_COMMIT_THRESHOLD` imported from `config`, so the new values flow through automatically. If any assertion hard-codes `15` or `20`, change it to import and reference the constant.

- [ ] **Step 3: Typecheck**

Run: `cd apps/user-client && pnpm typecheck --force`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/memory/config.ts
git commit -m "Lower memory auto-commit and dream thresholds to 10/12"
```

---

### Task 2: Feed memoryInstructions into extraction

**Files:**
- Modify: `apps/user-client/src/memory/extraction-prompt.ts:46`
- Modify: `apps/user-client/src/memory/pipeline.ts:97-101`
- Test: `apps/user-client/tests/memory/extraction-prompt.test.ts`

**Interfaces:**
- Produces: `buildExtractionPrompt(input: { memoryBody: string | null; journalEntries: string[]; messages: string[]; userGuidance?: string }): string`.

- [ ] **Step 1: Write the failing test**

Add to `tests/memory/extraction-prompt.test.ts`:
```ts
import { buildExtractionPrompt } from '../../src/memory/extraction-prompt.js';

it('renders a User Guidance section before the messages when guidance is given', () => {
  const out = buildExtractionPrompt({
    memoryBody: null,
    journalEntries: [],
    messages: ['I love sci-fi novels.'],
    userGuidance: 'my reading tastes',
  });
  expect(out).toContain('## User Guidance');
  expect(out).toContain('The user has asked you to focus on: my reading tastes');
  expect(out.indexOf('## User Guidance')).toBeLessThan(out.indexOf('## User Messages to Process'));
});

it('omits the User Guidance section when guidance is empty or absent', () => {
  const withEmpty = buildExtractionPrompt({ memoryBody: null, journalEntries: [], messages: ['x'], userGuidance: '   ' });
  const without = buildExtractionPrompt({ memoryBody: null, journalEntries: [], messages: ['x'] });
  expect(withEmpty).not.toContain('## User Guidance');
  expect(without).not.toContain('## User Guidance');
  expect(withEmpty).toBe(without);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/memory/extraction-prompt.test.ts`
Expected: FAIL — "## User Guidance" not found.

- [ ] **Step 3: Implement the guidance section**

In `extraction-prompt.ts`, extend the input type and render the section. Insert after the journal-entries block and before `## User Messages to Process`:
```ts
export function buildExtractionPrompt(input: {
  memoryBody: string | null;
  journalEntries: string[];
  messages: string[];
  userGuidance?: string;
}): string {
  const parts: string[] = [EXTRACTION_INSTRUCTIONS, ''];
  // ... existing Existing Memory + Existing Journal Entries blocks unchanged ...

  if (input.userGuidance?.trim()) {
    parts.push('## User Guidance');
    parts.push(`The user has asked you to focus on: ${input.userGuidance.trim()}.`);
    parts.push('');
  }

  parts.push('## User Messages to Process');
  // ... unchanged tail ...
}
```

- [ ] **Step 4: Pass memoryInstructions from the pipeline**

In `pipeline.ts`, in `runExtraction`, add `userGuidance` to the `buildExtractionPrompt` call:
```ts
const system = buildExtractionPrompt({
  memoryBody: body?.content ?? null,
  journalEntries: existing.map((e) => e.content),
  messages: cleaned,
  userGuidance: args.persona.memoryInstructions ?? '',
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/user-client && pnpm vitest run tests/memory/extraction-prompt.test.ts tests/memory/pipeline.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `cd apps/user-client && pnpm typecheck --force`
```bash
git add apps/user-client/src/memory/extraction-prompt.ts apps/user-client/src/memory/pipeline.ts apps/user-client/tests/memory/extraction-prompt.test.ts
git commit -m "Steer memory extraction with the persona's memoryInstructions"
```

---

### Task 3: The write_memory_entry tool

**Files:**
- Create: `apps/user-client/src/tools/write-memory.ts`
- Modify: `apps/user-client/src/tools/registry.ts:30-56`
- Test: `apps/user-client/tests/tools/write-memory.test.ts` (new)

**Interfaces:**
- Consumes: `addJournalEntries(personaId, entries)` and `listJournal(personaId, state?)` from `../memory/repo.js`; `Tool`, `ToolResult` from `./types.js`.
- Produces:
  - `interface MemoryToolContext { personaId: string; onWritten?: () => void }`
  - `function contributeMemoryTool(ctx: MemoryToolContext): Tool[]`
  - `resolveActiveTools(ctx, knowledge?, expert?, mcp?, images?, memory?: MemoryToolContext | null): Tool[]` — new trailing `memory` param.

- [ ] **Step 1: Write the failing test**

Create `tests/tools/write-memory.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { contributeMemoryTool } from '../../src/tools/write-memory.js';
import * as repo from '../../src/memory/repo.js';

describe('write_memory_entry', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('writes one uncommitted entry and fires onWritten on success', async () => {
    const add = vi.spyOn(repo, 'addJournalEntries').mockResolvedValue([{ id: 'e1' } as never]);
    vi.spyOn(repo, 'listJournal').mockResolvedValue([]);
    const onWritten = vi.fn();
    const [tool] = contributeMemoryTool({ personaId: 'p1', onWritten });
    const res = await tool.execute({ content: 'User has a cat named Mochi.' });
    expect(res.ok).toBe(true);
    expect(add).toHaveBeenCalledWith('p1', [
      { content: 'User has a cat named Mochi.', category: 'fact', isCorrection: false },
    ]);
    expect(onWritten).toHaveBeenCalledTimes(1);
  });

  it('marks corrections with category correction and isCorrection true', async () => {
    const add = vi.spyOn(repo, 'addJournalEntries').mockResolvedValue([{ id: 'e2' } as never]);
    vi.spyOn(repo, 'listJournal').mockResolvedValue([]);
    const [tool] = contributeMemoryTool({ personaId: 'p1' });
    await tool.execute({ content: 'User now prefers tea, not coffee.', correction: true });
    expect(add).toHaveBeenCalledWith('p1', [
      { content: 'User now prefers tea, not coffee.', category: 'correction', isCorrection: true },
    ]);
  });

  it('skips an exact case-insensitive duplicate without writing', async () => {
    const add = vi.spyOn(repo, 'addJournalEntries').mockResolvedValue([]);
    vi.spyOn(repo, 'listJournal').mockResolvedValue([
      { content: 'User has a cat named Mochi.', state: 'committed' } as never,
    ]);
    const onWritten = vi.fn();
    const [tool] = contributeMemoryTool({ personaId: 'p1', onWritten });
    const res = await tool.execute({ content: '  user has a CAT named mochi. ' });
    expect(res.ok).toBe(true);
    expect(res.output).toContain('Already remembered');
    expect(add).not.toHaveBeenCalled();
    expect(onWritten).not.toHaveBeenCalled();
  });

  it('fails cleanly on empty content', async () => {
    const [tool] = contributeMemoryTool({ personaId: 'p1' });
    const res = await tool.execute({ content: '   ' });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/tools/write-memory.test.ts`
Expected: FAIL — cannot find module `write-memory.js`.

- [ ] **Step 3: Implement the tool**

Create `src/tools/write-memory.ts`:
```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { addJournalEntries, listJournal } from '../memory/repo.js';
import type { Tool, ToolResult } from './types.js';

/** Context for the write_memory_entry tool: which persona owns the memory, and
 *  an optional hook to refresh the Memory Page after a successful write. */
export interface MemoryToolContext {
  personaId: string;
  /** Invoked after a successful write so the caller can invalidate the
   *  Memory-Page journal query (no useLiveQuery in this project). */
  onWritten?: () => void;
}

const SYSTEM_INSTRUCTION =
  'You keep a long-term memory of the user. When they share a lasting fact, ' +
  'preference, or correction worth remembering, you may call write_memory_entry ' +
  'to save it. Do not save momentary states or one-off requests.';

/** The active write_memory_entry tool for a persona that has memory enabled. */
export function contributeMemoryTool(ctx: MemoryToolContext): Tool[] {
  const tool: Tool = {
    name: 'write_memory_entry',
    description:
      'Save a durable fact, preference, or correction about the user to your ' +
      'long-term memory, so you still know it in future conversations. Use it ' +
      'when the user shares something lasting and worth remembering — not for ' +
      'momentary states or one-off requests.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The fact or preference to remember, as a short self-contained statement.',
        },
        correction: {
          type: 'boolean',
          description: 'True if this corrects or replaces something already known about the user.',
        },
      },
      required: ['content'],
    },
    systemPromptInstruction: SYSTEM_INSTRUCTION,
    async execute(args): Promise<ToolResult> {
      const raw = typeof args.content === 'string' ? args.content.trim() : '';
      if (!raw) return { ok: false, output: '', error: 'Nothing to remember.' };
      const correction = args.correction === true;

      const existing = (await listJournal(ctx.personaId)).filter((e) => e.state !== 'archived');
      const key = raw.toLowerCase();
      if (existing.some((e) => e.content.trim().toLowerCase() === key)) {
        return { ok: true, output: 'Already remembered.', error: null };
      }

      const [row] = await addJournalEntries(ctx.personaId, [
        { content: raw, category: correction ? 'correction' : 'fact', isCorrection: correction },
      ]);
      ctx.onWritten?.();
      return { ok: true, output: 'Saved to memory.', error: null, meta: { entryId: row?.id } };
    },
  };
  return [tool];
}
```

> Note: confirm the `ExtractedEntry` shape `addJournalEntries` expects is `{ content: string; category: string; isCorrection: boolean }` (it is, per `repo.ts:43-46`). Match it exactly.

- [ ] **Step 4: Wire the tool into the registry**

In `tools/registry.ts`, import and add the trailing param:
```ts
import { type MemoryToolContext, contributeMemoryTool } from './write-memory.js';

export function resolveActiveTools(
  ctx: IntegrationContext,
  knowledge: KnowledgeContext | null = null,
  expert: ExpertToolContext | null = null,
  mcp: McpToolContext | null = null,
  images: ImageToolContext | null = null,
  memory: MemoryToolContext | null = null,
): Tool[] {
  return [
    ...STATIC_TOOLS,
    ...INTEGRATIONS.flatMap((i) => i.contributesTools(ctx)),
    ...(knowledge ? contributeKnowledgeTools(knowledge) : []),
    ...(expert ? [createAskExpertTool(/* unchanged */)] : []),
    ...(mcp ? contributeMcpTools(mcp) : []),
    ...(images ? contributeImageTool(images) : []),
    ...(memory ? contributeMemoryTool(memory) : []),
  ];
}
```
Leave the existing `createAskExpertTool(...)` argument list exactly as it is.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/user-client && pnpm vitest run tests/tools/write-memory.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `cd apps/user-client && pnpm typecheck --force`
```bash
git add apps/user-client/src/tools/write-memory.ts apps/user-client/src/tools/registry.ts apps/user-client/tests/tools/write-memory.test.ts
git commit -m "Add write_memory_entry tool for active persona recall"
```

---

### Task 4: Wire the memory tool into the send path

**Files:**
- Modify: `apps/user-client/src/state/stream-manager.store.ts:610-651` (the `runIntoDraft` tool-resolution block)
- Verify: existing memory query key `QK.memory(personaId)` (`src/data/queryKeys.ts:30`)

**Interfaces:**
- Consumes: `resolveActiveTools(..., memory)` from Task 3; `QK.memory(personaId)`.

- [ ] **Step 1: Build the memory context when memory is enabled**

In `runIntoDraft` (around the `resolveActiveTools` call at line 649), build a `memory` context gated on the persona toggle and pass it as the sixth argument:
```ts
const memoryCtx = (args.persona.useMemory ?? true)
  ? {
      personaId: args.persona.id,
      onWritten: () =>
        void queryClient.invalidateQueries({ queryKey: QK.memory(args.persona.id) }),
    }
  : null;

const tools = toolsActive
  ? resolveActiveTools(integrationCtx, knowledge, expert, args.mcp ?? null, args.images ?? null, memoryCtx)
  : /* existing else-branch unchanged */;
```
`QK` is already imported in this file (used at line 161). `queryClient` is the module-level client used throughout the file.

- [ ] **Step 2: Typecheck**

Run: `cd apps/user-client && pnpm typecheck --force`
Expected: clean.

- [ ] **Step 3: Run the streaming + memory test suites for regressions**

Run: `cd apps/user-client && pnpm vitest run tests/memory tests/tools`
Expected: PASS (plus the global 8-failure baseline only shows in the full run, not here).

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/state/stream-manager.store.ts
git commit -m "Offer write_memory_entry on sends when persona memory is on"
```

> Manual verification (device): a persona with memory on, asked to remember something, produces a `write_memory_entry` pill and a pending entry on the Memory Page; a persona with memory off never offers the tool.

---

### Task 5: Carry the opener into the system prompt

**Files:**
- Modify: `packages/llm-unified/src/composition.ts:18-48,50-63,86-147`
- Test: `packages/llm-unified/src/composition.test.ts`
- Modify: `apps/user-client/src/lib/stream-engine.ts:76-97,197-209`
- Test: `apps/user-client/tests/lib/stream-engine-opener.test.ts` (new)

**Interfaces:**
- Produces:
  - `BuildPromptInputs.openerContext?: string`
  - new `SegmentId 'openerEcho'`, Band 2, chat-only.
  - `resolveOpenerContext(priorMessages: MessageRow[], job: 'chat' | 'greeting'): string` exported from `stream-engine.ts`.

- [ ] **Step 1: Write the failing composition test**

Add to `packages/llm-unified/src/composition.test.ts` (reuse the file's existing `baseInputs` helper if present; otherwise build a minimal inputs object with non-empty `personaInstructions`):
```ts
it('echoes the opener in Band 2 on a chat job when openerContext is set', () => {
  const out = buildPrompt({ ...baseInputs, openerContext: 'Hello, traveller. I am glad you came.' }, 'chat');
  expect(out).toContain('You opened this conversation by greeting the user');
  expect(out).toContain('Hello, traveller. I am glad you came.');
});

it('omits the opener echo on greeting and title jobs', () => {
  expect(buildPrompt({ ...baseInputs, openerContext: 'Hi.' }, 'greeting')).not.toContain('You opened this conversation');
  expect(buildPrompt({ ...baseInputs, openerContext: 'Hi.' }, 'title')).not.toContain('You opened this conversation');
});

it('omits the opener echo when openerContext is empty', () => {
  expect(buildPrompt({ ...baseInputs, openerContext: '' }, 'chat')).not.toContain('You opened this conversation');
});
```
If the existing tests construct inputs inline (no `baseInputs`), add `openerContext: ''` to those literals so they still typecheck once the field exists — but make the field optional so this is not required.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && pnpm vitest run src/composition.test.ts`
Expected: FAIL — echo text not found.

- [ ] **Step 3: Implement the segment**

In `composition.ts`:
1. Add to `BuildPromptInputs`:
```ts
  /** Band-2 opener echo (chat only): the greeting the model already "spoke",
   *  which is never in wire history. Empty when no opener exists. */
  openerContext?: string;
```
2. Add `'openerEcho'` to the `SegmentId` union.
3. Insert the segment into `SEGMENTS` immediately after `memories` (order 2), and bump `lore` to order 4 and `knowledgeLibraries` to order 5:
```ts
  { id: 'memories', band: 2, order: 2, jobs: CHAT_ONLY, resolve: (i) => i.memoryContext },
  {
    id: 'openerEcho',
    band: 2,
    order: 3,
    jobs: CHAT_ONLY,
    resolve: (i) =>
      i.openerContext?.trim()
        ? `You opened this conversation by greeting the user. You said:\n\n"${i.openerContext.trim()}"\n\nThe user has already seen this greeting — continue naturally from it.`
        : '',
  },
  { id: 'lore', band: 2, order: 4, jobs: CHAT_ONLY, resolve: (i) => i.loreContext ?? '' },
  { id: 'knowledgeLibraries', band: 2, order: 5, jobs: CHAT_ONLY, resolve: (i) => i.knowledgeLibrariesContext ?? '' },
```

- [ ] **Step 4: Run composition test to verify it passes**

Run: `cd packages/llm-unified && pnpm vitest run src/composition.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing stream-engine helper test**

Create `apps/user-client/tests/lib/stream-engine-opener.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { resolveOpenerContext } from '../../src/lib/stream-engine.js';
import type { MessageRow } from '../../src/boot/client-data-db.js';

const opener = (text: string): MessageRow =>
  ({ role: 'persona', kind: 'opener', contentBlocks: [{ type: 'text', text }] } as MessageRow);
const userMsg = (text: string): MessageRow =>
  ({ role: 'user', contentBlocks: [{ type: 'text', text }] } as MessageRow);

describe('resolveOpenerContext', () => {
  it('returns the opener text for a chat job', () => {
    expect(resolveOpenerContext([opener('Welcome.'), userMsg('hi')], 'chat')).toBe('Welcome.');
  });
  it('returns empty for a greeting job', () => {
    expect(resolveOpenerContext([opener('Welcome.')], 'greeting')).toBe('');
  });
  it('returns empty when there is no opener', () => {
    expect(resolveOpenerContext([userMsg('hi')], 'chat')).toBe('');
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/lib/stream-engine-opener.test.ts`
Expected: FAIL — `resolveOpenerContext` not exported.

- [ ] **Step 7: Implement and wire in stream-engine.ts**

Add the exported helper and pass `openerContext` into `buildPrompt`:
```ts
/** The opener's plaintext for the system-prompt echo. Empty unless this is a
 *  chat job and a kind:'opener' message exists in history (it is never in the
 *  wire history, so the echo is the model's only continuity with it). */
export function resolveOpenerContext(
  priorMessages: MessageRow[],
  job: 'chat' | 'greeting',
): string {
  if (job !== 'chat') return '';
  const opener = priorMessages.find((m) => m.kind === 'opener');
  return opener ? flattenAnswerText(opener.contentBlocks) : '';
}
```
In `runStreamEngine`, add to the `buildPrompt` inputs object:
```ts
      openerContext: resolveOpenerContext(args.priorMessages, args.job ?? 'chat'),
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd apps/user-client && pnpm vitest run tests/lib/stream-engine-opener.test.ts`
Expected: PASS. Then `cd packages/llm-unified && pnpm vitest run src/composition.test.ts` — PASS.

- [ ] **Step 9: Typecheck both packages + commit**

Run: `cd /home/chris/workspace/chatsundere && pnpm typecheck --force`
Expected: clean (llm-unified + user-client).
```bash
git add packages/llm-unified/src/composition.ts packages/llm-unified/src/composition.test.ts apps/user-client/src/lib/stream-engine.ts apps/user-client/tests/lib/stream-engine-opener.test.ts
git commit -m "Echo the persona's opener into the chat system prompt"
```

---

### Task 6: Sort the Circle by last interaction

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts` (PersonaRow + new `version(28)`)
- Modify: `apps/user-client/src/data/personas.ts` (export comparator)
- Modify: `apps/user-client/src/state/stream-manager.store.ts:268-275` (set `lastInteractionAt` on send + invalidate)
- Modify: `apps/user-client/src/routes/app/circle.tsx` (apply the sort)
- Test: `apps/user-client/tests/data/personas-lru.test.ts` (new)

**Interfaces:**
- Produces:
  - `PersonaRow.lastInteractionAt?: number`
  - `compareByLastInteraction(a: PersonaRow, b: PersonaRow): number` exported from `data/personas.ts` (descending: most-recent first).

- [ ] **Step 1: Write the failing comparator test**

Create `tests/data/personas-lru.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { compareByLastInteraction } from '../../src/data/personas.js';
import type { PersonaRow } from '../../src/boot/client-data-db.js';

const p = (id: string, createdAt: number, lastInteractionAt?: number): PersonaRow =>
  ({ id, createdAt, lastInteractionAt } as PersonaRow);

describe('compareByLastInteraction', () => {
  it('orders most-recently-interacted first', () => {
    const list = [p('a', 100, 500), p('b', 200, 900), p('c', 300, 700)];
    expect(list.slice().sort(compareByLastInteraction).map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });
  it('falls back to createdAt when lastInteractionAt is unset', () => {
    const list = [p('old', 100), p('new', 400), p('used', 200, 999)];
    expect(list.slice().sort(compareByLastInteraction).map((x) => x.id)).toEqual(['used', 'new', 'old']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/user-client && pnpm vitest run tests/data/personas-lru.test.ts`
Expected: FAIL — `compareByLastInteraction` not exported.

- [ ] **Step 3: Add the field + comparator**

In `client-data-db.ts`, add to `PersonaRow` (near `useMemory`/`memoryInstructions`):
```ts
  /** Last time the user actually sent a message to this persona (any chat).
   *  Drives Circle ordering. The auto-opener does NOT update it. */
  lastInteractionAt?: number;
```
In `data/personas.ts`, add:
```ts
/** Descending order for the Circle: most-recently-interacted persona first.
 *  Falls back to createdAt for personas never messaged. */
export function compareByLastInteraction(a: PersonaRow, b: PersonaRow): number {
  return (b.lastInteractionAt ?? b.createdAt) - (a.lastInteractionAt ?? a.createdAt);
}
```

- [ ] **Step 4: Run comparator test to verify it passes**

Run: `cd apps/user-client && pnpm vitest run tests/data/personas-lru.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the Dexie v28 migration with backfill**

In `client-data-db.ts`, after the `version(27)` block, add (keep the stores string identical to v27 — no index change; `lastInteractionAt` is not indexed):
```ts
this.version(28)
  .stores({
    /* copy the EXACT stores object from version(27) verbatim — unchanged */
  })
  .upgrade(async (tx) => {
    const personas = await tx.table('personas').toArray();
    for (const persona of personas) {
      const chats = await tx.table('chats').where('personaId').equals(persona.id).toArray();
      const maxChat = chats.reduce((max, c) => Math.max(max, c.lastMessageAt ?? 0), 0);
      await tx.table('personas').update(persona.id, {
        lastInteractionAt: maxChat > 0 ? maxChat : persona.createdAt,
      });
    }
  });
```
> Copy the `.stores({...})` object literally from the `version(27)` definition so no table/index is accidentally dropped. The only change in v28 is the upgrade backfill.

- [ ] **Step 6: Set lastInteractionAt on a real send**

In `stream-manager.store.ts`, the `send` action's transaction (lines ~268-275): add `db.personas` to the transaction table list, set the timestamp, and invalidate the personas query after the transaction.
```ts
await db.transaction('rw', db.messages, db.chats, db.personas, /* existing tables... */, async () => {
  // ... existing attachment + snapshot logic unchanged ...
  await db.chats.update(args.chatId, { lastMessageAt: now + 1, draftInput: '', openerPending: false });
  await db.personas.update(args.persona.id, { lastInteractionAt: now + 1 });
});
void queryClient.invalidateQueries({ queryKey: QK.personas });
```
Do NOT touch `startOpener`/`runOpenerStream` — the opener must never bump `lastInteractionAt`. Confirm the exact existing transaction table list and preserve every table already in it.

- [ ] **Step 7: Apply the sort in the Circle**

In `routes/app/circle.tsx`, after reading personas from `useFilteredPersonas`, sort a copy with the comparator before rendering:
```ts
import { compareByLastInteraction, useFilteredPersonas } from '../../data/personas.js';
// ...
const personas = (personasQuery.data ?? []).slice().sort(compareByLastInteraction);
```
Match the file's actual variable names — read the current `circle.tsx` first and adapt. Only the Circle is reordered; Treasury/History/Entrance-Hall/Artefact-Picker keep `useFilteredPersonas`'s `createdAt` order.

- [ ] **Step 8: Run the suites + typecheck**

Run: `cd apps/user-client && pnpm vitest run tests/data/personas-lru.test.ts tests/data/use-filtered-personas.test.tsx tests/routes/circle.fab-icon.test.tsx`
Expected: PASS.
Run: `cd apps/user-client && pnpm typecheck --force`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/src/data/personas.ts apps/user-client/src/state/stream-manager.store.ts apps/user-client/src/routes/app/circle.tsx apps/user-client/tests/data/personas-lru.test.ts
git commit -m "Sort the Circle by last interaction, not last opened"
```

> Manual verification (device): open a fresh persona (opener only) — it does not jump to the top of the Circle; send a message to another persona — it moves to the top.

---

## Final gate (after all tasks)

- [ ] `cd /home/chris/workspace/chatsundere && pnpm typecheck --force` — clean across llm-unified + user-client.
- [ ] `cd apps/user-client && pnpm vitest run` — full suite at the **8 Node-localStorage baseline** (a 9th failure is real).
- [ ] Summon **Laura** (pre-squash UX pass — points 3/4/5 alter user-reachable behaviour).
- [ ] Squash into one feature-unit commit; do **not** push unless Chris says so.
- [ ] Update `obsidian/STATUS-CLIENT-ONLY.md` (move these tuning follow-ups to Done; refresh Last-updated + Next-session).

## Self-review notes

- **Spec coverage:** Point 1 → Task 1; Point 2 → Task 2; Point 3 → Tasks 3+4; Point 4 → Task 6; Point 5 → Task 5. All five covered.
- **Type consistency:** `MemoryToolContext` defined in Task 3, consumed in Task 4; `compareByLastInteraction` defined and consumed in Task 6; `resolveOpenerContext`/`openerContext` defined in Task 5 composition and consumed in stream-engine — names match across tasks.
- **Order:** Task 3 (tool) precedes Task 4 (wiring); Task 5 composition precedes its stream-engine consumer — topological over the import graph.
