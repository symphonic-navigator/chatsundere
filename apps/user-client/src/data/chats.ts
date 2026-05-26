// SPDX-License-Identifier: AGPL-3.0-only

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import { type ChatRow, getClientDataDb } from '../boot/client-data-db.js';
import { useStreamManagerStore } from '../state/stream-manager.store.js';
import { QK } from './queryKeys.js';

/** List all chat rows ordered by most-recently-active first. */
export function useChats() {
  return useQuery({
    queryKey: QK.chats,
    queryFn: async () => {
      const db = getClientDataDb();
      return await db.chats.orderBy('lastMessageAt').reverse().toArray();
    },
  });
}

/**
 * Fetch a single chat by id, including its messages and any inline pills.
 * Disabled (no fetch) when `chatId` is `null`.
 */
export function useChat(chatId: string | null) {
  return useQuery({
    queryKey: chatId ? QK.chat(chatId) : ['chats', '__none'],
    enabled: chatId !== null,
    queryFn: async () => {
      if (!chatId) return null;
      const db = getClientDataDb();
      const chat = await db.chats.get(chatId);
      if (!chat) return null;
      const messages = await db.messages.where('chatId').equals(chatId).sortBy('createdAt');
      const messageIds = messages.map((m) => m.id);
      const pills = messageIds.length
        ? await db.pills.where('messageId').anyOf(messageIds).toArray()
        : [];
      return { chat, messages, pills };
    },
  });
}

/**
 * Create a new chat row for the given persona.
 * Snapshots `resolvedMindspaceId` from the persona at creation time,
 * falling back to `settings.defaultMindspaceId` if the persona has no
 * explicit mindspace set. Invalidates the chat list on success.
 */
export function useCreateChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { personaId: string }): Promise<string> => {
      const db = getClientDataDb();
      const persona = await db.personas.get(args.personaId);
      if (!persona) throw new Error(`useCreateChat: persona ${args.personaId} not found`);
      const settings = await db.settings.get(1);
      const resolvedMindspaceId = persona.mindspaceId ?? settings?.defaultMindspaceId;
      if (!resolvedMindspaceId) throw new Error('useCreateChat: no mindspace to snapshot');
      const id = uuidv7();
      const now = Date.now();
      await db.chats.add({
        id,
        personaId: args.personaId,
        title: null,
        resolvedMindspaceId,
        createdAt: now,
        lastMessageAt: now,
        bookmarkedMessageCount: 0,
        draftInput: '',
      });
      return id;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.chats });
    },
  });
}

/**
 * Apply a partial patch to an existing chat row.
 * Invalidates both the individual chat query and the chat list on success.
 */
export function useUpdateChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; patch: Partial<ChatRow> }): Promise<void> => {
      await getClientDataDb().chats.update(args.id, args.patch);
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: QK.chat(vars.id) });
      void qc.invalidateQueries({ queryKey: QK.chats });
    },
  });
}

/**
 * Toggle the `bookmarked` flag on a single message and keep the parent
 * chat's `bookmarkedMessageCount` in sync. Both writes happen inside a
 * single Dexie transaction so they are always consistent.
 */
export function useToggleBookmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (messageId: string): Promise<void> => {
      const db = getClientDataDb();
      const message = await db.messages.get(messageId);
      if (!message) return;
      const next = !message.bookmarked;
      await db.transaction('rw', db.messages, db.chats, async () => {
        await db.messages.update(messageId, { bookmarked: next });
        const chat = await db.chats.get(message.chatId);
        if (chat) {
          const delta = next ? 1 : -1;
          await db.chats.update(message.chatId, {
            bookmarkedMessageCount: Math.max(0, chat.bookmarkedMessageCount + delta),
          });
        }
      });
    },
    onSuccess: () => {
      // Broad invalidation — we don't know which chat query is mounted.
      void qc.invalidateQueries({ queryKey: QK.chats });
      void qc.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

/**
 * Delete a chat and cascade-delete its messages + pills inside a single
 * Dexie transaction. Pre-step: abort any live background stream for this
 * chat via `useStreamManagerStore.abortDiscard` (no-op when no stream).
 *
 * Invalidates the chat list on success. Per spec §3.7.
 */
export function useDeleteChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (chatId: string): Promise<void> => {
      // Abort any live stream first so we don't leave a controller dangling.
      await useStreamManagerStore.getState().abortDiscard(chatId);

      const db = getClientDataDb();
      await db.transaction('rw', db.chats, db.messages, db.pills, async () => {
        const msgs = await db.messages.where('chatId').equals(chatId).toArray();
        const msgIds = msgs.map((m) => m.id);
        if (msgIds.length > 0) {
          await db.pills.where('messageId').anyOf(msgIds).delete();
        }
        await db.messages.where('chatId').equals(chatId).delete();
        await db.chats.delete(chatId);
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.chats });
    },
  });
}
