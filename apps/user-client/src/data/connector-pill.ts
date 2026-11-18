// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { getClientDataDb } from '../boot/client-data-db.js';
import { queryClient } from '../lib/queryClient.js';
import { enqueueSync, isLinkedForSync } from '../sync/enqueue.js';
import { scheduleClass1Sync } from '../sync/triggers.js';
import { QK } from './queryKeys.js';

/** The chat a message belongs to, or null when the message is gone. */
export async function chatIdOfMessage(messageId: string): Promise<string | null> {
  return (await getClientDataDb().messages.get(messageId))?.chatId ?? null;
}

/**
 * The chat of a pill's message row, for the card's paths. A message never moves
 * between chats, so the answer is cached for good.
 */
export function useMessageChatId(messageId: string) {
  return useQuery({
    queryKey: ['messages', messageId, 'chatId'] as const,
    queryFn: () => chatIdOfMessage(messageId),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * Marks a connector card as dismissed with *Not now*: only `connectorDismissedAt`
 * is written, a field the tool replay never reads (add-mcp-connector spec §7).
 * False when the pill is gone.
 */
export async function dismissConnectorPill(pillId: string): Promise<boolean> {
  const db = getClientDataDb();
  const linked = isLinkedForSync();
  const chatId = await db.transaction('rw', [db.pills, db.messages, db.syncOutbox], async (tx) => {
    const pill = await db.pills.get(pillId);
    if (!pill) return undefined;
    const payload =
      typeof pill.payload === 'object' && pill.payload !== null
        ? (pill.payload as Record<string, unknown>)
        : {};
    await db.pills.put({ ...pill, payload: { ...payload, connectorDismissedAt: Date.now() } });
    if (linked) enqueueSync(tx, 'pills', pillId, 'upsert');
    return (await db.messages.get(pill.messageId))?.chatId ?? null;
  });
  if (chatId === undefined) return false;
  if (linked) scheduleClass1Sync();
  if (chatId !== null) void queryClient.invalidateQueries({ queryKey: QK.chat(chatId) });
  return true;
}
