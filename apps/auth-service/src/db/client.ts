// SPDX-License-Identifier: AGPL-3.0-only

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

export function createDb(): DbHandle {
  if (cached) return cached;
  const env = loadEnv();
  const sql = postgres(env.DATABASE_URL, { max: 10 });
  const db = drizzle(sql, { schema });
  cached = { db, sql };
  return cached;
}

export async function closeDb(): Promise<void> {
  if (cached) {
    await cached.sql.end();
    cached = null;
  }
}
