// SPDX-License-Identifier: AGPL-3.0-only
import { getClientDataDb } from '../boot/client-data-db.js';
import { sweepOrphanRevisions } from '../projects/revisions.js';

/**
 * Delete every trash row past its 30-day grace (`purgeAt <= now`), then the
 * project revisions those deletes orphaned. Runs at the start of each sync
 * cycle and on every unlock, so local-only accounts purge too. A failed sweep
 * only warns (the next purge retries it); a failed delete rejects, and an
 * unlock caller must not await or rethrow it.
 */
export async function purgeExpiredTrash(): Promise<void> {
  const db = getClientDataDb();
  await db.trash.where('purgeAt').belowOrEqual(Date.now()).delete();
  await sweepOrphanRevisions().catch((e: unknown) => {
    console.warn('Could not sweep orphaned project revisions after the trash purge', e);
  });
}
