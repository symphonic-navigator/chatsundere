// SPDX-License-Identifier: AGPL-3.0-only
import type { SyncCollection } from '@chatsundere/shared-types';
import { type TrashRow, getClientDataDb } from '../boot/client-data-db.js';
import { deleteChatCascade } from '../data/chats.js';
import { deleteDocumentCascade, deleteLibraryCascade } from '../data/knowledge.js';
import { deletePersonaCascade } from '../data/personas.js';
import { rejectEntry } from '../memory/repo.js';
import { isDeadKey } from '../sync/dead-keys.js';
import { scheduleClass1Sync } from '../sync/triggers.js';
import { rewindWatermark, takeSuppressedRevs } from '../sync/watermark.js';

/** Thrown when a fast in-place Undo is attempted after the delete has already drained
 *  (a dead-key marker exists). The caller must fall back to the new-identity restore. */
export class UndoDrainedError extends Error {
  constructor() {
    super('Fast Undo unavailable: the delete has already drained; use the new-identity restore.');
    this.name = 'UndoDrainedError';
  }
}

/** A handle the caller can use to reverse a soft-delete before it drains (Task 8 hardens restore). */
export interface TrashUndoHandle {
  kind: 'in-place';
  restore(): Promise<void>;
}

/**
 * Route a delete to the matching family cascade collector (§3.4). Only the five
 * user-deletable families reach here; any other collection throws. `intoTrash`
 * toggles the trash snapshot on the collector (default off → hard delete).
 */
async function dispatchDelete(
  collection: SyncCollection,
  key: string,
  intoTrash: boolean,
): Promise<void> {
  const opts = { intoTrash };
  switch (collection) {
    case 'chats':
      return deleteChatCascade(key, opts);
    case 'personas':
      return deletePersonaCascade(key, opts);
    case 'libraries':
      return deleteLibraryCascade(key, undefined, opts);
    case 'documents':
      return deleteDocumentCascade(key, undefined, opts);
    case 'memoryJournal':
      return rejectEntry(key, opts);
    default:
      throw new Error(`delete-flow: ${collection} is not a user-deletable family`);
  }
}

/**
 * Soft-delete: snapshot the exact cascade set into the trashcan, then run the
 * normal synced delete (the deletion still propagates; peers route the tombstones
 * into their own trash). Dead-keys are written at ack, not here (§3.9), so a fast
 * Undo before the drain stays identity-preserving. Returns a handle whose
 * `restore()` reverses the delete in place while it is still queued.
 */
export async function softDelete(
  collection: SyncCollection,
  key: string,
): Promise<TrashUndoHandle> {
  const db = getClientDataDb();
  // Diff the trash keyset around the delete to learn the EXACT set snapshotted —
  // the same set the collector cascade-tombstoned (I-2), sourced from the collector.
  const before = new Set((await db.trash.toCollection().primaryKeys()) as string[]);
  await dispatchDelete(collection, key, true);
  const addedIds = ((await db.trash.toCollection().primaryKeys()) as string[]).filter(
    (id) => !before.has(id),
  );
  const snapshots = (await db.trash.bulkGet(addedIds)).filter(
    (r): r is TrashRow => r !== undefined,
  );

  // Capture the covered outbox `delete` seqs for the root + cascade keys so a fast
  // Undo can cancel the not-yet-drained sync delete. Empty for a local-only user.
  const coveredSeqs: number[] = [];
  for (const snap of snapshots) {
    const seqs = (await db.syncOutbox
      .where('[collection+key]')
      .equals([snap.collection, snap.key])
      .primaryKeys()) as number[];
    coveredSeqs.push(...seqs);
  }
  const liveTables = [...new Set(snapshots.map((s) => s.collection as string))];

  return {
    kind: 'in-place',
    /**
     * Happy-path in-place restore (Task 8 adds the drain-safety guard): cancel the
     * still-queued delete (+cascade), re-materialise each snapshot at its ORIGINAL
     * id, and retire the trash entries — one transaction. No dead-key was written,
     * so the identity is preserved and live back-references stay valid.
     */
    async restore(): Promise<void> {
      // Drain-safety guard (§3.4): the dead-key marker — not raw seq-presence — is the
      // authoritative "this delete has drained" signal (the drain can complete inside
      // `mutateSynced` before `softDelete` returns). If ANY snapshot in the set is dead,
      // the in-place restore would resurrect a tombstoned identity, so refuse and let the
      // caller fall back to the new-identity restore (§3.5). Checked BEFORE any mutation.
      for (const snap of snapshots) {
        if (await isDeadKey(snap.collection, snap.key)) throw new UndoDrainedError();
      }
      await db.transaction('rw', [...liveTables, 'syncOutbox', 'trash'], async (tx) => {
        // `bulkDelete` ignores any seq already drained — only the still-queued ones go.
        if (coveredSeqs.length > 0) await tx.table('syncOutbox').bulkDelete(coveredSeqs);
        for (const snap of snapshots) await tx.table(snap.collection).put(snap.row);
        await tx.table('trash').bulkDelete(addedIds);
      });

      // Audit #5: a foreign edit pulled while our delete was pending was suppressed
      // and its rev skipped. Now that the delete is undone, rewind the watermark
      // below the lowest suppressed rev so the next pull re-delivers it and normal
      // LWW resolution runs against the restored row.
      const minSuppressed = await takeSuppressedRevs(
        snapshots.map((s) => ({ collection: s.collection, key: s.key })),
      );
      if (minSuppressed !== null) {
        await rewindWatermark(minSuppressed - 1);
        scheduleClass1Sync(); // kick a pull promptly rather than waiting for the timer
      }
    },
  };
}

/**
 * Permanent delete: the normal synced delete with NO trash snapshot. No local
 * plaintext retention; dead-keys are still written at ack (§3.9), never here.
 */
export async function permanentDelete(collection: SyncCollection, key: string): Promise<void> {
  await dispatchDelete(collection, key, false);
}
