// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ChatRow,
  type MessageRow,
  type PersonaRow,
  getClientDataDb,
} from '../boot/client-data-db.js';
import { labelFor } from '../lib/toc.js';
import { mutateSynced } from '../sync/enqueue.js';
import { QK } from './queryKeys.js';

export interface BookmarkGroup {
  chat: ChatRow;
  persona: PersonaRow | null;
  bookmarks: { message: MessageRow; label: string }[];
}

/** Set or clear a message's custom bookmark label. */
export async function setBookmarkLabel(args: {
  messageId: string;
  label: string | null;
}): Promise<void> {
  // Class-2 edit of `messages.bookmarkLabel` (spec §5), same family as the
  // bookmark toggle — disabled offline with the gentle copy (§11.3).
  await mutateSynced({
    collection: 'messages',
    key: args.messageId,
    tables: ['messages'],
    write: async (tx) => {
      await tx.table('messages').update(args.messageId, {
        bookmarkLabel: args.label,
        updatedAt: Date.now(),
      });
    },
  });
}

/** All starred messages, grouped by chat (most-recently-active chat first),
 *  each bookmark carrying its resolved display label. */
export async function bookmarkGroups(): Promise<BookmarkGroup[]> {
  const db = getClientDataDb();
  const starred = await db.messages.filter((m) => m.bookmarked === true).toArray();
  if (starred.length === 0) return [];

  const byChat = new Map<string, MessageRow[]>();
  for (const m of starred) {
    const arr = byChat.get(m.chatId) ?? [];
    arr.push(m);
    byChat.set(m.chatId, arr);
  }

  const groups: BookmarkGroup[] = [];
  for (const [chatId, msgs] of byChat) {
    const chat = await db.chats.get(chatId);
    if (!chat) continue; // orphaned star (chat deleted) — skip defensively
    const persona = (await db.personas.get(chat.personaId)) ?? null;
    msgs.sort((a, b) => a.createdAt - b.createdAt);
    groups.push({
      chat,
      persona,
      bookmarks: msgs.map((m) => ({ message: m, label: labelFor(m) })),
    });
  }
  groups.sort((a, b) => b.chat.lastMessageAt - a.chat.lastMessageAt);
  return groups;
}

/** Reactive list of all starred bookmarks grouped by chat. */
export function useBookmarks() {
  return useQuery({ queryKey: QK.bookmarks, queryFn: bookmarkGroups });
}

/** Set/clear a message's custom bookmark label; invalidates chat + bookmark caches. */
export function useSetBookmarkLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: setBookmarkLabel,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chats'] });
      void qc.invalidateQueries({ queryKey: QK.bookmarks });
    },
  });
}
