// SPDX-License-Identifier: AGPL-3.0-only

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import { type PersonaRow, getClientDataDb } from '../boot/client-data-db.js';
import { enqueueBlobDelete, enqueueSync, isLinkedForSync, mutateSynced } from '../sync/enqueue.js';
import { scheduleClass1Sync } from '../sync/triggers.js';
import { type TrashUndoHandle, softDelete } from '../trash/delete-flow.js';
import { showDeleteToast } from '../trash/delete-toast.js';
import { snapshotRowIntoTrash } from '../trash/snapshot.js';
import { QK } from './queryKeys.js';
import { useAdultMode } from './settings.js';

/**
 * List all personas ordered by creation date (oldest first).
 * Sorted in memory because `createdAt` is not a Dexie index on the
 * personas store (only `id` and `providerId` are indexed per the schema).
 */
export function usePersonas() {
  return useQuery({
    queryKey: QK.personas,
    queryFn: async () => {
      const db = getClientDataDb();
      const rows = await db.personas.toArray();
      return rows.sort((a, b) => a.createdAt - b.createdAt);
    },
  });
}

/**
 * Fetch a single persona by id. Returns `null` when the id is not in the
 * DB. Disabled (no fetch) when `id` is `null`.
 */
export function usePersona(id: string | null) {
  return useQuery({
    queryKey: id ? QK.persona(id) : ['personas', '__none'],
    queryFn: async () => {
      if (!id) return null;
      const db = getClientDataDb();
      return (await db.personas.get(id)) ?? null;
    },
    enabled: id !== null,
  });
}

type CreatePersonaArgs = Omit<PersonaRow, 'id' | 'createdAt' | 'updatedAt'>;

/** Create a new persona row and invalidate the list query on success. */
export function useCreatePersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: CreatePersonaArgs): Promise<PersonaRow> => {
      const db = getClientDataDb();
      const now = Date.now();
      const row: PersonaRow = { id: uuidv7(), createdAt: now, updatedAt: now, ...args };
      const linked = isLinkedForSync();
      // Class-1 creation-insert: the persona and its outbox row commit atomically.
      await db.transaction('rw', [db.personas, db.syncOutbox], async (tx) => {
        await db.personas.add(row);
        if (linked) enqueueSync(tx, 'personas', row.id, 'upsert');
      });
      if (linked) scheduleClass1Sync();
      return row;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.personas }),
  });
}

/** Partially update a persona and invalidate both the list and single-row caches. */
export function useUpdatePersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      patch: Partial<Omit<PersonaRow, 'id' | 'createdAt'>>;
    }) => {
      // Class-2 edit (spec §5): gate → local write + outbox enqueue → awaited drain.
      await mutateSynced({
        collection: 'personas',
        key: args.id,
        tables: ['personas'],
        write: async (tx) => {
          await tx.table('personas').update(args.id, { ...args.patch, updatedAt: Date.now() });
        },
      });
    },
    onSuccess: (_v, args) => {
      qc.invalidateQueries({ queryKey: QK.personas });
      qc.invalidateQueries({ queryKey: QK.persona(args.id) });
    },
  });
}

/**
 * Delete a persona and cascade-delete all chats, messages, and pills that
 * belong to it, inside a single Dexie transaction.
 */
export function useDeletePersona() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: QK.personas });
    void qc.invalidateQueries({ queryKey: QK.chats });
    void qc.invalidateQueries({ queryKey: ['trash-cards'] });
  };
  return useMutation({
    mutationFn: (id: string): Promise<TrashUndoHandle> => softDelete('personas', id),
    onSuccess: (handle, id) => {
      invalidate();
      showDeleteToast('personas', id, handle, invalidate);
    },
  });
}

/**
 * Delete a persona and cascade-tombstone its chats, messages, pills,
 * attachments, artefacts, memories (`memoryJournal` + `memoryBody`), and —
 * the one case the avatar IS tombstoned (WS-D §5) — its `personaAvatars`
 * row, with a `blob-delete` for the avatar's bytes plus one per attachment
 * and artefact blob (attachments carry one; artefacts carry a full blob AND
 * a thumbnail). Plain function so the cascade is testable without React;
 * {@link useDeletePersona} wraps it.
 *
 * `opts.intoTrash` (default off → current behaviour byte-identical) additionally
 * snapshots the persona and its exact cascade descendant set (chats, messages,
 * pills, attachments, artefacts, avatar, memories) into `db.trash` inside the
 * same transaction, before the live rows go (build constraint I-2, §3.4).
 */
export async function deletePersonaCascade(
  id: string,
  opts?: { intoTrash?: boolean },
): Promise<void> {
  const db = getClientDataDb();
  const persona = await db.personas.get(id);
  // Enumerate the synced descendants BEFORE the mutation so their tombstones
  // ride the same transaction (spec §7.3a): the apply pipeline never cascades,
  // so a persona tombstone alone would orphan its chats/messages/pills on
  // other devices. Persona deletion is the ONE case where the avatar IS
  // tombstoned (WS-D §5 — the terminality trap does not apply, the persona is
  // gone), with a `blob-delete` for its stored bytes.
  const chats = await db.chats.where('personaId').equals(id).toArray();
  const chatIds = chats.map((c) => c.id);
  const messages =
    chatIds.length > 0 ? await db.messages.where('chatId').anyOf(chatIds).toArray() : [];
  const messageIds = messages.map((m) => m.id);
  const pills =
    messageIds.length > 0 ? await db.pills.where('messageId').anyOf(messageIds).toArray() : [];
  const pillIds = pills.map((p) => p.id);
  // A persona owns multiple chats, so this mirrors deleteChatCascade's
  // enumeration (chats.ts:224-234) but with `.anyOf(chatIds)` instead of
  // `.equals(chatId)`.
  const attachments =
    chatIds.length > 0 ? await db.attachments.where('chatId').anyOf(chatIds).toArray() : [];
  const artefacts =
    chatIds.length > 0 ? await db.artefacts.where('chatId').anyOf(chatIds).toArray() : [];
  const attachmentIds = attachments.map((a) => a.id);
  const artefactIds = artefacts.map((a) => a.id);
  // Blob ids: attachments carry one blobRef; artefacts carry blobRef AND thumbBlobRef.
  const attachmentBlobs = attachments
    .map((a) => ({ key: a.id, blobId: a.blobRef?.blobId ?? null }))
    .filter((b): b is { key: string; blobId: string } => b.blobId !== null);
  const artefactBlobs = artefacts.flatMap((a) => {
    const ids: { key: string; blobId: string }[] = [];
    if (a.blobRef) ids.push({ key: a.id, blobId: a.blobRef.blobId });
    if (a.thumbBlobRef) ids.push({ key: a.id, blobId: a.thumbBlobRef.blobId });
    return ids;
  });
  const avatar = await db.personaAvatars.get(id);
  const avatarBlobId = avatar?.blobRef?.blobId ?? null;

  // The persona's memories belong to its card (TRASH_HIERARCHY: memoryJournal +
  // memoryBody hang off the persona). Enumerated BEFORE the mutation so their
  // tombstones ride the same transaction: the apply pipeline never cascades, so
  // a persona tombstone alone would strand its memories against a now-dead
  // personaId — locally and on every peer.
  const memoryJournals = await db.memoryJournal.where('personaId').equals(id).toArray();
  const memoryBodies = await db.memoryBody.where('personaId').equals(id).toArray();
  const memoryJournalIds = memoryJournals.map((m) => m.id);
  const memoryBodyIds = memoryBodies.map((m) => m.id);

  // Every deleted chat belongs to this persona, so the whole subtree lifts to
  // this persona's card.
  const personaOfChat = new Map(chats.map((c) => [c.id, id]));
  const resolvePersona = (cid: string): string | null => personaOfChat.get(cid) ?? null;

  await mutateSynced({
    collection: 'personas',
    key: id,
    op: 'delete',
    tables: opts?.intoTrash
      ? [
          'personas',
          'chats',
          'messages',
          'pills',
          'attachments',
          'artefacts',
          'personaAvatars',
          'memoryJournal',
          'memoryBody',
          'trash',
        ]
      : [
          'personas',
          'chats',
          'messages',
          'pills',
          'attachments',
          'artefacts',
          'personaAvatars',
          'memoryJournal',
          'memoryBody',
        ],
    cascade: [
      ...chatIds.map((k) => ({ collection: 'chats' as const, key: k })),
      ...messageIds.map((k) => ({ collection: 'messages' as const, key: k })),
      ...pillIds.map((k) => ({ collection: 'pills' as const, key: k })),
      ...attachments.map((a) => ({ collection: 'attachments' as const, key: a.id })),
      ...artefacts.map((a) => ({ collection: 'artefacts' as const, key: a.id })),
      ...(avatar ? [{ collection: 'personaAvatars' as const, key: id }] : []),
      ...memoryJournalIds.map((k) => ({ collection: 'memoryJournal' as const, key: k })),
      ...memoryBodyIds.map((k) => ({ collection: 'memoryBody' as const, key: k })),
    ],
    write: async (tx) => {
      if (opts?.intoTrash) {
        // Snapshot the EXACT cascade set (I-2) before the live rows are removed.
        const now = Date.now();
        if (persona) await snapshotRowIntoTrash(tx, now, 'personas', id, persona, resolvePersona);
        for (const c of chats)
          await snapshotRowIntoTrash(tx, now, 'chats', c.id, c, resolvePersona);
        for (const m of messages)
          await snapshotRowIntoTrash(tx, now, 'messages', m.id, m, resolvePersona);
        for (const p of pills)
          await snapshotRowIntoTrash(tx, now, 'pills', p.id, p, resolvePersona);
        for (const a of attachments)
          await snapshotRowIntoTrash(tx, now, 'attachments', a.id, a, resolvePersona);
        for (const a of artefacts)
          await snapshotRowIntoTrash(tx, now, 'artefacts', a.id, a, resolvePersona);
        if (avatar)
          await snapshotRowIntoTrash(tx, now, 'personaAvatars', id, avatar, resolvePersona);
        for (const m of memoryJournals)
          await snapshotRowIntoTrash(tx, now, 'memoryJournal', m.id, m, resolvePersona);
        for (const m of memoryBodies)
          await snapshotRowIntoTrash(tx, now, 'memoryBody', m.id, m, resolvePersona);
      }
      if (pillIds.length > 0) await tx.table('pills').bulkDelete(pillIds);
      if (attachmentIds.length > 0) await tx.table('attachments').bulkDelete(attachmentIds);
      if (artefactIds.length > 0) await tx.table('artefacts').bulkDelete(artefactIds);
      if (messageIds.length > 0) await tx.table('messages').bulkDelete(messageIds);
      if (chatIds.length > 0) await tx.table('chats').bulkDelete(chatIds);
      if (memoryJournalIds.length > 0) await tx.table('memoryJournal').bulkDelete(memoryJournalIds);
      if (memoryBodyIds.length > 0) await tx.table('memoryBody').bulkDelete(memoryBodyIds);
      await tx.table('personaAvatars').delete(id);
      await tx.table('personas').delete(id);
    },
    blobOps: (tx) => {
      for (const b of attachmentBlobs) enqueueBlobDelete(tx, 'attachments', b.key, b.blobId);
      for (const b of artefactBlobs) enqueueBlobDelete(tx, 'artefacts', b.key, b.blobId);
      if (avatarBlobId) enqueueBlobDelete(tx, 'personaAvatars', id, avatarBlobId);
    },
  });
}

/** Descending order for the Circle: most-recently-interacted persona first.
 *  Falls back to createdAt for personas never messaged. */
export function compareByLastInteraction(a: PersonaRow, b: PersonaRow): number {
  return (b.lastInteractionAt ?? b.createdAt) - (a.lastInteractionAt ?? a.createdAt);
}

/**
 * Personas filtered by the current adult-mode setting. **All UI surfaces
 * that list personas, count personas, or look up a recent persona for
 * display must use this hook**, not the raw `usePersonas()`.
 * Raw `usePersonas()` is reserved for Editor-class persona-by-id lookups.
 *
 * Per spec §2 Decision 4 (no-leak): the empty-state for an all-NSFW list
 * in SFW mode is the responsibility of the consuming UI — it must render
 * identically to the empty-state for "no personas exist at all", with no
 * counter, no hint, no copy referencing hidden items.
 */
export function useFilteredPersonas() {
  const personas = usePersonas();
  const { mode } = useAdultMode();
  const data = personas.data?.filter((p) => mode === 'nsfw' || !p.adultPersona);
  return { ...personas, data } as typeof personas;
}
