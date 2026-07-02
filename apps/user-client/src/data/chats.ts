// SPDX-License-Identifier: AGPL-3.0-only

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import { type ChatRow, type ContentBlock, getClientDataDb } from '../boot/client-data-db.js';
import { useStreamManagerStore } from '../state/stream-manager.store.js';
import { enqueueSync, isLinkedForSync, mutateSynced } from '../sync/enqueue.js';
import { patchTouchesSyncedField } from '../sync/strip.js';
import { scheduleClass1Sync } from '../sync/triggers.js';
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
    mutationFn: async (args: {
      personaId: string;
      openerPending?: boolean;
      draftInput?: string;
    }): Promise<string> => {
      const db = getClientDataDb();
      const persona = await db.personas.get(args.personaId);
      if (!persona) throw new Error(`useCreateChat: persona ${args.personaId} not found`);
      const settings = await db.settings.get(1);
      const resolvedMindspaceId = persona.mindspaceId ?? settings?.defaultMindspaceId;
      if (!resolvedMindspaceId) throw new Error('useCreateChat: no mindspace to snapshot');
      const id = uuidv7();
      const now = Date.now();
      const linked = isLinkedForSync();
      // Class-1 creation-insert: the chat row and its outbox row are atomic.
      await db.transaction('rw', [db.chats, db.syncOutbox], async (tx) => {
        await db.chats.add({
          id,
          personaId: args.personaId,
          title: null,
          resolvedMindspaceId,
          createdAt: now,
          updatedAt: now,
          lastMessageAt: now,
          bookmarkedMessageCount: 0,
          draftInput: args.draftInput ?? '',
          libraryIds: [],
          ...(args.openerPending ? { openerPending: true } : {}),
        });
        if (linked) enqueueSync(tx, 'chats', id, 'upsert');
      });
      if (linked) scheduleClass1Sync();
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
      // Field-split (spec §5/§10): a device-local-only patch (`draftInput`,
      // `openerPending`, derived fields) stays editable offline as a plain write;
      // a synced-field patch (`title` rename, `libraryIds`, …) is a Class-2
      // mutation stamped with a fresh `updatedAt` for LWW and gated through
      // `mutateSynced`.
      if (!patchTouchesSyncedField('chats', Object.keys(args.patch))) {
        await getClientDataDb().chats.update(args.id, args.patch);
        return;
      }
      await mutateSynced({
        collection: 'chats',
        key: args.id,
        tables: ['chats'],
        write: async (tx) => {
          await tx.table('chats').update(args.id, { ...args.patch, updatedAt: Date.now() });
        },
      });
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: QK.chat(vars.id) });
      void qc.invalidateQueries({ queryKey: QK.chats });
    },
  });
}

/** Set the ad-hoc knowledge libraries for a single chat. `libraryIds` is a
 *  synced field, so this is a Class-2 edit (spec §5). */
export async function setChatLibraries(chatId: string, libraryIds: string[]): Promise<void> {
  await mutateSynced({
    collection: 'chats',
    key: chatId,
    tables: ['chats'],
    write: async (tx) => {
      await tx.table('chats').update(chatId, { libraryIds, updatedAt: Date.now() });
    },
  });
}

/** Set the ad-hoc knowledge libraries for a single chat (React-Query hook). */
export function useSetChatLibraries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { chatId: string; libraryIds: string[] }) =>
      setChatLibraries(args.chatId, args.libraryIds),
    onSuccess: (_v, args) => {
      void qc.invalidateQueries({ queryKey: QK.chat(args.chatId) });
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
      // Class-2 edit of `messages.bookmarked` (spec §5): offline bookmarking is
      // disabled at the affordance (gentle copy, §11.3) — the throw is the
      // backstop. The parent chat's `bookmarkedMessageCount` is a device-local
      // derived field (§10 deny-list): recomputed in the same transaction but
      // never enqueued.
      await mutateSynced({
        collection: 'messages',
        key: messageId,
        tables: ['messages', 'chats'],
        write: async (tx) => {
          await tx.table('messages').update(messageId, { bookmarked: next, updatedAt: Date.now() });
          const chat = await tx.table('chats').get(message.chatId);
          if (chat) {
            const delta = next ? 1 : -1;
            await tx.table('chats').update(message.chatId, {
              bookmarkedMessageCount: Math.max(0, chat.bookmarkedMessageCount + delta),
            });
          }
        },
      });
    },
    onSuccess: () => {
      // Broad invalidation — we don't know which chat query is mounted.
      void qc.invalidateQueries({ queryKey: QK.chats });
      void qc.invalidateQueries({ queryKey: ['chats'] });
      void qc.invalidateQueries({ queryKey: QK.bookmarks });
    },
  });
}

/**
 * Delete a chat and everything it owns (messages, pills, attachments, artefacts).
 * A shame-delete (spec §5): the local rows go immediately, and the chat plus its
 * synced children (messages, pills) enqueue `delete` tombstones so they follow on
 * other devices (the apply pipeline never cascades). `attachments`/`artefacts`
 * are blob collections (WS-D) — removed locally, not tombstoned here.
 */
export async function deleteChatCascade(chatId: string): Promise<void> {
  const db = getClientDataDb();
  const msgs = await db.messages.where('chatId').equals(chatId).toArray();
  const msgIds = msgs.map((m) => m.id);
  const pills = msgIds.length > 0 ? await db.pills.where('messageId').anyOf(msgIds).toArray() : [];
  const pillIds = pills.map((p) => p.id);

  await mutateSynced({
    collection: 'chats',
    key: chatId,
    op: 'delete',
    tables: ['chats', 'messages', 'pills', 'attachments', 'artefacts'],
    cascade: [
      ...msgIds.map((k) => ({ collection: 'messages' as const, key: k })),
      ...pillIds.map((k) => ({ collection: 'pills' as const, key: k })),
    ],
    write: async (tx) => {
      if (pillIds.length > 0) await tx.table('pills').bulkDelete(pillIds);
      await tx.table('attachments').where('chatId').equals(chatId).delete();
      await tx.table('artefacts').where('chatId').equals(chatId).delete();
      if (msgIds.length > 0) await tx.table('messages').bulkDelete(msgIds);
      await tx.table('chats').delete(chatId);
    },
  });
}

/**
 * Delete a chat and cascade-delete its messages, pills, attachments and
 * artefacts inside a single Dexie transaction. Pre-step: abort any live
 * background stream for this chat via `useStreamManagerStore.abortDiscard`
 * (no-op when no stream).
 *
 * Invalidates the chat list on success. Per spec §3.7.
 */
export function useDeleteChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (chatId: string): Promise<void> => {
      // Abort any live stream first so we don't leave a controller dangling.
      await useStreamManagerStore.getState().abortDiscard(chatId);
      await deleteChatCascade(chatId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.chats });
      void qc.invalidateQueries({ queryKey: ['artefacts'] });
    },
  });
}

/**
 * Fork a chat at a given message into a new, fully independent session.
 * Copies the chat row plus every message and pill up to AND INCLUDING the
 * branch-point message, assigning fresh ids throughout. Pill-id references
 * inside copied `contentBlocks` are rewritten to point at the new pills.
 * Persona/provider/mindspace are referenced, never duplicated.
 *
 * Returns the new chat's id. Throws if the source chat or branch-point
 * message is absent (e.g. raced against a delete) — the transaction aborts
 * and leaves no partial branch.
 */
export function useBranchChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      sourceChatId: string;
      branchPointMessageId: string;
      title: string;
    }): Promise<string> => {
      const db = getClientDataDb();
      const newChatId = uuidv7();
      const now = Date.now();
      const linked = isLinkedForSync();

      await db.transaction('rw', [db.chats, db.messages, db.pills, db.syncOutbox], async (tx) => {
        const source = await db.chats.get(args.sourceChatId);
        if (!source) throw new Error(`useBranchChat: source chat ${args.sourceChatId} not found`);

        const allMsgs = await db.messages
          .where('chatId')
          .equals(args.sourceChatId)
          .sortBy('createdAt');
        const cutIdx = allMsgs.findIndex((m) => m.id === args.branchPointMessageId);
        if (cutIdx === -1)
          throw new Error(`useBranchChat: branch point ${args.branchPointMessageId} not found`);
        const copied = allMsgs.slice(0, cutIdx + 1);

        const copiedIds = copied.map((m) => m.id);
        const pills = copiedIds.length
          ? await db.pills.where('messageId').anyOf(copiedIds).toArray()
          : [];

        const msgIdMap = new Map(copied.map((m) => [m.id, uuidv7()]));
        const pillIdMap = new Map(pills.map((pl) => [pl.id, uuidv7()]));

        const lastCopied = copied[copied.length - 1];
        await db.chats.add({
          id: newChatId,
          personaId: source.personaId,
          title: args.title,
          resolvedMindspaceId: source.resolvedMindspaceId,
          createdAt: now,
          updatedAt: now,
          lastMessageAt: lastCopied?.createdAt ?? now,
          bookmarkedMessageCount: copied.filter((m) => m.bookmarked).length,
          draftInput: '',
          libraryIds: [...source.libraryIds],
        });
        // Class-1 creation-inserts: the branch mints fresh uuids across chat,
        // messages and pills; each is enqueued atomically inside this transaction.
        if (linked) enqueueSync(tx, 'chats', newChatId, 'upsert');

        for (const m of copied) {
          const newMessageId = msgIdMap.get(m.id) ?? uuidv7();
          const blocks = (structuredClone(m.contentBlocks) as ContentBlock[]).map((b) =>
            b.type === 'pill' ? { ...b, pillId: pillIdMap.get(b.pillId) ?? b.pillId } : b,
          );
          await db.messages.add({
            id: newMessageId,
            chatId: newChatId,
            role: m.role,
            contentBlocks: blocks,
            createdAt: m.createdAt,
            updatedAt: m.updatedAt,
            bookmarked: m.bookmarked,
            bookmarkLabel: m.bookmarkLabel,
            kind: m.kind,
            streamingState: m.streamingState,
          });
          if (linked) enqueueSync(tx, 'messages', newMessageId, 'upsert');
        }

        for (const pl of pills) {
          const newPillId = pillIdMap.get(pl.id) ?? uuidv7();
          await db.pills.add({
            id: newPillId,
            messageId: msgIdMap.get(pl.messageId) ?? pl.messageId,
            kind: pl.kind,
            positionHint: pl.positionHint,
            status: pl.status,
            payload: structuredClone(pl.payload),
            createdAt: pl.createdAt,
          });
          if (linked) enqueueSync(tx, 'pills', newPillId, 'upsert');
        }
      });

      if (linked) scheduleClass1Sync();
      return newChatId;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.chats });
    },
  });
}
