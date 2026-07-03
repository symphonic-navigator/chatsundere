// SPDX-License-Identifier: AGPL-3.0-only

import type { BlobRef } from '@chatsundere/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type AvatarCrop, type PersonaAvatarRow, getClientDataDb } from '../boot/client-data-db.js';
import { mintBlobRefFor } from '../sync/blob-transform.js';
import {
  enqueueBlobDelete,
  enqueueBlobPut,
  isLinkedForSync,
  mutateSynced,
} from '../sync/enqueue.js';
import { QK } from './queryKeys.js';

/** Read a persona's avatar row, or null when none is set. */
export function usePersonaAvatar(personaId: string | null) {
  return useQuery({
    queryKey: personaId ? QK.personaAvatar(personaId) : ['persona-avatar', '__none'],
    enabled: personaId !== null,
    queryFn: async () => {
      if (!personaId) return null;
      return (await getClientDataDb().personaAvatars.get(personaId)) ?? null;
    },
  });
}

export interface SetAvatarArgs {
  personaId: string;
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  crop: AvatarCrop;
}

/**
 * Create, replace, or re-crop a persona's avatar (WS-D §5, Class-2). Linked: mint
 * a fresh `blobRef` for the new bytes, set it on the row, and enqueue a
 * `blob-put` (new id) + the record upsert atomically; when an earlier avatar
 * existed, its old id is enqueued as a `blob-delete` the drain defers until the
 * record's `ok` ack (Larissa M-2 — never delete under a possibly-losing ref).
 * Local-only: a plain `put` of the bytes with no ref and no outbox row.
 */
export async function setPersonaAvatar(args: SetAvatarArgs): Promise<void> {
  const db = getClientDataDb();
  const linked = isLinkedForSync();
  const previous = linked ? await db.personaAvatars.get(args.personaId) : undefined;
  const oldBlobId = previous?.blobRef?.blobId ?? null;
  const newRef: BlobRef | null = linked ? mintBlobRefFor(args.blob) : null;
  const row: PersonaAvatarRow = {
    ...args,
    updatedAt: Date.now(),
    ...(newRef ? { blobRef: newRef } : {}),
  };
  await mutateSynced({
    collection: 'personaAvatars',
    key: args.personaId,
    tables: ['personaAvatars'],
    write: async (tx) => {
      await tx.table('personaAvatars').put(row);
    },
    blobOps: (tx) => {
      if (newRef) enqueueBlobPut(tx, 'personaAvatars', args.personaId, newRef.blobId);
      if (oldBlobId) enqueueBlobDelete(tx, 'personaAvatars', args.personaId, oldBlobId);
    },
  });
}

/**
 * Remove a persona's avatar (back to the monogram). Terminality trap (WS-D
 * §4/§5.1): `personaAvatars` is keyed by the STABLE `personaId`, so removal is a
 * Class-2 record UPDATE to `blobRef: null` — NEVER a tombstone (a tombstone would
 * brick avatar sync for this persona forever). The row survives with its bytes
 * cleared (the monogram fallback keys on the absent `blob`), and the old blob's
 * id is enqueued as a deferred `blob-delete`. Local-only: the same bytes-clearing
 * update with no outbox row.
 */
export async function removePersonaAvatar(personaId: string): Promise<void> {
  const db = getClientDataDb();
  const existing = await db.personaAvatars.get(personaId);
  if (!existing) return; // nothing to remove
  const oldBlobId = existing.blobRef?.blobId ?? null;
  const removed: PersonaAvatarRow = {
    personaId,
    mime: existing.mime,
    width: existing.width,
    height: existing.height,
    crop: existing.crop,
    updatedAt: Date.now(),
    blobRef: null,
  };
  await mutateSynced({
    collection: 'personaAvatars',
    key: personaId,
    // An UPSERT of the bytes-cleared row — deliberately NOT `op: 'delete'`.
    write: async (tx) => {
      await tx.table('personaAvatars').put(removed);
    },
    tables: ['personaAvatars'],
    blobOps: (tx) => {
      if (oldBlobId) enqueueBlobDelete(tx, 'personaAvatars', personaId, oldBlobId);
    },
  });
}

/** Create or replace a persona's avatar (React-Query hook wrapping {@link setPersonaAvatar}). */
export function useSetPersonaAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: setPersonaAvatar,
    onSuccess: (_v, args) => qc.invalidateQueries({ queryKey: QK.personaAvatar(args.personaId) }),
  });
}

/** Remove a persona's avatar (React-Query hook wrapping {@link removePersonaAvatar}). */
export function useRemovePersonaAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: removePersonaAvatar,
    onSuccess: (_v, personaId) => qc.invalidateQueries({ queryKey: QK.personaAvatar(personaId) }),
  });
}
