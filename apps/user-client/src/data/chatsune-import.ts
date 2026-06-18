// SPDX-License-Identifier: AGPL-3.0-only

import { uuidv7 } from 'uuidv7';
import { type DocumentRow, getClientDataDb } from '../boot/client-data-db.js';
import { enqueueDocument } from '../knowledge/start-ingestion.js';
import type { ParsedKnowledgeExport } from '../lib/chatsune-import/knowledge-parse.js';
import { mapChatsuneMessage } from '../lib/chatsune-import/message-map.js';
import type { ChatsuneSessionExport } from '../lib/chatsune-import/types.js';
import { normalisePhrases } from '../lib/treasury-filter.js';
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
