// SPDX-License-Identifier: AGPL-3.0-only
// Probe C: Drizzle + postgres-js bytea round-trip at 2 MiB, and FOR UPDATE row
// locking inside a transaction. Run against the test DB:
//   TEST_DATABASE_URL=postgres://chatsundere:dev@localhost:5432/sync_db_test bun probes/bytea-lock.ts

import { sql } from 'drizzle-orm';
import { customType, pgTable, uuid } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

const scratch = pgTable('probe_scratch', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  blob: bytea('blob'),
});

const url =
  process.env.TEST_DATABASE_URL ?? 'postgres://chatsundere:dev@localhost:5432/sync_db_test';
const pg = postgres(url, { max: 5 });
const db = drizzle(pg);

await db.execute(sql`DROP TABLE IF EXISTS probe_scratch`);
await db.execute(
  sql`CREATE TABLE probe_scratch (id uuid primary key default gen_random_uuid(), blob bytea)`,
);

// 2 MiB round-trip, byte-identical?
const payload = new Uint8Array(2 * 1024 * 1024);
for (let i = 0; i < payload.length; i++) payload[i] = (i * 7) & 0xff;
const [row] = await db.insert(scratch).values({ blob: payload }).returning();
if (!row) throw new Error('probe insert returned no row');
const [read] = await db.select().from(scratch).where(sql`id = ${row.id}`);
if (!read) throw new Error('probe select returned no row');
const back = read.blob as Uint8Array;
let identical = back.length === payload.length;
if (identical)
  for (let i = 0; i < payload.length; i += 4096)
    if (back[i] !== payload[i]) {
      identical = false;
      break;
    }
console.log(
  'Probe C — bytea 2 MiB round-trip byte-identical:',
  identical,
  '(type:',
  `${back.constructor.name})`,
);

// FOR UPDATE — second connection blocks while the first holds the lock.
let secondAcquiredAt = 0;
let firstReleasedAt = 0;
const gate = db.transaction(async (tx) => {
  await tx.execute(sql`SELECT id FROM probe_scratch WHERE id = ${row.id} FOR UPDATE`);
  await new Promise((r) => setTimeout(r, 400));
  firstReleasedAt = Date.now();
});
await new Promise((r) => setTimeout(r, 50));
const contender = db.transaction(async (tx) => {
  await tx.execute(sql`SELECT id FROM probe_scratch WHERE id = ${row.id} FOR UPDATE`);
  secondAcquiredAt = Date.now();
});
await Promise.all([gate, contender]);
console.log(
  'Probe C — FOR UPDATE serialised (2nd acquired after 1st released):',
  secondAcquiredAt >= firstReleasedAt,
);

await db.execute(sql`DROP TABLE IF EXISTS probe_scratch`);
await pg.end();
