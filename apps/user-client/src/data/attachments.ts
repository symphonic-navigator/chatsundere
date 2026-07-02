// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import {
  type ArtefactRow,
  type AttachmentKind,
  type AttachmentOrigin,
  type AttachmentRow,
  type DocumentRow,
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
  origin?: AttachmentOrigin;
  kbRef?: { libraryId: string; documentId: string } | null;
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
      origin: input.origin ?? 'upload',
      kbRef: input.kbRef ?? null,
      kind: input.kind,
      fileName: input.fileName,
      mime: input.mime,
      order,
      state: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
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

/**
 * Copy an artefact's current content into the chat as a pending attachment — a
 * snapshot. Lifecycle is decoupled from the artefact: deleting the artefact
 * later never touches the message. Text artefacts only; an image artefact (TTI,
 * future) would need a blob branch and is out of scope.
 */
export async function addArtefactSnapshot(chatId: string, artefact: ArtefactRow): Promise<string> {
  return addAttachment({
    chatId,
    kind: 'text',
    fileName: artefact.fileName,
    mime: artefact.mime,
    text: artefact.content,
  });
}

/**
 * Attach a knowledge-library document to the chat as a *copy-on-write* pending
 * reference: no content is copied — `kbRef` points at the live document and the
 * content is resolved live until the user edits it or the message is sent. Mirrors
 * `addArtefactSnapshot` in shape, but references instead of snapshotting.
 */
export async function addDocumentReference(chatId: string, doc: DocumentRow): Promise<string> {
  return addAttachment({
    chatId,
    kind: 'text',
    fileName: `${doc.title}.md`,
    mime: 'text/markdown',
    origin: 'library',
    kbRef: { libraryId: doc.libraryId, documentId: doc.id },
    // text intentionally omitted — copy-on-write (see snapshotPendingDocumentReferences).
  });
}

/**
 * Freeze a document's content into any *pending* attachment that still references it
 * as a live copy-on-write reference (`text` unset). Called when the source document is
 * about to be deleted, so an in-progress attachment does not break. Reads the
 * attachments table directly (no knowledge.ts import) to avoid an import cycle.
 */
export async function materialiseReferencesForDocument(
  documentId: string,
  content: string,
): Promise<void> {
  const db = getClientDataDb();
  await db.transaction('rw', db.attachments, async () => {
    const refs = await db.attachments
      .filter(
        (a) => a.messageId === null && a.kbRef?.documentId === documentId && a.text === undefined,
      )
      .toArray();
    await Promise.all(refs.map((a) => db.attachments.update(a.id, { text: content })));
  });
}

/**
 * Snapshot-on-send: freeze the current live content of every still-referenced pending
 * document attachment into its row, decoupling the sent message from the knowledgebase
 * (WYSIWYG). A vanished document degrades to empty content rather than throwing. Safe to
 * call inside an existing rw transaction that scopes `attachments` + `documents` (it does
 * not open its own transaction, so it can join the send transaction).
 */
export async function snapshotPendingDocumentReferences(chatId: string): Promise<void> {
  const db = getClientDataDb();
  const refs = await db.attachments
    .where('chatId')
    .equals(chatId)
    .filter((a) => a.messageId === null && a.kbRef != null && a.text === undefined)
    .toArray();
  for (const a of refs) {
    const doc = a.kbRef ? await db.documents.get(a.kbRef.documentId) : undefined;
    await db.attachments.update(a.id, { text: doc?.content ?? '' });
  }
}

/**
 * Resolve the live content of every still-referenced pending document attachment,
 * keyed by attachment id, so the lightbox can preview a copy-on-write document before
 * it is materialised or sent. Materialised rows (text already set) are omitted.
 */
export async function loadPendingDocumentContents(
  rows: AttachmentRow[],
): Promise<Map<string, string>> {
  const db = getClientDataDb();
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.kbRef != null && r.text === undefined) {
      const doc = await db.documents.get(r.kbRef.documentId);
      if (doc) map.set(r.id, doc.content);
    }
  }
  return map;
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

/**
 * Query hook wrapping `loadPendingDocumentContents`; re-runs only when the set of
 * unmaterialised references changes (keyed by attachment+document id signature).
 */
export function usePendingDocumentContents(rows: AttachmentRow[]) {
  const sig = rows
    .filter((r) => r.kbRef != null && r.text === undefined)
    .map((r) => `${r.id}:${(r.kbRef as { documentId: string }).documentId}`)
    .join(',');
  return useQuery({
    queryKey: ['attachments', 'ref-contents', sig],
    queryFn: () => loadPendingDocumentContents(rows),
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

/**
 * Mutation hook: snapshot a batch of artefacts into the chat's pending set, then
 * invalidate the pending query once (mirrors `Cockpit.ingest`).
 */
export function useAddArtefactSnapshots(chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (artefacts: ArtefactRow[]) => {
      for (const a of artefacts) await addArtefactSnapshot(chatId, a);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.attachmentsPending(chatId) }),
  });
}

/**
 * Mutation hook: add a batch of documents as copy-on-write references to the chat's
 * pending set, then invalidate the pending query once.
 */
export function useAddDocumentReferences(chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (docs: DocumentRow[]) => {
      for (const d of docs) await addDocumentReference(chatId, d);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.attachmentsPending(chatId) }),
  });
}
