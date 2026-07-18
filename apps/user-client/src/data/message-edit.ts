// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import { getClientDataDb } from '../boot/client-data-db.js';
import type { ContentBlock, MessageRow } from '../boot/client-data-db.js';
import type { ReasoningState } from '../lib/reasoning-resolver.js';
import { enqueueSync, isLinkedForSync, mutateSynced } from '../sync/enqueue.js';
import { scheduleClass1Sync } from '../sync/triggers.js';
import { commitEditAttachmentsToMessage, copyEditAttachmentsToChat } from './attachments.js';
import { useRegenerate, useSendMessage } from './send-message.js';

/** The highest-createdAt real user message (role 'user', not a pre-seed row). */
export function lastRealUserMessage(msgs: MessageRow[]): MessageRow | undefined {
  let best: MessageRow | undefined;
  for (const m of msgs) {
    if (m.role !== 'user' || m.seedRole) continue;
    if (!best || m.createdAt > best.createdAt) best = m;
  }
  return best;
}

/**
 * Whether `editingMessageId` is *currently* the last real user message — the
 * sole condition under which Replace-in-place is offered. Derived live so an
 * older message, or one another device has since continued past, correctly
 * yields false (spec §6).
 */
export function canReplaceInPlace(msgs: MessageRow[], editingMessageId: string): boolean {
  return lastRealUserMessage(msgs)?.id === editingMessageId;
}

/** Concatenated text of a message's text blocks (mirrors the regenerate path). */
export function messageText(msg: MessageRow): string {
  return msg.contentBlocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

export interface EditReplaceArgs {
  chatId: string;
  messageId: string;
  text: string;
  stagedRemovals: string[];
  reasoning: ReasoningState;
}

/** Replace-in-place (spec §6.1): overwrite the edited user message, commit its
 *  attachment changes, then re-roll the following reply via the existing
 *  regenerate path. Only valid when the message is the last user message. */
export function useEditAndReplace() {
  const qc = useQueryClient();
  const regenerate = useRegenerate();
  return useMutation({
    mutationFn: async (args: EditReplaceArgs): Promise<void> => {
      await mutateSynced({
        collection: 'messages',
        key: args.messageId,
        tables: ['messages'],
        write: async (tx) => {
          await tx.table('messages').update(args.messageId, {
            contentBlocks: [{ type: 'text', text: args.text }],
            updatedAt: Date.now(),
          });
        },
      });
      await commitEditAttachmentsToMessage(args.chatId, args.messageId, args.stagedRemovals);
      const db = getClientDataDb();
      await db.chats.update(args.chatId, { editingMessageId: null });

      // Re-roll the reply that FOLLOWS the edited message — whatever its state
      // (complete, incomplete, or failed). We pin it explicitly rather than let
      // useRegenerate's heuristic pick the last *complete* reply, which would
      // skip an incomplete trailing reply and re-roll an earlier turn (spec §6.1).
      const msgs = await db.messages.where('chatId').equals(args.chatId).sortBy('createdAt');
      const edited = msgs.find((m) => m.id === args.messageId);
      const followingReply = edited
        ? msgs.find((m) => m.role === 'persona' && m.createdAt > edited.createdAt)
        : undefined;

      await regenerate.mutateAsync({
        chatId: args.chatId,
        reasoning: args.reasoning,
        ...(followingReply ? { targetMessageId: followingReply.id } : {}),
      });
    },
    // onSettled (not onSuccess): the edited-text write + attachment commit +
    // clearing editingMessageId all commit before regenerate.mutateAsync runs, so
    // caches must be invalidated even if the re-roll throws — otherwise the
    // one-shot useChat query never re-runs and the composer stays stuck in edit
    // mode. Mirrors useEditAndBranch's onSettled.
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: ['chats', vars.chatId] });
      void qc.invalidateQueries({ queryKey: ['attachments', 'pending'] });
    },
  });
}

/** Copy a chat + all messages/pills BEFORE `beforeMessageId` (exclusive) into a
 *  fresh chat. Returns the new chat id. Mirrors useBranchChat but stops before
 *  the cut and auto-titles (title: null). */
async function copyPriorMessages(sourceChatId: string, beforeMessageId: string): Promise<string> {
  const db = getClientDataDb();
  const newChatId = uuidv7();
  const now = Date.now();
  const linked = isLinkedForSync();

  await db.transaction('rw', [db.chats, db.messages, db.pills, db.syncOutbox], async (tx) => {
    const source = await db.chats.get(sourceChatId);
    if (!source) throw new Error(`copyPriorMessages: source chat ${sourceChatId} not found`);

    const allMsgs = await db.messages.where('chatId').equals(sourceChatId).sortBy('createdAt');
    const cutIdx = allMsgs.findIndex((m) => m.id === beforeMessageId);
    if (cutIdx === -1) throw new Error(`copyPriorMessages: cut ${beforeMessageId} not found`);
    const copied = allMsgs.slice(0, cutIdx); // EXCLUSIVE of the edited message

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
      title: null,
      resolvedMindspaceId: source.resolvedMindspaceId,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: lastCopied?.createdAt ?? now,
      bookmarkedMessageCount: copied.filter((m) => m.bookmarked).length,
      draftInput: '',
      libraryIds: [...source.libraryIds],
    });
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
}

export interface EditBranchArgs {
  sourceChatId: string;
  personaId: string;
  editingMessageId: string;
  text: string;
  stagedRemovals: string[];
  reasoning: ReasoningState;
}

/** Branch-on-edit (spec §6.2): fork the chat up to (exclusive of) the edited
 *  message, carry the edited attachments over, then re-issue the edited message
 *  through the normal send path into the new chat. Returns the new chat id.
 *
 *  Known limitation (matches existing `useBranchChat`): copied prior messages
 *  do not carry their own attachments — only the edited message's attachments
 *  travel (via the re-send). This mirrors today's Branch button exactly, so it
 *  is no regression. */
export function useEditAndBranch() {
  const qc = useQueryClient();
  const send = useSendMessage();
  return useMutation({
    mutationFn: async (args: EditBranchArgs): Promise<string> => {
      const newChatId = await copyPriorMessages(args.sourceChatId, args.editingMessageId);
      await copyEditAttachmentsToChat(
        args.sourceChatId,
        args.editingMessageId,
        args.stagedRemovals,
        newChatId,
      );
      await getClientDataDb().chats.update(args.sourceChatId, { editingMessageId: null });
      await send.mutateAsync({
        chatId: newChatId,
        personaId: args.personaId,
        text: args.text,
        reasoning: args.reasoning,
      });
      return newChatId;
    },
    // onSettled (not onSuccess): the local DB writes (copy + attachment carry-over
    // + clearing editingMessageId) commit before send.mutateAsync runs, so caches
    // must be invalidated even if the re-send throws. The broad ['chats'] key is
    // used (rather than ['chats', newChatId]) because `data` is undefined on error.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['chats'] });
      void qc.invalidateQueries({ queryKey: ['attachments', 'pending'] });
    },
  });
}
