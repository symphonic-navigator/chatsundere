// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import {
  type AttachmentKind,
  type AttachmentRow,
  getClientDataDb,
} from '../boot/client-data-db.js';
import { QK } from './queryKeys.js';

export interface AddAttachmentInput {
  chatId: string;
  kind: AttachmentKind;
  fileName: string;
  mime: string;
  blob?: Blob;
  text?: string;
  width?: number;
  height?: number;
}

/** Lowest-level ops (no React) — used by hooks and by the send path. */
export async function addAttachment(input: AddAttachmentInput): Promise<string> {
  const db = getClientDataDb();
  const id = uuidv7();
  return db.transaction('rw', db.attachments, async () => {
    // null is not a valid IndexedDB key — scope by chatId, filter pending in JS (counts are tiny).
    const order = await db.attachments
      .where('chatId')
      .equals(input.chatId)
      .filter((a) => a.messageId === null)
      .count();
    const row: AttachmentRow = {
      id,
      chatId: input.chatId,
      messageId: null,
      origin: 'upload',
      kind: input.kind,
      fileName: input.fileName,
      mime: input.mime,
      order,
      state: 'active',
      createdAt: Date.now(),
      blob: input.blob,
      text: input.text,
      width: input.width,
      height: input.height,
      visionDescription: null,
    };
    await db.attachments.add(row);
    return id;
  });
}

/** Permanently delete an attachment record from the local database by its ID. */
export async function removeAttachment(id: string): Promise<void> {
  await getClientDataDb().attachments.delete(id);
}

/** Update the file name of an existing attachment without altering any other field. */
export async function renameAttachment(id: string, fileName: string): Promise<void> {
  await getClientDataDb().attachments.update(id, { fileName });
}

/** Replace the extracted-text content of an attachment (e.g. after OCR or paste). */
export async function updateAttachmentText(id: string, text: string): Promise<void> {
  await getClientDataDb().attachments.update(id, { text });
}

/** Return all unsent (pending) attachments for a chat, sorted by insertion order. */
export async function listPendingAttachments(chatId: string): Promise<AttachmentRow[]> {
  // null is not a valid IndexedDB key — never query the [chatId+messageId] compound index
  // with a null component; always filter in JS.
  const rows = await getClientDataDb()
    .attachments.where('chatId')
    .equals(chatId)
    .filter((a) => a.messageId === null)
    .toArray();
  return rows.sort((a, b) => a.order - b.order);
}

/** Return all attachments that have been committed to a specific message, sorted by insertion order. */
export async function listMessageAttachments(messageId: string): Promise<AttachmentRow[]> {
  const rows = await getClientDataDb().attachments.where('messageId').equals(messageId).toArray();
  return rows.sort((a, b) => a.order - b.order);
}

/** Bind all pending attachments for a chat to a sent message, clearing their pending state. */
export async function attachPendingToMessage(chatId: string, messageId: string): Promise<void> {
  const db = getClientDataDb();
  await db.transaction('rw', db.attachments, async () => {
    const pending = await db.attachments
      .where('chatId')
      .equals(chatId)
      .filter((a) => a.messageId === null)
      .toArray();
    await Promise.all(pending.map((a) => db.attachments.update(a.id, { messageId })));
  });
}

// ---- React hooks ----

/** Query hook that reactively lists all unsent attachments for the given chat. */
export function usePendingAttachments(chatId: string) {
  return useQuery({
    queryKey: QK.attachmentsPending(chatId),
    queryFn: () => listPendingAttachments(chatId),
  });
}

/** Query hook that reactively lists all attachments committed to the given message. */
export function useMessageAttachments(messageId: string) {
  return useQuery({
    queryKey: QK.attachmentsForMessage(messageId),
    queryFn: () => listMessageAttachments(messageId),
    // Skip the Dexie round-trip for messages with no id (e.g. non-user messages pass '').
    enabled: messageId !== '',
  });
}

/** Mutation hook that adds a new pending attachment and invalidates the pending-attachments query. */
export function useAddAttachment(chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddAttachmentInput) => addAttachment(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.attachmentsPending(chatId) }),
  });
}

/** Mutation hook that deletes an attachment by ID and invalidates the pending-attachments query. */
export function useRemoveAttachment(chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => removeAttachment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.attachmentsPending(chatId) }),
  });
}

/** Mutation hook that renames a pending attachment and invalidates the pending-attachments query. */
export function useRenameAttachment(chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, fileName }: { id: string; fileName: string }) =>
      renameAttachment(id, fileName),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.attachmentsPending(chatId) }),
  });
}

/** Mutation hook that updates the extracted text of a pending attachment and invalidates the pending-attachments query. */
export function useUpdateAttachmentText(chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => updateAttachmentText(id, text),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.attachmentsPending(chatId) }),
  });
}
