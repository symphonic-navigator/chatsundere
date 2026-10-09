// SPDX-License-Identifier: AGPL-3.0-only
import Dexie, { type Transaction } from 'dexie';
import type { ProjectRevisionRow } from '../boot/client-data-db.js';

/** Superseded versions kept per file; older ones are dropped on capture. */
export const REVISION_CAP = 20;

/**
 * Stores the content a file had at `version` and trims the file's revisions to
 * the newest {@link REVISION_CAP}. Must run inside the caller's `rw` transaction
 * that includes `projectRevisions`.
 */
export async function recordRevision(
  tx: Transaction,
  fileId: string,
  version: string,
  text: string,
  size: number,
  now: number,
): Promise<void> {
  const table = tx.table<ProjectRevisionRow, [string, string]>('projectRevisions');
  await table.put({ fileId, version, text, size, createdAt: now });
  const count = await table.where('fileId').equals(fileId).count();
  if (count <= REVISION_CAP) return;
  // Equal createdAt values fall back to primary-key order; uuidv7 versions are
  // time-ordered, so ties still drop the oldest first.
  const oldest = await table
    .where('[fileId+createdAt]')
    .between([fileId, Dexie.minKey], [fileId, Dexie.maxKey])
    .limit(count - REVISION_CAP)
    .primaryKeys();
  await table.bulkDelete(oldest);
}
