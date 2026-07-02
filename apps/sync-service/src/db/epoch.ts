// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import type { Db } from './client.js';

/**
 * Mints a fresh `instance_epoch` (blob spec §17.7 / sync spec §12.2). The epoch
 * lives inside `sync_meta`, so it travels inside every Postgres backup — a plain
 * `pg_restore` restores the OLD epoch and no client recovery fires. After
 * restoring a backup an operator must run this so every client's watermark is
 * invalidated and a clean re-sync happens. Returns the old and new values.
 */
export async function reEpoch(db: Db): Promise<{ old: string | null; next: string }> {
  return db.transaction(async (tx) => {
    const before = await tx.execute<{ instance_epoch: string }>(
      sql`SELECT instance_epoch FROM sync_meta LIMIT 1`,
    );
    await tx.execute(sql`DELETE FROM sync_meta`);
    const after = await tx.execute<{ instance_epoch: string }>(
      sql`INSERT INTO sync_meta DEFAULT VALUES RETURNING instance_epoch`,
    );
    const next = after[0]?.instance_epoch;
    if (!next) throw new Error('re-epoch failed to mint a new instance_epoch');
    return { old: before[0]?.instance_epoch ?? null, next };
  });
}
