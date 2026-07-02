// SPDX-License-Identifier: AGPL-3.0-only

// Operator command: mint a fresh instance_epoch after restoring a Postgres
// backup (blob spec §16/§17.7). This INVALIDATES every client's sync watermark,
// forcing a clean re-sync — necessary because the epoch lives inside the backup,
// so a plain restore silently reinstates the old epoch (the exact divergence the
// epoch exists to prevent). Run: DATABASE_URL=... bun tools/re-epoch.ts --yes

import { createDb } from '../src/db/client.js';
import { reEpoch } from '../src/db/epoch.js';

async function main(): Promise<void> {
  if (!process.argv.includes('--yes')) {
    // eslint-disable-next-line no-console
    console.error(
      're-epoch mints a NEW instance_epoch and invalidates every client watermark,\n' +
        'forcing a full re-sync on every device. Re-run with --yes to confirm.',
    );
    process.exit(1);
  }
  const { db, sql } = createDb();
  const { old, next } = await reEpoch(db);
  await sql.end();
  // eslint-disable-next-line no-console
  console.log(`instance_epoch: ${old ?? '(none)'} → ${next}`);
}

if (import.meta.main) await main();
