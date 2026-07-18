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
