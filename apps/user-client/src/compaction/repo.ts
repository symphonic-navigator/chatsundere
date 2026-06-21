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
  const rows = await getClientDataDb()
    .compactionCheckpoints.where('chatId')
    .equals(chatId)
    .toArray();
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
