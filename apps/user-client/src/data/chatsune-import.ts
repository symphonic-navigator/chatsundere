// SPDX-License-Identifier: AGPL-3.0-only

import { uuidv7 } from 'uuidv7';
import {
  type DocumentRow,
  type MemoryCategory,
  type MemoryJournalRow,
  type MemoryJournalState,
  getClientDataDb,
} from '../boot/client-data-db.js';
import { enqueueDocument } from '../knowledge/start-ingestion.js';
import type { ParsedKnowledgeExport } from '../lib/chatsune-import/knowledge-parse.js';
import { mapChatsuneMessage } from '../lib/chatsune-import/message-map.js';
import type { ChatsuneMemoryExport, ChatsuneSessionExport } from '../lib/chatsune-import/types.js';
import { normalisePhrases } from '../lib/treasury-filter.js';
import { normaliseForDedup } from '../memory/dedup.js';
import { getCurrentBody, listBodyVersions, listJournal, saveBody } from '../memory/repo.js';
import { createLibrary } from './knowledge.js';

function isoToMs(s: string | undefined, fallback: number): number {
  const v = s ? Date.parse(s) : Number.NaN;
  return Number.isFinite(v) ? v : fallback;
}

/** Sessions that will actually import (non-deleted). */
function importableSessions(sessions: ChatsuneSessionExport[]): ChatsuneSessionExport[] {
  return sessions.filter((s) => !s.session_fields.deleted_at);
}

/**
 * Preview how many sessions would import vs. be skipped as already-imported.
 * `personaId` null = create mode (nothing exists yet → all new).
 */
export async function previewChatsuneSessions(
  personaId: string | null,
  sessions: ChatsuneSessionExport[],
): Promise<{ newCount: number; skippedCount: number }> {
  const importable = importableSessions(sessions);
  if (!personaId) return { newCount: importable.length, skippedCount: 0 };
  const existing = await getClientDataDb().chats.where('personaId').equals(personaId).toArray();
  const seen = new Set(existing.map((c) => c.importedFrom).filter((v): v is string => !!v));
  let newCount = 0;
  let skippedCount = 0;
  for (const s of importable) {
    if (seen.has(s.original_id)) skippedCount++;
    else newCount++;
  }
  return { newCount, skippedCount };
}

/**
 * Merge chatsune sessions into a persona's chats (spec §6). Additive, idempotent
 * per persona (dedup by `original_id`), Tier A messages, tool messages skipped,
 * deleted sessions skipped. One Dexie transaction.
 */
export async function importChatsuneSessions(
  personaId: string,
  sessions: ChatsuneSessionExport[],
): Promise<{ imported: number; skipped: number }> {
  const db = getClientDataDb();
  const persona = await db.personas.get(personaId);
  if (!persona) throw new Error(`importChatsuneSessions: persona ${personaId} not found`);
  const settings = await db.settings.get(1);
  const resolvedMindspaceId = persona.mindspaceId ?? settings?.defaultMindspaceId;
  if (!resolvedMindspaceId) throw new Error('importChatsuneSessions: no mindspace to snapshot');

  const now = Date.now();
  let imported = 0;
  let skipped = 0;

  await db.transaction('rw', db.chats, db.messages, async () => {
    const existing = await db.chats.where('personaId').equals(personaId).toArray();
    const seen = new Set(existing.map((c) => c.importedFrom).filter((v): v is string => !!v));

    for (const session of importableSessions(sessions)) {
      if (seen.has(session.original_id)) {
        skipped++;
        continue;
      }
      seen.add(session.original_id);
      const chatId = uuidv7();
      const createdAt = isoToMs(session.session_fields.created_at, now);
      await db.chats.add({
        id: chatId,
        personaId,
        title: session.session_fields.title ?? null,
        resolvedMindspaceId,
        createdAt,
        lastMessageAt: isoToMs(session.session_fields.updated_at, createdAt),
        bookmarkedMessageCount: 0,
        draftInput: '',
        libraryIds: [],
        importedFrom: session.original_id,
      });

      let index = 0;
      for (const m of session.messages) {
        const mapped = mapChatsuneMessage(m, createdAt + index);
        index++;
        if (!mapped) continue;
        await db.messages.add({
          id: uuidv7(),
          chatId,
          role: mapped.role,
          contentBlocks: mapped.contentBlocks,
          createdAt: mapped.createdAt,
          bookmarked: false,
          streamingState: 'complete',
        });
      }
      imported++;
    }
  });

  return { imported, skipped };
}

/**
 * Import a parsed chatsune knowledge export as a NEW library (spec §7 — no dedup,
 * the export carries no stable ids). Non-empty documents land `pending` and are
 * enqueued for local re-embedding.
 */
export async function importChatsuneLibrary(parsed: ParsedKnowledgeExport): Promise<string> {
  const library = await createLibrary({
    name: parsed.name,
    description: parsed.description,
    nsfw: parsed.nsfw,
  });
  const now = Date.now();
  const rows: DocumentRow[] = [];
  for (const d of parsed.documents) {
    if (d.content.trim().length === 0) continue;
    rows.push({
      id: uuidv7(),
      libraryId: library.id,
      title: d.title.trim() || 'Untitled',
      content: d.content,
      embeddingStatus: 'pending',
      embeddingError: null,
      chunkCount: 0,
      triggerPhrases: normalisePhrases(d.triggerPhrases),
      createdAt: now,
      updatedAt: now,
    });
  }
  if (rows.length > 0) {
    await getClientDataDb().documents.bulkAdd(rows);
    for (const row of rows) enqueueDocument(row.id);
  }
  return library.id;
}

// Guard sets for runtime-narrowing chatsune wire strings into our union types.
const VALID_CATEGORIES: readonly string[] = ['preference', 'fact', 'correction', 'goal', 'context'];
const VALID_STATES: readonly string[] = ['uncommitted', 'committed', 'archived'];

function asCategory(v: string | null | undefined): MemoryCategory | null {
  return typeof v === 'string' && VALID_CATEGORIES.includes(v) ? (v as MemoryCategory) : null;
}

function asState(v: string | undefined): MemoryJournalState {
  return typeof v === 'string' && VALID_STATES.includes(v)
    ? (v as MemoryJournalState)
    : 'uncommitted';
}

/**
 * Import a chatsune persona's memory into the Chatsundere memory tables.
 * Bodies are written first (ascending version order) so the latest becomes the
 * current body. Non-archived journal entries follow. Both are content-deduped
 * against existing data for full idempotency.
 */
export async function importChatsuneMemory(
  personaId: string,
  memory: ChatsuneMemoryExport,
): Promise<{
  importedEntries: number;
  skippedEntries: number;
  importedBodies: number;
  skippedBodies: number;
}> {
  const db = getClientDataDb();
  let importedBodies = 0;
  let skippedBodies = 0;

  // --- Bodies: dedup by normalised content, insert in ascending version order ---
  // Each body is appended as a new version via saveBody, so the latest imported
  // body becomes the persona's current memory. When merging into a persona that
  // already has native memory, this intentionally supersedes the native current
  // body ("migrate my memory" semantics); the native body survives as a rollback
  // target until saveBody's prune-to-5 drops it.
  const existingBodies = await listBodyVersions(personaId);
  const seenBodyNorms = new Set(existingBodies.map((b) => normaliseForDedup(b.content)));
  // Keep at most the latest 5 by version — genuine chatsune exports already prune
  // to 5, so this only guards a malformed export and keeps idempotency independent
  // of the upstream cap.
  const incomingBodies = [...memory.memory_bodies]
    .filter((b) => typeof b.content === 'string' && b.content.trim() !== '')
    .sort((a, b) => (a.version ?? 0) - (b.version ?? 0))
    .slice(-5);

  for (const cb of incomingBodies) {
    const norm = normaliseForDedup(cb.content);
    if (seenBodyNorms.has(norm)) {
      skippedBodies++;
      continue;
    }
    seenBodyNorms.add(norm);
    await saveBody(personaId, cb.content, cb.entries_processed ?? 0, 'import');
    importedBodies++;
  }

  // --- Journal entries: skip archived; dedup against existing journal entries and body prose ---
  const existingJournal = await listJournal(personaId);
  const seenEntryNorms = new Set(existingJournal.map((e) => normaliseForDedup(e.content)));

  // Compute after the bodies loop so getCurrentBody reflects the just-imported body.
  const currentBody = await getCurrentBody(personaId);
  const bodyNorm = normaliseForDedup(currentBody?.content ?? '');

  const now = Date.now();
  const rows: MemoryJournalRow[] = [];
  let skippedEntries = 0;

  for (const je of memory.journal_entries) {
    if (typeof je.content !== 'string' || je.content.trim() === '') continue;
    if (asState(je.state) === 'archived') continue; // inert — already folded into bodies
    const norm = normaliseForDedup(je.content);
    if (!norm || seenEntryNorms.has(norm) || (bodyNorm !== '' && bodyNorm.includes(norm))) {
      skippedEntries++;
      continue;
    }
    seenEntryNorms.add(norm);
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
