// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { loadEnv } from '../env.js';
import * as schema from './schema.js';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface DbHandle {
  db: Db;
  sql: ReturnType<typeof postgres>;
}

let cached: DbHandle | null = null;

/** Opens (and caches) the sync-service Postgres connection from the env. */
export function createDb(url?: string): DbHandle {
  if (cached) return cached;
  const connectionString = url ?? loadEnv().DATABASE_URL;
  const client = postgres(connectionString, { max: 10 });
  const db = drizzle(client, { schema });
  cached = { db, sql: client };
  return cached;
}

export async function closeDb(): Promise<void> {
  if (cached) {
    await cached.sql.end();
    cached = null;
  }
}

/** Reads the single `sync_meta` row's `instance_epoch` (spec §4). */
export async function getInstanceEpoch(db: Db): Promise<string> {
  const rows = await db.execute<{ instance_epoch: string }>(sql`SELECT instance_epoch FROM sync_meta LIMIT 1`);
  const first = rows[0];
  if (!first) throw new Error('sync_meta is empty — migrations did not seed the instance epoch');
  return first.instance_epoch;
}
