# Memory Import Implementation Plan (Plan 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the deferred memory→importer coupling: extend the existing Chatsune persona importer so `memory.json` (journal entries + memory bodies) flows into the new memory tables, idempotently, when the user imports/migrates a persona.

**Architecture:** The Chatsune importer already lands chats + persona core and defers memory (the parser counts `memory.json` but discards it; the UI shows a "re-import once memory lands" note). This plan: (1) the parser retains the typed memory; (2) a new `importChatsuneMemory` maps it into `memoryJournal` + `memoryBody` (reusing Plan-1 repo helpers and the `normaliseForDedup` dedup); (3) the apply→Save flow stages + imports it alongside sessions; (4) the deferral anchors are removed and the couplings register closed. Built on branch `feature/memory-engine` (continues Plans 1-2).

**Tech Stack:** TypeScript (strict), Dexie, Vitest + `fake-indexeddb`, React (the import control + editor wiring).

## Global Constraints

- **British English** in every identifier, comment, log string, and user-facing copy.
- **TypeScript strict**, `noUncheckedIndexedAccess`. **No `any`** without inline justification. **No non-null assertions (`!`)** — Biome bans them; use `?? default`, optional chaining, `.at(-1)`.
- New source files start with `// SPDX-License-Identifier: AGPL-3.0-only`.
- **Idempotency:** a re-import of the same export into the same persona must add nothing new. Chats already dedup by `importedFrom` (chatsune `original_id`). Chatsune memory entries carry **no stable id** (owner ids are stripped on export), so memory idempotency is **content-based** — reuse `normaliseForDedup` from `src/memory/dedup.ts`.
- **Provenance:** imported journal rows carry `importedFrom: 'chatsune'`; imported bodies carry `source: 'import'`.
- Tests under `apps/user-client/tests/`; mirror the existing `tests/data/chatsune-import.test.ts` fixture + assertion style.
- Gate before any squash: `pnpm typecheck --force`, `pnpm --filter @chatsundere/user-client test` at the **8 Node-localStorage baseline**, Biome clean.
- This is **client-only** (no Larissa). It completes the feature; the **Laura pre-squash pass** + unified squash follow this plan.

## Source Format (chatsune `memory.json`, verified against `chatsune/backend/modules/persona/_export.py`)

```json
{
  "journal_entries": [
    { "content": str, "category": str|null, "state": "uncommitted"|"committed"|"archived",
      "is_correction": bool, "created_at": ISO, "committed_at": ISO|null,
      "auto_committed": bool, "source_session_id": str, "archived_by_dream_id": str|null }
  ],
  "memory_bodies": [
    { "content": str, "token_count": int, "version": int, "entries_processed": int, "created_at": ISO }
  ]
}
```

## Design decisions (resolved here)

- **Skip `archived` journal entries.** They are historical and inert (never injected — retrieval uses only committed + uncommitted), and their essence already lives in the imported bodies. Import only `state !== 'archived'` entries + all bodies. This sidesteps archived/body redundancy entirely.
- **Bodies via `saveBody`.** Reuse `saveBody(personaId, content, entriesProcessed, 'import')` per new body in ascending chatsune-version order. It auto-assigns the next version (continuing after the persona's current max) and prunes to 5 — so the latest chatsune body becomes the persona's current body (correct "migrate my memory" semantics for the dominant new-persona case). `created_at`/`token_count` are re-derived (import-time / `estimateTokens`); acceptable — provenance is `source: 'import'` and version order carries the meaning.
- **Journal preserves state + timestamps + flags** (a custom insert, NOT `addJournalEntries` which forces `uncommitted`/now).

## File Structure

**Modified:**
- `src/lib/chatsune-import/types.ts` — chatsune memory types
- `src/lib/chatsune-import/persona-parse.ts` — retain the typed memory; drop the `FUTURE:` deferral comment
- `src/data/chatsune-import.ts` — new `importChatsuneMemory`
- `src/components/persona-editor/ChatsuneImportControl.tsx` — carry `memory` in `AppliedPersonaImport` + onApply; update the memory note
- `src/routes/app/persona-editor.tsx` — stage + import memory on Save
- `obsidian/insights/future-feature-couplings.md` — move the coupling to Closed

**New tests:** memory parser + import cases in the existing `tests/data/chatsune-import.test.ts` (or a sibling `chatsune-memory-import.test.ts`).

---

### Task 1: Parser retains the typed memory

**Files:**
- Modify: `src/lib/chatsune-import/types.ts`, `src/lib/chatsune-import/persona-parse.ts`
- Test: `apps/user-client/tests/lib/chatsune-import/persona-parse-memory.test.ts`

**Interfaces:**
- Produces (types): `ChatsuneJournalEntry`, `ChatsuneMemoryBody`, `ChatsuneMemoryExport`.
- Produces (parser): `ParsedPersonaExport.memory: ChatsuneMemoryExport | null` (alongside the existing `memoryCount`).

- [ ] **Step 1: Add the chatsune memory types** to `src/lib/chatsune-import/types.ts`

```ts
export interface ChatsuneJournalEntry {
  content: string;
  category?: string | null;
  state?: string;
  is_correction?: boolean;
  created_at?: string;
  committed_at?: string | null;
  auto_committed?: boolean;
  archived_by_dream_id?: string | null;
}

export interface ChatsuneMemoryBody {
  content: string;
  token_count?: number;
  version?: number;
  entries_processed?: number;
  created_at?: string;
}

export interface ChatsuneMemoryExport {
  journal_entries: ChatsuneJournalEntry[];
  memory_bodies: ChatsuneMemoryBody[];
}
```

- [ ] **Step 2: Write the failing parser test** `apps/user-client/tests/lib/chatsune-import/persona-parse-memory.test.ts`

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { parsePersonaExport } from '../../../src/lib/chatsune-import/persona-parse.js';

// Mirror the archive shape parsePersonaExport consumes. Read persona-parse.ts to
// confirm the ChatsuneArchive shape (manifest + files map) and build a minimal one
// with manifest.json, persona.json, sessions.json, and memory.json.
function archiveWithMemory() {
  const files = new Map<string, Uint8Array>();
  const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
  files.set('manifest.json', enc({ format: 'chatsune/persona', version: 1, include_content: true }));
  files.set('persona.json', enc({ name: 'P', tagline: '', system_prompt: '', nsfw: false }));
  files.set('sessions.json', enc({ sessions: [] }));
  files.set('memory.json', enc({
    journal_entries: [
      { content: 'Likes tea', category: 'preference', state: 'committed', is_correction: false, created_at: '2026-01-01T00:00:00Z', committed_at: '2026-01-02T00:00:00Z', auto_committed: true },
    ],
    memory_bodies: [
      { content: 'A consolidated body.', token_count: 5, version: 1, entries_processed: 3, created_at: '2026-01-01T00:00:00Z' },
    ],
  }));
  return { manifest: { format: 'chatsune/persona', version: 1 }, files };
}

describe('parsePersonaExport — memory retention', () => {
  it('retains typed journal_entries + memory_bodies and still reports memoryCount', () => {
    // NOTE: adapt the archive constructor to the real ChatsuneArchive type read from persona-parse.ts.
    const parsed = parsePersonaExport(archiveWithMemory() as never);
    expect(parsed.memoryCount).toBe(2);
    expect(parsed.memory?.journal_entries).toHaveLength(1);
    expect(parsed.memory?.journal_entries[0]?.content).toBe('Likes tea');
    expect(parsed.memory?.memory_bodies[0]?.content).toBe('A consolidated body.');
  });

  it('memory is null when the export has no memory.json', () => {
    const a = archiveWithMemory();
    a.files.delete('memory.json');
    const parsed = parsePersonaExport(a as never);
    expect(parsed.memory).toBeNull();
    expect(parsed.memoryCount).toBe(0);
  });
});
```

- [ ] **Step 3: Run it — verify it fails**

Run: `pnpm --filter @chatsundere/user-client test persona-parse-memory`
Expected: FAIL (`parsed.memory` undefined).

- [ ] **Step 4: Update `persona-parse.ts`** — retain the typed memory; drop the deferral comment

Read the current `ParsedPersonaExport` (lines 21-29) and the memory decode (lines 70-74). Replace the `FUTURE:`-commented `memoryCount` field with:

```ts
  /** Count of chatsune memories in the export (journal entries + body versions). */
  memoryCount: number;
  /** The parsed chatsune memory, or null when the export carries none. */
  memory: ChatsuneMemoryExport | null;
```

Replace the decode block (lines 70-74) with one that decodes into the typed shape, retains it, and derives the count:

```ts
const memoryRaw = decodeJson<ChatsuneMemoryExport>(archive.files, 'memory.json');
const memory: ChatsuneMemoryExport | null = memoryRaw
  ? {
      journal_entries: Array.isArray(memoryRaw.journal_entries) ? memoryRaw.journal_entries : [],
      memory_bodies: Array.isArray(memoryRaw.memory_bodies) ? memoryRaw.memory_bodies : [],
    }
  : null;
const memoryCount = (memory?.journal_entries.length ?? 0) + (memory?.memory_bodies.length ?? 0);
```

Add `memory` to the returned `ParsedPersonaExport` object, and import `ChatsuneMemoryExport` from `./types.js`. (Confirm `decodeJson`'s real signature/return — it returns `undefined`/`null` when the file is absent; match that.)

- [ ] **Step 5: Run it — verify it passes**

Run: `pnpm --filter @chatsundere/user-client test persona-parse-memory`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm typecheck --force` → PASS.

```bash
git add apps/user-client/src/lib/chatsune-import/types.ts apps/user-client/src/lib/chatsune-import/persona-parse.ts apps/user-client/tests/lib/chatsune-import/persona-parse-memory.test.ts
git commit -m "Retain chatsune memory in the persona parser

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 2: `importChatsuneMemory`

**Files:**
- Modify: `src/data/chatsune-import.ts`
- Test: `apps/user-client/tests/data/chatsune-memory-import.test.ts`

**Interfaces:**
- Consumes: `ChatsuneMemoryExport` (Task 1); `normaliseForDedup` from `../memory/dedup.js`; `listJournal`, `getCurrentBody`, `saveBody`, `listBodyVersions` from `../memory/repo.js`; `isoToMs` (existing in this file); `getClientDataDb`, `uuidv7`; row types + `MemoryCategory`/`MemoryJournalState`.
- Produces: `importChatsuneMemory(personaId, memory): Promise<{ importedEntries: number; skippedEntries: number; importedBodies: number; skippedBodies: number }>`.

- [ ] **Step 1: Write the failing test** `apps/user-client/tests/data/chatsune-memory-import.test.ts`

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { importChatsuneMemory } from '../../src/data/chatsune-import.js';
import { getCurrentBody, listJournal } from '../../src/memory/repo.js';

const MEMORY = {
  journal_entries: [
    { content: 'Likes tea', category: 'preference', state: 'committed', is_correction: false, created_at: '2026-01-01T00:00:00Z', committed_at: '2026-01-02T00:00:00Z', auto_committed: true },
    { content: 'Has a sister', category: 'fact', state: 'uncommitted', is_correction: false, created_at: '2026-01-03T00:00:00Z' },
    { content: 'Old archived fact', category: 'fact', state: 'archived', is_correction: false, created_at: '2025-12-01T00:00:00Z' },
  ],
  memory_bodies: [
    { content: 'Body v1', token_count: 2, version: 1, entries_processed: 1, created_at: '2026-01-01T00:00:00Z' },
    { content: 'Body v2', token_count: 2, version: 2, entries_processed: 2, created_at: '2026-01-02T00:00:00Z' },
  ],
};

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  await getClientDataDb().personas.add({ id: 'p1', name: 'P', providerId: 'pr' } as never);
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('importChatsuneMemory', () => {
  it('imports non-archived entries + all bodies, preserving state', async () => {
    const res = await importChatsuneMemory('p1', MEMORY);
    expect(res.importedEntries).toBe(2); // archived skipped
    expect(res.importedBodies).toBe(2);
    const committed = await listJournal('p1', 'committed');
    expect(committed[0]?.content).toBe('Likes tea');
    expect(committed[0]?.autoCommitted).toBe(true);
    expect(committed[0]?.importedFrom).toBe('chatsune');
    expect(committed[0]?.createdAt).toBe(Date.parse('2026-01-01T00:00:00Z'));
    expect(await listJournal('p1', 'uncommitted')).toHaveLength(1);
    expect(await listJournal('p1', 'archived')).toHaveLength(0);
    const body = await getCurrentBody('p1');
    expect(body?.content).toBe('Body v2'); // latest chatsune body is current
    expect(body?.source).toBe('import');
  });

  it('is idempotent: re-import adds nothing', async () => {
    await importChatsuneMemory('p1', MEMORY);
    const res = await importChatsuneMemory('p1', MEMORY);
    expect(res.importedEntries).toBe(0);
    expect(res.skippedEntries).toBe(2);
    expect(res.importedBodies).toBe(0);
    expect(await listJournal('p1', 'committed')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @chatsundere/user-client test chatsune-memory-import`
Expected: FAIL (function not exported).

- [ ] **Step 3: Implement `importChatsuneMemory`** in `src/data/chatsune-import.ts`

Add the imports at the top (alongside the existing ones):

```ts
import { normaliseForDedup } from '../memory/dedup.js';
import { getCurrentBody, listJournal, listBodyVersions, saveBody } from '../memory/repo.js';
import type {
  MemoryCategory,
  MemoryJournalRow,
  MemoryJournalState,
} from '../boot/client-data-db.js';
import type { ChatsuneMemoryExport } from '../lib/chatsune-import/types.js';
```

Then the function (place near `importChatsuneSessions`):

```ts
const CATEGORIES: readonly string[] = ['preference', 'fact', 'correction', 'goal', 'context'];
const STATES: readonly string[] = ['uncommitted', 'committed', 'archived'];

function asCategory(v: string | null | undefined): MemoryCategory | null {
  return typeof v === 'string' && CATEGORIES.includes(v) ? (v as MemoryCategory) : null;
}
function asState(v: string | undefined): MemoryJournalState {
  return typeof v === 'string' && STATES.includes(v) ? (v as MemoryJournalState) : 'uncommitted';
}

/**
 * Import a chatsune persona's memory into the Chatsundere memory tables.
 * Bodies first (so the latest becomes current), then live (non-archived) journal
 * entries, content-deduped against the persona's existing memory for idempotency.
 */
export async function importChatsuneMemory(
  personaId: string,
  memory: ChatsuneMemoryExport,
): Promise<{ importedEntries: number; skippedEntries: number; importedBodies: number; skippedBodies: number }> {
  const db = getClientDataDb();
  let importedBodies = 0;
  let skippedBodies = 0;

  // --- bodies: dedup by content against existing imported bodies, saveBody in version order ---
  const existingBodies = await listBodyVersions(personaId);
  const seenBodies = new Set(
    existingBodies.filter((b) => b.source === 'import').map((b) => normaliseForDedup(b.content)),
  );
  const incomingBodies = [...memory.memory_bodies]
    .filter((b) => typeof b.content === 'string' && b.content.trim() !== '')
    .sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
  for (const cb of incomingBodies) {
    const norm = normaliseForDedup(cb.content);
    if (seenBodies.has(norm)) {
      skippedBodies++;
      continue;
    }
    seenBodies.add(norm);
    await saveBody(personaId, cb.content, cb.entries_processed ?? 0, 'import');
    importedBodies++;
  }

  // --- live journal entries: skip archived; dedup against existing journal + current body ---
  const existingJournal = await listJournal(personaId);
  const body = await getCurrentBody(personaId);
  const seenEntries = new Set(existingJournal.map((e) => normaliseForDedup(e.content)));
  const bodyNorm = normaliseForDedup(body?.content ?? '');

  const now = Date.now();
  const rows: MemoryJournalRow[] = [];
  let skippedEntries = 0;
  for (const je of memory.journal_entries) {
    if (typeof je.content !== 'string' || je.content.trim() === '') continue;
    if (asState(je.state) === 'archived') continue; // historical; inert + carried by bodies
    const norm = normaliseForDedup(je.content);
    if (!norm || seenEntries.has(norm) || (bodyNorm && bodyNorm.includes(norm))) {
      skippedEntries++;
      continue;
    }
    seenEntries.add(norm);
    const createdAt = isoToMs(je.created_at, now);
    rows.push({
      id: uuidv7(),
      personaId,
      content: je.content,
      category: asCategory(je.category),
      state: asState(je.state),
      isCorrection: je.is_correction === true,
      createdAt,
      committedAt: je.committed_at ? isoToMs(je.committed_at, createdAt) : null,
      autoCommitted: je.auto_committed === true,
      archivedByDreamId: null,
      importedFrom: 'chatsune',
    });
  }
  if (rows.length) await db.memoryJournal.bulkAdd(rows);

  return { importedEntries: rows.length, skippedEntries, importedBodies, skippedBodies };
}
```

(Confirm `isoToMs`'s exact signature in this file — the sessions importer uses `isoToMs(session.session_fields.created_at, fallback)`.)

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @chatsundere/user-client test chatsune-memory-import`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/data/chatsune-import.ts apps/user-client/tests/data/chatsune-memory-import.test.ts
git commit -m "Add importChatsuneMemory

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 3: Stage + import memory in the apply→Save flow

**Files:**
- Modify: `src/components/persona-editor/ChatsuneImportControl.tsx`, `src/routes/app/persona-editor.tsx`

**Interfaces:**
- Consumes: `importChatsuneMemory` (Task 2); `ParsedPersonaExport['memory']` (Task 1).
- Produces: `AppliedPersonaImport.memory`; the editor stages it and imports it on Save (after sessions), invalidating `QK.memory(pid)`.

> Integration wiring — typecheck + device-verified. **Read the real shapes first:** `AppliedPersonaImport` (`ChatsuneImportControl.tsx:11-19`), the `onApply({...})` call (`ChatsuneImportControl.tsx:66-72`), the editor's `onApplyImport` (`persona-editor.tsx:312-334`), the `importedSessions` state (`:294`), and the on-Save import block in `persistDraft` (`:409-424`).

- [ ] **Step 1: Carry `memory` in `AppliedPersonaImport`** (`ChatsuneImportControl.tsx:11-19`)

Add to the interface:

```ts
  /** The parsed chatsune memory to import on Save, or null when none. */
  memory: ParsedPersonaExport['memory'];
```

And in the `onApply({...})` call (`:66-72`) add:

```ts
      memory: preview.parsed.memory,
```

- [ ] **Step 2: Stage it in the editor** (`persona-editor.tsx`)

Add state beside `importedSessions` (`:294`):

```ts
const [importedMemory, setImportedMemory] = useState<AppliedPersonaImport['memory']>(null);
```

In `onApplyImport` (`:312-334`), after `setImportedSessions(a.sessions)`:

```ts
setImportedMemory(a.memory);
```

- [ ] **Step 3: Import on Save** (`persona-editor.tsx`, the `persistDraft` import block at `:409-424`)

Add the import import at the top:

```ts
import { importChatsuneMemory, importChatsuneSessions } from '../../data/chatsune-import.js';
```

After the `importChatsuneSessions` block (and before/after its toast), add:

```ts
if (pid && importedMemory) {
  const m = await importChatsuneMemory(pid, importedMemory);
  setImportedMemory(null);
  if (m.importedEntries > 0 || m.importedBodies > 0) {
    toastStore.show({
      message: `Imported ${m.importedEntries} ${m.importedEntries === 1 ? 'memory' : 'memories'}${
        m.importedBodies > 0 ? ' and the consolidated memory' : ''
      }.`,
      tone: 'info',
      durationMs: 3500,
    });
  }
  await qc.invalidateQueries({ queryKey: QK.memory(pid) });
}
```

(Confirm `QK` is already imported in `persona-editor.tsx`; the sessions block already uses `QK.chats`.)

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck --force` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/persona-editor/ChatsuneImportControl.tsx apps/user-client/src/routes/app/persona-editor.tsx
git commit -m "Import chatsune memory on persona-import Save

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 4: Remove the deferral anchors + close the coupling

**Files:**
- Modify: `src/components/persona-editor/ChatsuneImportControl.tsx` (the memory note), `obsidian/insights/future-feature-couplings.md`

**Interfaces:** none (UI copy + docs).

- [ ] **Step 1: Update the memory note** (`ChatsuneImportControl.tsx:111-117`)

Replace the "re-import once memory lands" note with a forward-looking one that matches the now-working flow:

```tsx
{preview.parsed.memoryCount > 0 ? (
  <p className="mt-1">
    This export contains {preview.parsed.memoryCount}{' '}
    {preview.parsed.memoryCount === 1 ? 'memory' : 'memories'} — they will be imported when
    you Save.
  </p>
) : null}
```

- [ ] **Step 2: Close the coupling** in `obsidian/insights/future-feature-couplings.md`

Move the entire `### Memory system ⇒ extend the Chatsune importer with memory import` block out of `## Open couplings` into a new `## Closed couplings` section, and prefix it with a resolution line:

```markdown
## Closed couplings

### Memory system ⇒ Chatsune importer memory import — CLOSED 2026-06-20

Resolved: `importChatsuneMemory` (`src/data/chatsune-import.ts`) imports
`memory.json` (`journal_entries` non-archived + `memory_bodies`) on persona-import
Save, content-deduped for idempotency. Plan: `superpowers/plans/2026-06-20-memory-import.md`.

[original block text retained below for the record]
```

(Keep the original descriptive paragraph beneath, so the register reads as a closed obligation, not a deleted one. If `## Open couplings` becomes empty, leave the heading with a "(none)" line.)

- [ ] **Step 3: Verify the full gate**

Run: `pnpm typecheck --force` → PASS.
Run: `pnpm --filter @chatsundere/user-client test` → all memory + import tests green; the rest at the **8 Node-localStorage baseline**.

- [ ] **Step 4: Commit** (mixed code + docs → no `[skip ci]`)

```bash
git add apps/user-client/src/components/persona-editor/ChatsuneImportControl.tsx obsidian/insights/future-feature-couplings.md
git commit -m "Close the memory→importer coupling; update the import note

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Manual Verification (Chris, on device)

1. Export a persona with memories from chatsune (or use a saved `.chatsune-persona.tar.gz` that has `memory.json`). In Chatsundere, import it as a **new persona**: the preview note says "N memories — imported when you Save"; after Save, a toast confirms the import.
2. Open the persona's Memory section: the consolidated body is present (the chatsune latest body), and committed/uncommitted entries appear. The companion visibly "remembers" the imported facts in a fresh chat.
3. **Idempotent re-import:** import the same export again (new persona OR merge-into-existing) — no duplicate memories appear.
4. **Merge-into-existing:** import memories into a persona that already chatted a little — imported memory coexists with native, no crash, the imported body becomes current.

---

## Self-Review

**Spec coverage (against `2026-06-20-memory-design.md` §7):**
- §7 retain parsed memory → Task 1. ✓
- §7 `importChatsuneMemory` mapping (journal + bodies, drop source_session_id, importedFrom, source:'import') → Task 2 (with the resolved "skip archived" + "bodies via saveBody" decisions). ✓
- §7 wire both entry points (new persona + merge-into-existing both flow through the editor's on-Save block, which runs for either path) → Task 3. ✓
- §7 idempotency → Task 2 (content-dedup). ✓
- §7 remove anchors + close register → Task 4 (the `FUTURE:` comment was dropped in Task 1). ✓

**Placeholder scan:** none — every step has concrete code. The test archive constructor is marked "adapt to the real ChatsuneArchive type" because the parser's input shape must be confirmed against `persona-parse.ts` — the implementer reads it in Task 1.

**Type consistency:** `ChatsuneMemoryExport` (Task 1) consumed by `importChatsuneMemory` (Task 2) and `AppliedPersonaImport.memory` (Task 3). `importChatsuneMemory`'s return shape matches the toast in Task 3. `saveBody`/`listJournal`/`getCurrentBody`/`listBodyVersions` signatures match Plan-1/Plan-2 repo.

---

## Execution Handoff

After Plan 3 lands + device-verifies, the memory feature is complete (engine + UI + import). Next: a **Laura pre-squash pass** on the whole built flow, then the **single unified squash** (Plans 1-3) to master, then Chris pushes.
