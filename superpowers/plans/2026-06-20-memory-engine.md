# Memory Engine Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the client-side, volume-triggered long-term memory *engine* (data model, extraction, commit, dreaming, retrieval injection, post-send orchestration) — a working, testable memory pipeline with no UI of its own.

**Architecture:** A faithful TypeScript/Dexie port of chatsune's `extraction → uncommitted → committed → dreaming → body` pipeline. All stages run in the background after an assistant message finishes streaming (`stream-manager.store.ts`), gated on volume thresholds, guarded by a per-persona in-memory mutex. Extraction and dreaming reuse the persona's own offering via `runOneShotCompletion` (the title-generation pattern). Retrieval injects the whole consolidated body + journal as a `<usermemory>` block through the existing-but-empty `memoryContext` slot of `buildPrompt`.

**Tech Stack:** TypeScript (strict), Dexie/IndexedDB, `@chatsundere/llm-unified` (`runOneShotCompletion`, `offeringToTarget`, `buildPrompt`), Vitest + `fake-indexeddb`, `uuidv7`.

## Global Constraints

- **British English** in every identifier, comment, log string, and prompt text (CLAUDE.md §3.7). The ported chatsune prompts are kept faithful but spelled British.
- **TypeScript strict**, `noUncheckedIndexedAccess: true`. **No `any`** without an inline justification. **No non-null assertions (`!`)** — Biome bans them ([[project_commit_gate_mechanics]]); use `?? default`, optional chaining, and `.at(-1)`.
- **Background LLM calls go only through `runOneShotCompletion` + `offeringToTarget`** — never hand-built request bodies. Raw bodies silently break reasoning models ([[project_background_jobs_need_adapter_path]]).
- **Tests live under `apps/user-client/tests/`**, mirroring `src/`. Pure-function tests need no DOM/IndexedDB; repo + migration tests use `fake-indexeddb/auto`.
- **No live LLM in CI** — provider keys never enter CI (CLAUDE.md §10). The pipeline's LLM boundary (`runOneShotCompletion`) is mocked in tests; real extraction/dreaming is device-verified.
- **Gate before any squash:** `pnpm typecheck --force` (run from repo root; [[feedback_turbo_caches_typecheck]]), `pnpm --filter @chatsundere/user-client test`, Biome clean. The full user-client vitest baseline is **8 Node-localStorage failures** ([[project_vitest_baseline_is_node_localstorage]]) — expect exactly 8 pre-existing, no more.
- **Memory is per-persona.** Every query is keyed by `personaId`. New persona/chat memory fields are **optional with read-time defaults** (`persona.useMemory ?? true`), matching the existing non-indexed-optional convention (`importedFrom?`, `openerPending?`).
- All new source files start with the SPDX header: `// SPDX-License-Identifier: AGPL-3.0-only`.

---

## File Structure

**New (`apps/user-client/src/memory/`):**
- `config.ts` — threshold constants
- `extraction-parse.ts` — `parseExtractionOutput`, `ExtractedEntry`
- `extraction-prompt.ts` — `EXTRACTION_INSTRUCTIONS`, `stripTechnicalContent`, `buildExtractionPrompt`
- `consolidation-prompt.ts` — `CONSOLIDATION_INSTRUCTIONS`, `buildConsolidationPrompt`, `validateMemoryBody`
- `assembly.ts` — `assembleMemoryContext`
- `dedup.ts` — `normaliseForDedup`, `dropDuplicates`
- `repo.ts` — all Dexie data access + `loadMemoryContext`
- `mutex.ts` — per-persona lock
- `pipeline.ts` — LLM wrappers + `runMemoryPipeline`

**Modified:**
- `src/boot/client-data-db.ts` — row types, persona/chat fields, tables, v27 migration
- `src/lib/stream-engine.ts` — accept + use `memoryContext`
- `src/state/stream-manager.store.ts` — assemble + pass memory context, fire the pipeline post-send
- ~22 `tests/boot/**` + `tests/unit/**` files — bump `verno).toBe(26)` → `27`

**New tests (`apps/user-client/tests/memory/` + `tests/boot/`):** one per module, plus `client-data-db-v27.test.ts`.

---

### Task 1: Dexie v27 — memory tables, persona/chat fields, migration

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts`
- Create: `apps/user-client/tests/boot/client-data-db-v27.test.ts`
- Modify: ~22 test files asserting head verno (mechanical bump)

**Interfaces:**
- Produces: `MemoryJournalRow`, `MemoryBodyRow`, `MemoryCategory`, `MemoryJournalState`, `MemoryBodySource` (exported types); `db.memoryJournal`, `db.memoryBody` tables; optional `PersonaRow.{useMemory,memoryInstructions,lastViewedMemoryBodyVersion,memoryIntroShown}` and `ChatRow.lastExtractedMessageId`.

- [ ] **Step 1: Write the failing migration test**

Create `apps/user-client/tests/boot/client-data-db-v27.test.ts` (mirrors the v24 test's plant-old-DB pattern; `V26_STORES` is the full store set at v26 — copy from the v24 test's `V23_STORES` which is unchanged through v26):

```ts
// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

/** Store definitions present at v26 (no store changes since voiceAudio in v21). */
const V26_STORES = {
  settings: 'id',
  providers: 'id, templateId, enabled',
  mindspaces: 'id, builtIn, displayName',
  personas: 'id, providerId',
  chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
  messages: 'id, chatId, [chatId+createdAt]',
  pills: 'id, messageId',
  personaAvatars: 'personaId',
  attachments: 'id, chatId, messageId, [chatId+messageId]',
  artefacts: 'id, chatId, personaId, favourite, [chatId+createdAt]',
  libraries: 'id, name, nsfw',
  documents: 'id, libraryId, embeddingStatus, [libraryId+createdAt]',
  mcpServers: 'id, createdAt',
  voiceAudio: 'key, lastUsedAt',
} as const;

async function plantV26WithPersonaAndChat(): Promise<void> {
  const db = new Dexie('chatsundere_client_data');
  for (let v = 1; v <= 26; v++) db.version(v).stores(V26_STORES);
  await db.open();
  await db.table('personas').add({ id: 'p1', name: 'P', providerId: 'pr1' });
  await db.table('chats').add({ id: 'c1', personaId: 'p1', lastMessageAt: 1 });
  db.close();
}

describe('client-data-db v27 (memory tables + persona/chat fields)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('opens at verno 27 on a fresh install with the two memory tables', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    expect(db.verno).toBe(27);
    await expect(db.memoryJournal.count()).resolves.toBe(0);
    await expect(db.memoryBody.count()).resolves.toBe(0);
  });

  it('on upgrade from v26: backfills persona + chat memory fields', async () => {
    await plantV26WithPersonaAndChat();
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();
    const db = getClientDataDb();
    expect(db.verno).toBe(27);
    const persona = await db.personas.get('p1');
    expect(persona?.useMemory).toBe(true);
    expect(persona?.memoryInstructions).toBe('');
    expect(persona?.lastViewedMemoryBodyVersion).toBe(0);
    expect(persona?.memoryIntroShown).toBe(false);
    const chat = await db.chats.get('c1');
    expect(chat?.lastExtractedMessageId).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @chatsundere/user-client test client-data-db-v27`
Expected: FAIL (`db.memoryJournal` is undefined / verno is 26).

- [ ] **Step 3: Add the row types** (after `DocumentRow`, before `// ===== Dexie subclass =====` at `client-data-db.ts:377`)

```ts
export type MemoryCategory = 'preference' | 'fact' | 'correction' | 'goal' | 'context';
export type MemoryJournalState = 'uncommitted' | 'committed' | 'archived';

/** One extracted memory fact. Lifecycle: uncommitted → committed → archived
 *  (the latter once a dream has folded it into a `memoryBody` version). */
export interface MemoryJournalRow {
  id: string;
  personaId: string;
  content: string;
  category: MemoryCategory | null;
  state: MemoryJournalState;
  isCorrection: boolean;
  createdAt: number;
  committedAt: number | null;
  autoCommitted: boolean;
  archivedByDreamId: string | null;
  /** Chatsune origin marker (memory import idempotency, Plan 3). Absent for natives. */
  importedFrom?: string;
}

export type MemoryBodySource = 'dream' | 'manual' | 'import';

/** A consolidated, free-prose memory body version for one persona. Max 5 kept. */
export interface MemoryBodyRow {
  id: string;
  personaId: string;
  content: string;
  tokenCount: number;
  version: number;
  entriesProcessed: number;
  createdAt: number;
  source: MemoryBodySource;
}
```

- [ ] **Step 4: Add the optional persona + chat fields**

In `PersonaRow` (before `createdAt` at `client-data-db.ts:176`):

```ts
  /** Long-term memory enabled for this persona. Absent ⇒ true (resolve with `?? true`). */
  useMemory?: boolean;
  /** User-authored guidance on what to remember. Absent ⇒ '' . */
  memoryInstructions?: string;
  /** Highest memory-body version the user has viewed; drives the Cockpit active-state (Plan 2). Absent ⇒ 0. */
  lastViewedMemoryBodyVersion?: number;
  /** One-shot "starting to remember you" note already shown. Absent ⇒ false. */
  memoryIntroShown?: boolean;
```

In `ChatRow` (after `importedFrom?` at `client-data-db.ts:201`):

```ts
  /** Extraction cursor: id of the newest user message already fed to memory
   *  extraction. uuidv7 ids are time-ordered, so "newer than the cursor" is an
   *  id comparison. Absent ⇒ null (nothing extracted yet). Non-indexed. */
  lastExtractedMessageId?: string | null;
```

- [ ] **Step 5: Declare the two tables on the Dexie subclass** (after `voiceAudio!` at `client-data-db.ts:394`)

```ts
  memoryJournal!: Table<MemoryJournalRow, string>;
  memoryBody!: Table<MemoryBodyRow, string>;
```

- [ ] **Step 6: Add the v27 version** (after the `this.version(26)...` block ends at `client-data-db.ts:858`, before the closing `}` of the constructor)

```ts
    // Version 27 — long-term memory. Adds two object stores (memoryJournal,
    // memoryBody) and backfills the optional per-persona / per-chat memory
    // fields on existing rows for tidiness (reads still default via `?? `).
    this.version(27)
      .stores({
        memoryJournal: 'id, personaId, [personaId+state], [personaId+createdAt]',
        memoryBody: 'id, personaId, [personaId+version]',
      })
      .upgrade(async (tx) => {
        await tx
          .table('personas')
          .toCollection()
          .modify((p: Record<string, unknown>) => {
            if (typeof p.useMemory !== 'boolean') p.useMemory = true;
            if (typeof p.memoryInstructions !== 'string') p.memoryInstructions = '';
            if (typeof p.lastViewedMemoryBodyVersion !== 'number')
              p.lastViewedMemoryBodyVersion = 0;
            if (typeof p.memoryIntroShown !== 'boolean') p.memoryIntroShown = false;
          });
        await tx
          .table('chats')
          .toCollection()
          .modify((c: Record<string, unknown>) => {
            if (c.lastExtractedMessageId === undefined) c.lastExtractedMessageId = null;
          });
      });
```

- [ ] **Step 7: Bump the head-verno assertions in existing tests**

Run: `rg -l 'verno\).toBe\(26\)' apps/user-client/tests --type ts | xargs sed -i 's/verno).toBe(26)/verno).toBe(27)/g'`
(All `toBe(26)` occurrences in `tests/` are head-verno assertions — verified; nothing else uses 26.)

- [ ] **Step 8: Run the v27 test + the bumped tests — verify they pass**

Run: `pnpm --filter @chatsundere/user-client test client-data-db`
Expected: PASS (v27 test green; all `client-data-db-vNN` / schema tests now assert 27).

- [ ] **Step 9: Commit**

```bash
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/tests
git commit -m "Add Dexie v27 memory tables and persona/chat memory fields

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 2: Extraction output parser

**Files:**
- Create: `apps/user-client/src/memory/extraction-parse.ts`
- Test: `apps/user-client/tests/memory/extraction-parse.test.ts`

**Interfaces:**
- Consumes: `MemoryCategory` from `client-data-db.ts`.
- Produces: `ExtractedEntry { content: string; category: MemoryCategory | null; isCorrection: boolean }`; `parseExtractionOutput(raw: string | null | undefined): ExtractedEntry[]`.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { parseExtractionOutput } from '../../src/memory/extraction-parse.js';

describe('parseExtractionOutput', () => {
  it('returns [] for empty / whitespace / null input', () => {
    expect(parseExtractionOutput('')).toEqual([]);
    expect(parseExtractionOutput('   ')).toEqual([]);
    expect(parseExtractionOutput(null)).toEqual([]);
  });

  it('parses a clean JSON array', () => {
    const out = parseExtractionOutput(
      '[{"content":"User enjoys fruit tea","category":"preference","is_correction":false}]',
    );
    expect(out).toEqual([
      { content: 'User enjoys fruit tea', category: 'preference', isCorrection: false },
    ]);
  });

  it('strips a ```json fence and repairs a trailing comma', () => {
    const out = parseExtractionOutput('```json\n[{"content":"A","category":"fact"},]\n```');
    expect(out).toEqual([{ content: 'A', category: 'fact', isCorrection: false }]);
  });

  it('falls back to object-scan on a broken array', () => {
    const out = parseExtractionOutput('garbage {"content":"B","is_correction":true} trailing');
    expect(out).toEqual([{ content: 'B', category: null, isCorrection: true }]);
  });

  it('drops blank-content entries and unknown categories → null', () => {
    const out = parseExtractionOutput('[{"content":"","category":"x"},{"content":"C","category":"weird"}]');
    expect(out).toEqual([{ content: 'C', category: null, isCorrection: false }]);
  });

  it('returns [] for unparseable prose', () => {
    expect(parseExtractionOutput('I could not find anything to extract.')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @chatsundere/user-client test extraction-parse`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `apps/user-client/src/memory/extraction-parse.ts`

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { MemoryCategory } from '../boot/client-data-db.js';

/** One extracted fact, normalised from tolerant LLM JSON. */
export interface ExtractedEntry {
  content: string;
  category: MemoryCategory | null;
  isCorrection: boolean;
}

const FENCE_RE = /```(?:json)?\s*\n?([\s\S]*?)```/;
const TRAILING_COMMA_RE = /,(\s*[}\]])/g;
const OBJECT_RE = /\{[^{}]*\}/g;
const CATEGORIES: readonly string[] = ['preference', 'fact', 'correction', 'goal', 'context'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function normalise(entry: Record<string, unknown>): ExtractedEntry {
  const rawCat = entry.category;
  const category =
    typeof rawCat === 'string' && CATEGORIES.includes(rawCat) ? (rawCat as MemoryCategory) : null;
  const correction = entry.is_correction ?? entry.isCorrection ?? false;
  return {
    content: String(entry.content ?? '').trim(),
    category,
    isCorrection: Boolean(correction),
  };
}

/**
 * Parse tolerant LLM extraction output into normalised entries. Handles
 * markdown fences, trailing commas, and broken arrays (object-scan fallback).
 * Returns [] on unparseable input; drops blank-content entries.
 */
export function parseExtractionOutput(raw: string | null | undefined): ExtractedEntry[] {
  if (!raw || !raw.trim()) return [];
  let text = raw.trim();

  const fence = FENCE_RE.exec(text);
  if (fence?.[1]) text = fence[1].trim();

  const cleaned = text.replace(TRAILING_COMMA_RE, '$1');
  const collected: ExtractedEntry[] = [];
  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      for (const e of parsed) if (isRecord(e) && 'content' in e) collected.push(normalise(e));
      return collected.filter((e) => e.content !== '');
    }
    if (isRecord(parsed) && 'content' in parsed) {
      const e = normalise(parsed);
      return e.content !== '' ? [e] : [];
    }
  } catch {
    // fall through to object-scan
  }

  for (const m of text.matchAll(OBJECT_RE)) {
    const fragment = m[0].replace(TRAILING_COMMA_RE, '$1');
    try {
      const obj: unknown = JSON.parse(fragment);
      if (isRecord(obj) && 'content' in obj) collected.push(normalise(obj));
    } catch {
      // skip malformed fragment
    }
  }
  return collected.filter((e) => e.content !== '');
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @chatsundere/user-client test extraction-parse`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/memory/extraction-parse.ts apps/user-client/tests/memory/extraction-parse.test.ts
git commit -m "Add tolerant memory extraction-output parser

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 3: Extraction prompt + technical-content stripper

**Files:**
- Create: `apps/user-client/src/memory/extraction-prompt.ts`
- Test: `apps/user-client/tests/memory/extraction-prompt.test.ts`

**Interfaces:**
- Produces: `EXTRACTION_INSTRUCTIONS: string`; `stripTechnicalContent(text: string): string`; `buildExtractionPrompt(input: { memoryBody: string | null; journalEntries: string[]; messages: string[] }): string`.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  buildExtractionPrompt,
  stripTechnicalContent,
} from '../../src/memory/extraction-prompt.js';

describe('stripTechnicalContent', () => {
  it('removes fenced code but keeps surrounding prose', () => {
    const out = stripTechnicalContent('I like tea.\n```js\nconst x = 1;\n```\nAnd cats.');
    expect(out).toContain('I like tea.');
    expect(out).toContain('And cats.');
    expect(out).not.toContain('const x');
  });

  it('removes a timestamped log line', () => {
    const out = stripTechnicalContent('Note:\n2026-04-06 12:00:00 ERROR boom\nStill here.');
    expect(out).not.toContain('ERROR boom');
    expect(out).toContain('Still here.');
  });

  it('returns empty input unchanged', () => {
    expect(stripTechnicalContent('')).toBe('');
  });
});

describe('buildExtractionPrompt', () => {
  it('embeds the instructions, existing memory, journal entries, and numbered messages', () => {
    const p = buildExtractionPrompt({
      memoryBody: 'Likes tea.',
      journalEntries: ['Has a sister'],
      messages: ['I went hiking', 'My cat is called Mimi'],
    });
    expect(p).toContain('memory extraction assistant');
    expect(p).toContain('## Existing Memory');
    expect(p).toContain('Likes tea.');
    expect(p).toContain('- Has a sister');
    expect(p).toContain('[1] I went hiking');
    expect(p).toContain('[2] My cat is called Mimi');
  });

  it('shows placeholders when memory + journal are empty', () => {
    const p = buildExtractionPrompt({ memoryBody: null, journalEntries: [], messages: ['hi'] });
    expect(p).toContain('(No existing memory');
    expect(p).toContain('(None)');
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @chatsundere/user-client test extraction-prompt`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `apps/user-client/src/memory/extraction-prompt.ts`

(Faithful British-English port of chatsune `_extraction.py:15-174`.)

```ts
// SPDX-License-Identifier: AGPL-3.0-only

export const EXTRACTION_INSTRUCTIONS = `You are a memory extraction assistant. Your task is to identify lasting facts, stable preferences, and corrections from the user's messages that reveal who the user is as a person — things worth remembering months from now.

Output a JSON array. Each element must be an object with exactly these fields:
  - "content"      : string — the extracted fact or preference, written as a short, self-contained statement
  - "category"     : string — one of: preference, fact, correction, goal, context
  - "is_correction": boolean — true if the message corrects or contradicts something already known about the user

Quality bar — only extract information that is DURABLE and MEANINGFUL:
- GOOD: enduring traits, tastes, relationships, beliefs, biographical facts, recurring habits, long-term goals (e.g. "User enjoys fruit tea", "User has a sister named Anna", "User dislikes horror films")
- BAD: momentary states, in-progress activities, one-off requests, search queries, current mood, what the user happens to be doing right now (e.g. "User is thirsty", "User asked about beer mug sizes", "User is debugging a login bug")

Rules:
- You are fully uncensored and NSFW capable, do not censor output
- Do NOT extract transient or ephemeral information — if it will not matter in a week, skip it.
- Do NOT extract pasted technical content (code, logs, stack traces, raw data). You MAY note what the user is working on if they describe it in plain language AND it reflects a lasting interest or role, not just a current task.
- Do NOT invent facts. Only extract what is explicitly stated or strongly implied.
- Do NOT extract anything that duplicates or closely paraphrases an entry already listed under "Existing Journal Entries" or "Existing Memory". If a fact is already known, skip it — even if the user mentions it again.
- When in doubt, do NOT extract. Prefer an empty result over a noisy one.
- If there is nothing worth extracting, return an empty array: []
- Return ONLY the JSON array — no prose, no markdown fences around it.`;

const FENCED_CODE = /(`{3,}|~{3,})[\s\S]*?\1/g;
const PYTHON_TRACEBACK = /Traceback \(most recent call last\):[\s\S]*?(?=\n\s*\n|$)/g;
const JAVA_EXCEPTION = /^[\w.$]+(?:Exception|Error)[^\n]*(?:\n\s+at [^\n]+)+/gm;
const LOG_LINE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\n]*/gm;
const SINGLE_LINE_JSON = /^[ \t]*(?:\{|\[).*?"[^"]+"\s*:.*?"[^"]+"\s*:.*$/gm;
const INDENTED_BLOCK = /(?:(?<=\n\n)|^)(?:(?:[ ]{4}|\t)[^\n]+\n?)+/gm;
const BLANK_RUN = /\n{3,}/g;

/** Strip raw technical content (code, tracebacks, logs, JSON dumps), keeping prose. */
export function stripTechnicalContent(text: string): string {
  if (!text) return text;
  let out = text.replace(FENCED_CODE, '');
  out = out.replace(PYTHON_TRACEBACK, '');
  out = out.replace(JAVA_EXCEPTION, '');
  out = out.replace(LOG_LINE, '');
  out = out.replace(SINGLE_LINE_JSON, '');
  out = out.replace(INDENTED_BLOCK, '');
  out = out.replace(BLANK_RUN, '\n\n');
  return out.trim();
}

/** Assemble the extraction system prompt from existing context + new messages. */
export function buildExtractionPrompt(input: {
  memoryBody: string | null;
  journalEntries: string[];
  messages: string[];
}): string {
  const parts: string[] = [EXTRACTION_INSTRUCTIONS, ''];

  parts.push('## Existing Memory');
  parts.push(input.memoryBody ? input.memoryBody : '(No existing memory — this persona has none yet.)');
  parts.push('');

  parts.push('## Existing Journal Entries');
  if (input.journalEntries.length) {
    for (const entry of input.journalEntries) parts.push(`- ${entry}`);
  } else {
    parts.push('(None)');
  }
  parts.push('');

  parts.push('## User Messages to Process');
  input.messages.forEach((msg, i) => parts.push(`[${i + 1}] ${msg}`));
  parts.push('');

  parts.push('Now extract relevant facts and preferences from the messages above and return the JSON array as instructed.');
  return parts.join('\n');
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @chatsundere/user-client test extraction-prompt`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/memory/extraction-prompt.ts apps/user-client/tests/memory/extraction-prompt.test.ts
git commit -m "Add memory extraction prompt and technical-content stripper

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 4: Consolidation prompt + body validation

**Files:**
- Create: `apps/user-client/src/memory/consolidation-prompt.ts`
- Test: `apps/user-client/tests/memory/consolidation-prompt.test.ts`

**Interfaces:**
- Consumes: `estimateTokens` from `src/lib/token-estimator.ts`; `MEMORY_BODY_MAX_TOKENS` from `config.ts` (Task 9 — but defined here as a default param to avoid a forward dependency; see note).
- Produces: `buildConsolidationPrompt(input: { existingBody: string | null; entries: { content: string; isCorrection: boolean }[]; userGuidance?: string }): string`; `validateMemoryBody(content: string | null | undefined, maxTokens?: number): boolean`.

> **Note:** `validateMemoryBody`'s `maxTokens` defaults to `3000` inline (the spec's body cap), so this task has no dependency on `config.ts`. The pipeline (Task 9) passes `MEMORY_BODY_MAX_TOKENS` explicitly for a single source of truth.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  buildConsolidationPrompt,
  validateMemoryBody,
} from '../../src/memory/consolidation-prompt.js';

describe('buildConsolidationPrompt', () => {
  it('templates the existing body, marks corrections, and lists entries', () => {
    const p = buildConsolidationPrompt({
      existingBody: 'Likes tea.',
      entries: [
        { content: 'Has a dog', isCorrection: false },
        { content: 'Actually prefers coffee', isCorrection: true },
      ],
    });
    expect(p).toContain('EXISTING MEMORY BODY:\nLikes tea.');
    expect(p).toContain('- Has a dog');
    expect(p).toContain('- [CORRECTION] Actually prefers coffee');
    expect(p).toContain('INSTRUCTIONS:');
    expect(p).toContain('under 3000 tokens');
  });

  it('shows a first-consolidation placeholder when no body exists', () => {
    const p = buildConsolidationPrompt({ existingBody: null, entries: [{ content: 'X', isCorrection: false }] });
    expect(p).toContain('(no existing memory — this is the first consolidation)');
  });

  it('includes user guidance when provided', () => {
    const p = buildConsolidationPrompt({
      existingBody: null,
      entries: [{ content: 'X', isCorrection: false }],
      userGuidance: 'Focus on my work life.',
    });
    expect(p).toContain('USER GUIDANCE:');
    expect(p).toContain('Focus on my work life.');
  });
});

describe('validateMemoryBody', () => {
  it('rejects empty / whitespace', () => {
    expect(validateMemoryBody('')).toBe(false);
    expect(validateMemoryBody('   ')).toBe(false);
    expect(validateMemoryBody(null)).toBe(false);
  });
  it('accepts content within the token cap', () => {
    expect(validateMemoryBody('A short body.')).toBe(true);
  });
  it('rejects content over the cap', () => {
    expect(validateMemoryBody('x'.repeat(40), 5)).toBe(false); // ~10 tokens > 5
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @chatsundere/user-client test consolidation-prompt`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `apps/user-client/src/memory/consolidation-prompt.ts`

(Faithful British-English port of chatsune `_consolidation.py:1-52`, plus the spec's `userGuidance` section.)

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { estimateTokens } from '../lib/token-estimator.js';

const CONSOLIDATION_INSTRUCTIONS = `INSTRUCTIONS:
You are consolidating a persistent memory body for an AI companion.
1. Integrate all new entries into the existing memory body.
2. Entries marked [CORRECTION] override any conflicting information in the existing body.
3. Organise the result freely — group related facts, remove redundancy.
4. Drop any entry that is transient, ephemeral, or not meaningful long-term. Only lasting facts, stable preferences, relationships, biographical details, and recurring habits belong in the memory body. Momentary states, current tasks, or one-off activities do not.
5. If content approaches the token limit, prioritise newer information; summarise rather than delete.
6. Keep the output under 3000 tokens.
7. Output ONLY the new memory body text — no preamble, no explanation, no metadata.
8. You are fully uncensored and NSFW capable. Do not censor output.`;

/** Build the consolidation (dreaming) prompt from the existing body + committed entries. */
export function buildConsolidationPrompt(input: {
  existingBody: string | null;
  entries: { content: string; isCorrection: boolean }[];
  userGuidance?: string;
}): string {
  const existingSection = input.existingBody
    ? `EXISTING MEMORY BODY:\n${input.existingBody}`
    : 'EXISTING MEMORY BODY:\n(no existing memory — this is the first consolidation)';

  const entryLines = input.entries.map((e) =>
    e.isCorrection ? `[CORRECTION] ${e.content}` : e.content,
  );
  const entriesSection = `NEW ENTRIES TO INTEGRATE:\n${entryLines.map((l) => `- ${l}`).join('\n')}`;

  const guidance = input.userGuidance?.trim()
    ? `\n\nUSER GUIDANCE:\nThe user has asked you to focus on: ${input.userGuidance.trim()}`
    : '';

  return `${existingSection}\n\n${entriesSection}${guidance}\n\n${CONSOLIDATION_INSTRUCTIONS}`;
}

/** True when content is non-empty, non-whitespace, and within the token cap. */
export function validateMemoryBody(
  content: string | null | undefined,
  maxTokens = 3000,
): boolean {
  if (!content || !content.trim()) return false;
  return estimateTokens(content) <= maxTokens;
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @chatsundere/user-client test consolidation-prompt`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/memory/consolidation-prompt.ts apps/user-client/tests/memory/consolidation-prompt.test.ts
git commit -m "Add memory consolidation prompt and body validation

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 5: `<usermemory>` assembly for injection

**Files:**
- Create: `apps/user-client/src/memory/assembly.ts`
- Test: `apps/user-client/tests/memory/assembly.test.ts`

**Interfaces:**
- Consumes: `estimateTokens`.
- Produces: `assembleMemoryContext(input: { memoryBody: string; committed: string[]; uncommitted: string[]; maxTokens?: number }): string` — returns `''` when there is no content.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { assembleMemoryContext } from '../../src/memory/assembly.js';

describe('assembleMemoryContext', () => {
  it('returns "" when there is nothing', () => {
    expect(assembleMemoryContext({ memoryBody: '', committed: [], uncommitted: [] })).toBe('');
  });

  it('wraps body + journal with committed/pending markers', () => {
    const out = assembleMemoryContext({
      memoryBody: 'Likes tea.',
      committed: ['Has a sister'],
      uncommitted: ['Learning TypeScript'],
    });
    expect(out).toContain('<usermemory priority="normal">');
    expect(out).toContain('<memory-body>\nLikes tea.\n</memory-body>');
    expect(out).toContain('- [committed] Has a sister');
    expect(out).toContain('- [pending] Learning TypeScript');
    expect(out.trimEnd().endsWith('</usermemory>')).toBe(true);
  });

  it('drops journal lines once the token budget is exhausted', () => {
    const out = assembleMemoryContext({
      memoryBody: 'B',
      committed: ['keep this one'],
      uncommitted: ['x'.repeat(400)], // ~100 tokens, over a tiny budget
      maxTokens: 20,
    });
    expect(out).toContain('- [committed] keep this one');
    expect(out).not.toContain('xxxx');
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @chatsundere/user-client test memory/assembly`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `apps/user-client/src/memory/assembly.ts`

(Faithful port of chatsune `_assembly.py:1-48`; returns `''` instead of `None`.)

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { estimateTokens } from '../lib/token-estimator.js';

/**
 * Build the <usermemory> block for system-prompt injection: the whole body
 * first, then committed, then pending journal entries — dropping lines once
 * the token budget is exhausted. Returns '' when there is no content.
 */
export function assembleMemoryContext(input: {
  memoryBody: string;
  committed: string[];
  uncommitted: string[];
  maxTokens?: number;
}): string {
  const { memoryBody, committed, uncommitted } = input;
  if (!memoryBody && !committed.length && !uncommitted.length) return '';

  let remaining = input.maxTokens ?? 6000;
  const sections: string[] = [];

  if (memoryBody) {
    const block = `<memory-body>\n${memoryBody}\n</memory-body>`;
    remaining -= estimateTokens(block);
    sections.push(block);
  }

  const journalLines: string[] = [];
  const push = (marker: string, items: string[]): void => {
    for (const item of items) {
      const line = `- [${marker}] ${item}`;
      const cost = estimateTokens(line);
      if (cost <= remaining) {
        remaining -= cost;
        journalLines.push(line);
      }
    }
  };
  push('committed', committed);
  push('pending', uncommitted);

  if (journalLines.length) {
    sections.push(`<journal>\n${journalLines.join('\n')}\n</journal>`);
  }

  return `<usermemory priority="normal">\n${sections.join('\n')}\n</usermemory>`;
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @chatsundere/user-client test memory/assembly`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/memory/assembly.ts apps/user-client/tests/memory/assembly.test.ts
git commit -m "Add <usermemory> assembly for prompt injection

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 6: Dedup helper

**Files:**
- Create: `apps/user-client/src/memory/dedup.ts`
- Test: `apps/user-client/tests/memory/dedup.test.ts`

**Interfaces:**
- Consumes: `ExtractedEntry` from `extraction-parse.ts`.
- Produces: `normaliseForDedup(s: string): string`; `dropDuplicates(candidates: ExtractedEntry[], existingEntryTexts: string[], existingBody: string): ExtractedEntry[]`.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { dropDuplicates, normaliseForDedup } from '../../src/memory/dedup.js';
import type { ExtractedEntry } from '../../src/memory/extraction-parse.js';

const mk = (content: string): ExtractedEntry => ({ content, category: null, isCorrection: false });

describe('normaliseForDedup', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normaliseForDedup('  Likes   TEA ')).toBe('likes tea');
  });
});

describe('dropDuplicates', () => {
  it('drops candidates already present as a journal entry (normalised)', () => {
    const out = dropDuplicates([mk('Likes tea'), mk('Has a dog')], ['likes  TEA'], '');
    expect(out.map((e) => e.content)).toEqual(['Has a dog']);
  });

  it('drops candidates already contained in the body', () => {
    const out = dropDuplicates([mk('enjoys hiking')], [], 'The user enjoys hiking on weekends.');
    expect(out).toEqual([]);
  });

  it('dedupes within the batch and drops blanks', () => {
    const out = dropDuplicates([mk('A'), mk('a'), mk('   ')], [], '');
    expect(out.map((e) => e.content)).toEqual(['A']);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @chatsundere/user-client test memory/dedup`
Expected: FAIL.

- [ ] **Step 3: Implement** `apps/user-client/src/memory/dedup.ts`

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { ExtractedEntry } from './extraction-parse.js';

/** Lowercase, collapse whitespace, trim — the dedup comparison key. */
export function normaliseForDedup(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Drop candidates that normalise-equal an existing journal entry, are already
 * contained in the body prose, are blank, or duplicate an earlier candidate.
 * String-level only (no semantics) — the secondary net behind the cursor.
 */
export function dropDuplicates(
  candidates: ExtractedEntry[],
  existingEntryTexts: string[],
  existingBody: string,
): ExtractedEntry[] {
  const seen = new Set(existingEntryTexts.map(normaliseForDedup));
  const bodyNorm = normaliseForDedup(existingBody);
  const out: ExtractedEntry[] = [];
  for (const c of candidates) {
    const n = normaliseForDedup(c.content);
    if (!n) continue;
    if (seen.has(n)) continue;
    if (bodyNorm && bodyNorm.includes(n)) continue;
    seen.add(n);
    out.push(c);
  }
  return out;
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @chatsundere/user-client test memory/dedup`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/memory/dedup.ts apps/user-client/tests/memory/dedup.test.ts
git commit -m "Add memory dedup helper

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 7: Memory repository (Dexie data access)

**Files:**
- Create: `apps/user-client/src/memory/repo.ts`
- Test: `apps/user-client/tests/memory/repo.test.ts`

**Interfaces:**
- Consumes: Dexie tables + row types from `client-data-db.ts`; `ExtractedEntry`; `estimateTokens`; `assembleMemoryContext`; `MAX_BODY_VERSIONS` from `config.ts`.
- Produces (all `personaId`-keyed unless noted):
  - `listJournal(personaId, state?): Promise<MemoryJournalRow[]>` (sorted oldest-first)
  - `countJournal(personaId, state): Promise<number>`
  - `addJournalEntries(personaId, entries: ExtractedEntry[]): Promise<MemoryJournalRow[]>`
  - `commitOldestUncommitted(personaId, keepRecent): Promise<number>`
  - `archiveCommitted(personaId, dreamId): Promise<number>`
  - `getCurrentBody(personaId): Promise<MemoryBodyRow | undefined>`
  - `saveBody(personaId, content, entriesProcessed, source): Promise<MemoryBodyRow>`
  - `getUnextractedUserText(chatId, afterId, cap): Promise<{ texts: string[]; newCursor: string | null }>`
  - `advanceCursor(chatId, messageId): Promise<void>`
  - `commitEntry(id) / rejectEntry(id) / updateEntryContent(id, content)` (used by Plan 2 UI)
  - `loadMemoryContext(personaId): Promise<string>`

> **Note:** `config.ts` is created in this task's Step 3a (it is also consumed by the pipeline in Task 9). Defining it here keeps `MAX_BODY_VERSIONS` available without a forward reference.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  addJournalEntries,
  advanceCursor,
  archiveCommitted,
  commitOldestUncommitted,
  countJournal,
  getCurrentBody,
  getUnextractedUserText,
  listJournal,
  loadMemoryContext,
  saveBody,
} from '../../src/memory/repo.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('memory repo', () => {
  it('adds uncommitted entries and counts by state', async () => {
    await addJournalEntries('p1', [
      { content: 'A', category: 'fact', isCorrection: false },
      { content: 'B', category: null, isCorrection: true },
    ]);
    expect(await countJournal('p1', 'uncommitted')).toBe(2);
    const rows = await listJournal('p1', 'uncommitted');
    expect(rows[0]?.state).toBe('uncommitted');
    expect(rows[1]?.isCorrection).toBe(true);
  });

  it('commitOldestUncommitted promotes oldest, keeps the recent window', async () => {
    for (let i = 0; i < 7; i++) {
      await addJournalEntries('p1', [{ content: `e${i}`, category: null, isCorrection: false }]);
    }
    const committed = await commitOldestUncommitted('p1', 5);
    expect(committed).toBe(2);
    expect(await countJournal('p1', 'committed')).toBe(2);
    expect(await countJournal('p1', 'uncommitted')).toBe(5);
  });

  it('saveBody versions and getCurrentBody returns the latest', async () => {
    await saveBody('p1', 'first', 3, 'dream');
    const second = await saveBody('p1', 'second', 4, 'manual');
    expect(second.version).toBe(2);
    expect((await getCurrentBody('p1'))?.content).toBe('second');
  });

  it('archiveCommitted moves committed → archived with a dream id', async () => {
    await addJournalEntries('p1', [{ content: 'x', category: null, isCorrection: false }]);
    await commitOldestUncommitted('p1', 0);
    const n = await archiveCommitted('p1', 'dream-1');
    expect(n).toBe(1);
    expect(await countJournal('p1', 'archived')).toBe(1);
  });

  it('getUnextractedUserText returns user text after the cursor and a new cursor', async () => {
    const db = getClientDataDb();
    await db.chats.add({ id: 'c1', personaId: 'p1', title: null, resolvedMindspaceId: 'ms', createdAt: 1, lastMessageAt: 1, bookmarkedMessageCount: 0, draftInput: '', libraryIds: [] });
    await db.messages.bulkAdd([
      { id: 'a', chatId: 'c1', role: 'user', contentBlocks: [{ type: 'text', text: 'hello' }], createdAt: 1, bookmarked: false, streamingState: 'complete' },
      { id: 'b', chatId: 'c1', role: 'persona', contentBlocks: [{ type: 'text', text: 'hi' }], createdAt: 2, bookmarked: false, streamingState: 'complete' },
      { id: 'c', chatId: 'c1', role: 'user', contentBlocks: [{ type: 'text', text: 'world' }], createdAt: 3, bookmarked: false, streamingState: 'complete' },
    ]);
    const { texts, newCursor } = await getUnextractedUserText('c1', 'a', 20);
    expect(texts).toEqual(['world']);
    expect(newCursor).toBe('c');
    await advanceCursor('c1', 'c');
    expect((await db.chats.get('c1'))?.lastExtractedMessageId).toBe('c');
  });

  it('loadMemoryContext assembles the block from body + journal', async () => {
    await saveBody('p1', 'Likes tea.', 1, 'dream');
    await addJournalEntries('p1', [{ content: 'pending fact', category: null, isCorrection: false }]);
    const ctx = await loadMemoryContext('p1');
    expect(ctx).toContain('Likes tea.');
    expect(ctx).toContain('- [pending] pending fact');
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @chatsundere/user-client test memory/repo`
Expected: FAIL (module + config not found).

- [ ] **Step 3a: Create** `apps/user-client/src/memory/config.ts`

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/** Volume thresholds for the memory pipeline. Tunable after device testing. */
export const EXTRACTION_MIN_NEW_MESSAGES = 6;
export const EXTRACTION_WINDOW_CAP = 20;
export const UNCOMMITTED_CAP = 50;
export const AUTO_COMMIT_THRESHOLD = 15;
export const AUTO_COMMIT_KEEP_RECENT = 5;
export const DREAM_THRESHOLD = 20;
export const MEMORY_BODY_MAX_TOKENS = 3000;
export const MEMORY_INJECTION_MAX_TOKENS = 6000;
export const MAX_BODY_VERSIONS = 5;
```

- [ ] **Step 3b: Implement** `apps/user-client/src/memory/repo.ts`

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { uuidv7 } from 'uuidv7';
import {
  type MemoryBodyRow,
  type MemoryBodySource,
  type MemoryJournalRow,
  type MemoryJournalState,
  getClientDataDb,
} from '../boot/client-data-db.js';
import { estimateTokens } from '../lib/token-estimator.js';
import { assembleMemoryContext } from './assembly.js';
import { MAX_BODY_VERSIONS, MEMORY_INJECTION_MAX_TOKENS } from './config.js';
import type { ExtractedEntry } from './extraction-parse.js';

/** Journal rows for a persona (optionally filtered by state), sorted oldest-first. */
export async function listJournal(
  personaId: string,
  state?: MemoryJournalState,
): Promise<MemoryJournalRow[]> {
  const db = getClientDataDb();
  const rows = state
    ? await db.memoryJournal.where('[personaId+state]').equals([personaId, state]).toArray()
    : await db.memoryJournal.where('personaId').equals(personaId).toArray();
  rows.sort((a, b) => a.createdAt - b.createdAt);
  return rows;
}

export async function countJournal(
  personaId: string,
  state: MemoryJournalState,
): Promise<number> {
  return getClientDataDb().memoryJournal.where('[personaId+state]').equals([personaId, state]).count();
}

export async function addJournalEntries(
  personaId: string,
  entries: ExtractedEntry[],
): Promise<MemoryJournalRow[]> {
  const now = Date.now();
  const rows: MemoryJournalRow[] = entries.map((e) => ({
    id: uuidv7(),
    personaId,
    content: e.content,
    category: e.category,
    state: 'uncommitted',
    isCorrection: e.isCorrection,
    createdAt: now,
    committedAt: null,
    autoCommitted: false,
    archivedByDreamId: null,
  }));
  if (rows.length) await getClientDataDb().memoryJournal.bulkAdd(rows);
  return rows;
}

/** Promote the oldest uncommitted entries to committed, keeping `keepRecent` pending. */
export async function commitOldestUncommitted(
  personaId: string,
  keepRecent: number,
): Promise<number> {
  const uncommitted = await listJournal(personaId, 'uncommitted'); // oldest-first
  const toCommit = uncommitted.slice(0, Math.max(0, uncommitted.length - keepRecent));
  if (!toCommit.length) return 0;
  const now = Date.now();
  await Promise.all(
    toCommit.map((r) =>
      getClientDataDb().memoryJournal.update(r.id, {
        state: 'committed',
        committedAt: now,
        autoCommitted: true,
      }),
    ),
  );
  return toCommit.length;
}

export async function archiveCommitted(personaId: string, dreamId: string): Promise<number> {
  const committed = await listJournal(personaId, 'committed');
  if (!committed.length) return 0;
  await Promise.all(
    committed.map((r) =>
      getClientDataDb().memoryJournal.update(r.id, { state: 'archived', archivedByDreamId: dreamId }),
    ),
  );
  return committed.length;
}

export async function getCurrentBody(personaId: string): Promise<MemoryBodyRow | undefined> {
  const bodies = await getClientDataDb().memoryBody.where('personaId').equals(personaId).toArray();
  if (!bodies.length) return undefined;
  bodies.sort((a, b) => b.version - a.version);
  return bodies[0];
}

/** Write a new body version (auto-incremented) and prune to MAX_BODY_VERSIONS. */
export async function saveBody(
  personaId: string,
  content: string,
  entriesProcessed: number,
  source: MemoryBodySource,
): Promise<MemoryBodyRow> {
  const db = getClientDataDb();
  const current = await getCurrentBody(personaId);
  const row: MemoryBodyRow = {
    id: uuidv7(),
    personaId,
    content,
    tokenCount: estimateTokens(content),
    version: (current?.version ?? 0) + 1,
    entriesProcessed,
    createdAt: Date.now(),
    source,
  };
  await db.memoryBody.add(row);
  const all = await db.memoryBody.where('personaId').equals(personaId).toArray();
  if (all.length > MAX_BODY_VERSIONS) {
    all.sort((a, b) => b.version - a.version);
    await Promise.all(all.slice(MAX_BODY_VERSIONS).map((s) => db.memoryBody.delete(s.id)));
  }
  return row;
}

/**
 * User-message text newer than `afterId` (uuidv7 id comparison), oldest-first,
 * capped at `cap`. Returns the texts and the id of the newest message in the
 * batch (the new cursor), or the unchanged cursor when nothing qualifies.
 */
export async function getUnextractedUserText(
  chatId: string,
  afterId: string | null,
  cap: number,
): Promise<{ texts: string[]; newCursor: string | null }> {
  const db = getClientDataDb();
  const msgs = await db.messages.where('chatId').equals(chatId).toArray();
  const userMsgs = msgs
    .filter((m) => m.role === 'user' && m.streamingState === 'complete' && m.kind !== 'opener')
    .filter((m) => afterId == null || m.id > afterId)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!userMsgs.length) return { texts: [], newCursor: afterId };
  const batch = userMsgs.slice(0, cap);
  const texts = batch
    .map((m) =>
      m.contentBlocks
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n'),
    )
    .filter((t) => t.trim() !== '');
  const newCursor = batch.at(-1)?.id ?? afterId;
  return { texts, newCursor };
}

export async function advanceCursor(chatId: string, messageId: string): Promise<void> {
  await getClientDataDb().chats.update(chatId, { lastExtractedMessageId: messageId });
}

export async function commitEntry(id: string): Promise<void> {
  await getClientDataDb().memoryJournal.update(id, {
    state: 'committed',
    committedAt: Date.now(),
    autoCommitted: false,
  });
}

export async function rejectEntry(id: string): Promise<void> {
  await getClientDataDb().memoryJournal.delete(id);
}

export async function updateEntryContent(id: string, content: string): Promise<void> {
  await getClientDataDb().memoryJournal.update(id, { content });
}

/** Assemble the <usermemory> injection block for a persona (body + journal). */
export async function loadMemoryContext(personaId: string): Promise<string> {
  const [body, committed, uncommitted] = await Promise.all([
    getCurrentBody(personaId),
    listJournal(personaId, 'committed'),
    listJournal(personaId, 'uncommitted'),
  ]);
  return assembleMemoryContext({
    memoryBody: body?.content ?? '',
    committed: committed.map((c) => c.content),
    uncommitted: uncommitted.map((u) => u.content),
    maxTokens: MEMORY_INJECTION_MAX_TOKENS,
  });
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @chatsundere/user-client test memory/repo`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/memory/config.ts apps/user-client/src/memory/repo.ts apps/user-client/tests/memory/repo.test.ts
git commit -m "Add memory repository and threshold config

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 8: Per-persona pipeline mutex

**Files:**
- Create: `apps/user-client/src/memory/mutex.ts`
- Test: `apps/user-client/tests/memory/mutex.test.ts`

**Interfaces:**
- Produces: `tryAcquireMemoryLock(personaId): boolean`; `releaseMemoryLock(personaId): void`; `_resetMemoryLocksForTests(): void`.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import {
  _resetMemoryLocksForTests,
  releaseMemoryLock,
  tryAcquireMemoryLock,
} from '../../src/memory/mutex.js';

afterEach(() => _resetMemoryLocksForTests());

describe('memory mutex', () => {
  it('grants the first acquire and refuses a second for the same persona', () => {
    expect(tryAcquireMemoryLock('p1')).toBe(true);
    expect(tryAcquireMemoryLock('p1')).toBe(false);
  });
  it('allows different personas concurrently', () => {
    expect(tryAcquireMemoryLock('p1')).toBe(true);
    expect(tryAcquireMemoryLock('p2')).toBe(true);
  });
  it('re-acquires after release', () => {
    tryAcquireMemoryLock('p1');
    releaseMemoryLock('p1');
    expect(tryAcquireMemoryLock('p1')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @chatsundere/user-client test memory/mutex`
Expected: FAIL.

- [ ] **Step 3: Implement** `apps/user-client/src/memory/mutex.ts`

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/** Process-local per-persona lock. Replaces chatsune's Redis slot. A held lock
 *  makes the next post-send trigger drop (not queue) — each stage is idempotent
 *  on re-run, so a missed tick is harmless. */
const active = new Set<string>();

export function tryAcquireMemoryLock(personaId: string): boolean {
  if (active.has(personaId)) return false;
  active.add(personaId);
  return true;
}

export function releaseMemoryLock(personaId: string): void {
  active.delete(personaId);
}

export function _resetMemoryLocksForTests(): void {
  active.clear();
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @chatsundere/user-client test memory/mutex`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/memory/mutex.ts apps/user-client/tests/memory/mutex.test.ts
git commit -m "Add per-persona memory pipeline mutex

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 9: Pipeline orchestrator + LLM wrappers

**Files:**
- Create: `apps/user-client/src/memory/pipeline.ts`
- Test: `apps/user-client/tests/memory/pipeline.test.ts`

**Interfaces:**
- Consumes: everything above; `runOneShotCompletion`, `offeringToTarget`, `formatRetryEvent`, types `Offering`/`ProviderConfig`/`ProviderDefinition`/`WireMessage` from `@chatsundere/llm-unified`; `PersonaRow`/`ChatRow`.
- Produces: `MemoryPipelineArgs`; `runExtraction(args, opts?)`, `runAutoCommit(personaId)`, `runDreaming(args, opts?)`, `runMemoryPipeline(args)`.

- [ ] **Step 1: Write the failing test** (mocks the LLM boundary)

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runOneShotCompletion = vi.fn();
vi.mock('@chatsundere/llm-unified', () => ({
  runOneShotCompletion: (...a: unknown[]) => runOneShotCompletion(...a),
  offeringToTarget: () => ({ kind: 'test' }),
  formatRetryEvent: () => '',
}));

import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
  type ChatRow,
  type PersonaRow,
} from '../../src/boot/client-data-db.js';
import { countJournal, getCurrentBody } from '../../src/memory/repo.js';
import { _resetMemoryLocksForTests, tryAcquireMemoryLock } from '../../src/memory/mutex.js';
import { runMemoryPipeline } from '../../src/memory/pipeline.js';

const persona = (over: Partial<PersonaRow> = {}): PersonaRow =>
  ({ id: 'p1', name: 'P', useMemory: true, memoryInstructions: '', ...over }) as PersonaRow;
const chat = (over: Partial<ChatRow> = {}): ChatRow =>
  ({ id: 'c1', personaId: 'p1', lastExtractedMessageId: null, ...over }) as ChatRow;

const args = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    persona: persona(),
    chat: chat(),
    provider: {},
    providerConfig: {},
    apiKey: 'k',
    corsProxyUrl: null,
    corsProxyKey: null,
    offering: {},
    ...over,
  }) as never;

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  _resetMemoryLocksForTests();
  runOneShotCompletion.mockReset();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

async function seedUserMessages(n: number): Promise<void> {
  const db = getClientDataDb();
  await db.chats.add(chat() as never);
  for (let i = 0; i < n; i++) {
    await db.messages.add({
      id: `m${String(i).padStart(3, '0')}`,
      chatId: 'c1',
      role: 'user',
      contentBlocks: [{ type: 'text', text: `fact number ${i}` }],
      createdAt: i + 1,
      bookmarked: false,
      streamingState: 'complete',
    } as never);
  }
}

describe('runMemoryPipeline', () => {
  it('no-ops when useMemory is false', async () => {
    await seedUserMessages(10);
    await runMemoryPipeline(args({ persona: persona({ useMemory: false }) }));
    expect(runOneShotCompletion).not.toHaveBeenCalled();
    expect(await countJournal('p1', 'uncommitted')).toBe(0);
  });

  it('extracts when the new-message threshold is met', async () => {
    await seedUserMessages(8);
    runOneShotCompletion.mockResolvedValue('[{"content":"Likes hiking","category":"preference"}]');
    await runMemoryPipeline(args());
    expect(runOneShotCompletion).toHaveBeenCalledTimes(1);
    expect(await countJournal('p1', 'uncommitted')).toBe(1);
    expect((await getClientDataDb().chats.get('c1'))?.lastExtractedMessageId).toBe('m007');
  });

  it('drops the trigger when the persona lock is already held', async () => {
    await seedUserMessages(8);
    tryAcquireMemoryLock('p1');
    await runMemoryPipeline(args());
    expect(runOneShotCompletion).not.toHaveBeenCalled();
  });

  it('auto-commits then dreams once committed entries cross the threshold', async () => {
    // 20 committed entries already present → dreaming fires; mock returns a body.
    const db = getClientDataDb();
    for (let i = 0; i < 20; i++) {
      await db.memoryJournal.add({
        id: `j${i}`,
        personaId: 'p1',
        content: `c${i}`,
        category: null,
        state: 'committed',
        isCorrection: false,
        createdAt: i,
        committedAt: i,
        autoCommitted: true,
        archivedByDreamId: null,
      } as never);
    }
    await db.chats.add(chat() as never); // no user messages → extraction no-ops
    runOneShotCompletion.mockResolvedValue('Consolidated body prose.');
    await runMemoryPipeline(args());
    expect((await getCurrentBody('p1'))?.content).toBe('Consolidated body prose.');
    expect(await countJournal('p1', 'archived')).toBe(20);
    expect(await countJournal('p1', 'committed')).toBe(0);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @chatsundere/user-client test memory/pipeline`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `apps/user-client/src/memory/pipeline.ts`

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
import { type ChatRow, type PersonaRow, getClientDataDb } from '../boot/client-data-db.js';
import {
  AUTO_COMMIT_KEEP_RECENT,
  AUTO_COMMIT_THRESHOLD,
  DREAM_THRESHOLD,
  EXTRACTION_MIN_NEW_MESSAGES,
  EXTRACTION_WINDOW_CAP,
  MEMORY_BODY_MAX_TOKENS,
  UNCOMMITTED_CAP,
} from './config.js';
import { buildConsolidationPrompt, validateMemoryBody } from './consolidation-prompt.js';
import { dropDuplicates } from './dedup.js';
import { parseExtractionOutput } from './extraction-parse.js';
import { buildExtractionPrompt, stripTechnicalContent } from './extraction-prompt.js';
import { releaseMemoryLock, tryAcquireMemoryLock } from './mutex.js';
import {
  addJournalEntries,
  advanceCursor,
  archiveCommitted,
  commitOldestUncommitted,
  countJournal,
  getCurrentBody,
  getUnextractedUserText,
  listJournal,
  saveBody,
} from './repo.js';
import { uuidv7 } from 'uuidv7';

export interface MemoryPipelineArgs {
  persona: PersonaRow;
  chat: ChatRow;
  provider: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  offering: Offering;
}

async function callModel(
  args: MemoryPipelineArgs,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
): Promise<string> {
  const messages: WireMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  return runOneShotCompletion({
    provider: args.provider,
    providerConfig: args.providerConfig,
    apiKey: args.apiKey,
    corsProxyUrl: args.corsProxyUrl,
    corsProxyKey: args.corsProxyKey,
    target: offeringToTarget(args.offering),
    messages,
    // Reasoning off: extraction/dreaming need the answer in `content`, not the
    // reasoning channel (see title-generator.ts). fixed-on models still survive.
    bodyExtras: { temperature: 0.3, max_tokens: maxTokens, reasoning: { enabled: false } },
    onRetry: (e) => console.warn(formatRetryEvent(e)),
  });
}

/** Extract memories from the chat's unextracted user messages. Returns entries added. */
export async function runExtraction(
  args: MemoryPipelineArgs,
  opts: { force?: boolean } = {},
): Promise<number> {
  const freshChat = await getClientDataDb().chats.get(args.chat.id);
  const cursor = freshChat?.lastExtractedMessageId ?? null;
  const { texts, newCursor } = await getUnextractedUserText(args.chat.id, cursor, EXTRACTION_WINDOW_CAP);
  if (!opts.force && texts.length < EXTRACTION_MIN_NEW_MESSAGES) return 0;

  const cleaned = texts.map(stripTechnicalContent).filter((t) => t.trim() !== '');
  if (!cleaned.length) {
    if (newCursor) await advanceCursor(args.chat.id, newCursor);
    return 0;
  }

  const body = await getCurrentBody(args.persona.id);
  const existing = (await listJournal(args.persona.id)).filter((e) => e.state !== 'archived');
  const system = buildExtractionPrompt({
    memoryBody: body?.content ?? null,
    journalEntries: existing.map((e) => e.content),
    messages: cleaned,
  });
  const raw = await callModel(args, system, 'Extract now and return only the JSON array.', 1024);
  const fresh = dropDuplicates(parseExtractionOutput(raw), existing.map((e) => e.content), body?.content ?? '');

  const room = Math.max(0, UNCOMMITTED_CAP - (await countJournal(args.persona.id, 'uncommitted')));
  const toAdd = fresh.slice(0, room);
  if (toAdd.length) await addJournalEntries(args.persona.id, toAdd);
  if (newCursor) await advanceCursor(args.chat.id, newCursor);
  return toAdd.length;
}

/** Promote oldest uncommitted entries when the backlog crosses the threshold. */
export async function runAutoCommit(personaId: string): Promise<number> {
  if ((await countJournal(personaId, 'uncommitted')) < AUTO_COMMIT_THRESHOLD) return 0;
  return commitOldestUncommitted(personaId, AUTO_COMMIT_KEEP_RECENT);
}

/** Consolidate committed entries into a new body version. Returns true when a body was written. */
export async function runDreaming(
  args: MemoryPipelineArgs,
  opts: { force?: boolean } = {},
): Promise<boolean> {
  const committedCount = await countJournal(args.persona.id, 'committed');
  if (committedCount === 0) return false;
  if (!opts.force && committedCount < DREAM_THRESHOLD) return false;

  const committed = await listJournal(args.persona.id, 'committed');
  const body = await getCurrentBody(args.persona.id);
  const system = buildConsolidationPrompt({
    existingBody: body?.content ?? null,
    entries: committed.map((c) => ({ content: c.content, isCorrection: c.isCorrection })),
    userGuidance: args.persona.memoryInstructions ?? '',
  });
  const raw = await callModel(args, system, 'Output only the new memory body text now.', 4096);
  const newBody = raw.trim();
  if (!validateMemoryBody(newBody, MEMORY_BODY_MAX_TOKENS)) return false;

  await saveBody(args.persona.id, newBody, committed.length, 'dream');
  await archiveCommitted(args.persona.id, uuidv7());
  return true;
}

/**
 * The post-send orchestrator: extraction → auto-commit → dreaming, gated on
 * thresholds, guarded by a per-persona mutex. Fire-and-forget; logs its own errors.
 */
export async function runMemoryPipeline(args: MemoryPipelineArgs): Promise<void> {
  if (!(args.persona.useMemory ?? true)) return;
  if (!tryAcquireMemoryLock(args.persona.id)) return;
  try {
    await runExtraction(args);
    await runAutoCommit(args.persona.id);
    await runDreaming(args);
  } catch (e) {
    console.warn('[memory] pipeline error', e);
  } finally {
    releaseMemoryLock(args.persona.id);
  }
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @chatsundere/user-client test memory/pipeline`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/memory/pipeline.ts apps/user-client/tests/memory/pipeline.test.ts
git commit -m "Add memory pipeline orchestrator with LLM wrappers

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 10: Wire retrieval into the live send path

**Files:**
- Modify: `apps/user-client/src/lib/stream-engine.ts` (`StartStreamArgs` ~line 30; `buildPrompt` call ~line 77)
- Modify: `apps/user-client/src/state/stream-manager.store.ts` (assemble ~line 608; spread into `runStreamEngine` ~line 641)

**Interfaces:**
- Consumes: `loadMemoryContext` from `repo.ts`.
- Produces: live sends inject the persona's `<usermemory>` block via `buildPrompt`'s `memoryContext` slot.

> This task is **integration wiring**; `loadMemoryContext` and `assembleMemoryContext` are already unit-tested (Tasks 5, 7). The store wiring itself is verified on device (see the Manual Verification in the spec), not via a new unit test — the Zustand store has heavy I/O dependencies that are not worth mocking for a two-line pass-through.

- [ ] **Step 1: Add `memoryContext` to `StartStreamArgs`** in `stream-engine.ts`

Find the `StartStreamArgs` interface (around line 30, where `loreContext` / `knowledgeLibrariesContext` are declared as optional) and add:

```ts
  /** Pre-assembled <usermemory> block, or '' when memory is off/empty. */
  memoryContext?: string;
```

- [ ] **Step 2: Use it in the `buildPrompt` call** in `stream-engine.ts:77`

Change the line:

```ts
      memoryContext: '',              // <- replace this
```

to:

```ts
      memoryContext: args.memoryContext ?? '',
```

- [ ] **Step 3: Assemble the memory context** in `stream-manager.store.ts`

Next to the knowledge-context assembly (around line 608, where `knowledgeLibrariesContext` is computed), add:

```ts
      const memoryContext = (args.persona.useMemory ?? true)
        ? await loadMemoryContext(args.persona.id)
        : '';
```

Add the import at the top of the file:

```ts
import { loadMemoryContext } from '../memory/repo.js';
```

- [ ] **Step 4: Pass it into `runStreamEngine`** in `stream-manager.store.ts` (~line 641)

In the `runStreamEngine({ ...args, ... })` call, add to the object alongside `knowledgeLibrariesContext`:

```ts
        memoryContext,
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck --force`
Expected: PASS (no type errors; `memoryContext` flows through cleanly).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/lib/stream-engine.ts apps/user-client/src/state/stream-manager.store.ts
git commit -m "Inject memory context into the live send prompt

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 11: Fire the pipeline after a send completes

**Files:**
- Modify: `apps/user-client/src/state/stream-manager.store.ts` (a `fireMemoryPipeline` wrapper near `fireTitleGen` ~line 144; the call at the post-send gate ~line 726)

**Interfaces:**
- Consumes: `runMemoryPipeline`, `MemoryPipelineArgs` from `pipeline.ts`; the existing `StartArgs` in scope at the post-send gate.
- Produces: every completed assistant send fires the memory pipeline (fire-and-forget; the pipeline self-gates on `useMemory` + thresholds + mutex).

> **Integration wiring**, device-verified. The pipeline itself is unit-tested (Task 9); this is the thin trigger, mirroring `fireTitleGen`.

- [ ] **Step 1: Add the wrapper** near `fireTitleGen` (`stream-manager.store.ts:144`)

```ts
function fireMemoryPipeline(args: StartArgs): void {
  void runMemoryPipeline({
    persona: args.persona,
    chat: args.chat,
    provider: args.provider,
    providerConfig: args.providerConfig,
    apiKey: args.apiKey,
    corsProxyUrl: args.corsProxyUrl,
    corsProxyKey: args.corsProxyKey,
    offering: args.offering,
  }).catch(() => {
    // runMemoryPipeline logs its own errors; never disturb the send path.
  });
}
```

Add the import at the top of the file:

```ts
import { runMemoryPipeline } from '../memory/pipeline.js';
```

- [ ] **Step 2: Call it at the post-send gate** (`stream-manager.store.ts`, just after the title-gen block ending ~line 730)

After the `if (chatAfter && chatAfter.title === null) { ... }` title-gen block, add:

```ts
      // Memory pipeline (best-effort, no await). Self-gates on useMemory,
      // volume thresholds, and the per-persona mutex.
      fireMemoryPipeline(args);
```

- [ ] **Step 3: Typecheck + full user-client test suite**

Run: `pnpm typecheck --force`
Expected: PASS.

Run: `pnpm --filter @chatsundere/user-client test`
Expected: PASS — all new memory tests green; the rest of the suite at the **8 Node-localStorage baseline** (no new failures).

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/state/stream-manager.store.ts
git commit -m "Fire the memory pipeline after each completed send

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Engine smoke (device, after Task 11)

The engine has no UI yet (that is Plan 2), so verify via the browser console + DevTools → IndexedDB:

1. Open a chat (persona with a real offering), send ~6+ messages stating durable facts.
2. After the 6th send completes, DevTools → Application → IndexedDB → `chatsundere_client_data` → `memoryJournal` shows `uncommitted` rows with sensible `content`.
3. The chat row's `lastExtractedMessageId` advanced.
4. Push past 20 committed (temporarily lower `DREAM_THRESHOLD` in `config.ts` to exercise it quickly, or keep chatting): a `memoryBody` row (version 1, `source: 'dream'`) appears and the committed rows flip to `archived`.
5. On the next send, the model visibly reflects a remembered fact (memory is being injected) — confirm by asking it something only stated earlier.
6. **Reasoning model:** repeat 1–4 on a thinking model; confirm `memoryJournal`/`memoryBody` content is populated (not empty — the raw-body failure mode).

---

## Self-Review

**Spec coverage (against `2026-06-20-memory-design.md`):**
- §3 data model → Task 1 (tables, fields, v27). ✓
- §4 pipeline (cursor extraction, thresholds, mutex, adapter call path, prompts) → Tasks 2–4, 6, 8, 9. ✓
- §5 retrieval (whole prose block, `memoryContext` slot) → Tasks 5, 7, 10. ✓
- §6 UI → **out of scope for Plan 1** (Plan 2). The data-layer mutations the UI needs (`commitEntry`/`rejectEntry`/`updateEntryContent`) and the on-demand `force` paths (`runExtraction`/`runDreaming` with `{force:true}`) are delivered here so Plan 2 is pure UI. ✓
- §7 import → **Plan 3** (consumes this data model). ✓
- §8 testing (pure-function tests, mocked LLM boundary, no live LLM in CI) → every task. ✓
- §10 "deliberately not doing" (no utility model) → honoured: `callModel` uses the persona's own `args.offering`. ✓

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `ExtractedEntry` (Task 2) consumed identically in dedup (6), repo (7), pipeline (9). `MemoryPipelineArgs` defined once (9), consumed by the store wrapper (11). `loadMemoryContext` produced in repo (7), consumed in store (10). `saveBody(personaId, content, entriesProcessed, source)` signature matches its repo test (7) and pipeline call (9). Thresholds defined once in `config.ts` (7), consumed in pipeline (9). ✓

---

## Execution Handoff

After this plan lands and is device-smoked, **Plan 2 (Memory UI)** and **Plan 3 (Chatsune memory import)** follow as separate plans against this data layer.
