// SPDX-License-Identifier: AGPL-3.0-only

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../../src/db/schema.js';

export interface TestDb {
  db: ReturnType<typeof drizzle<typeof schema>>;
  sql: ReturnType<typeof postgres>;
  /** Truncates the record tables between tests, keeping the migrated schema + epoch. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Opens an isolated, freshly-migrated test database. Refuses to run unless
 * `TEST_DATABASE_URL` is set and names a test database — the auth-service
 * isolation discipline, so a stray run can never touch a real store. Drops and
 * re-migrates on every call, so each call also mints a fresh `instance_epoch`.
 */
export async function withTestDb(): Promise<TestDb> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is required to run sync-service integration tests');
  if (!/test/i.test(url)) throw new Error('refusing to run tests against a non-test database');

  const client = postgres(url, { max: 8, onnotice: () => {} });
  // Drop both the app schema and drizzle's migration bookkeeping so migrate()
  // truly re-runs (and re-seeds a new epoch) on every setup.
  await client.unsafe('DROP SCHEMA IF EXISTS public CASCADE');
  await client.unsafe('DROP SCHEMA IF EXISTS drizzle CASCADE');
  await client.unsafe('CREATE SCHEMA public');
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: './migrations' });

  return {
    db,
    sql: client,
    reset: async () => {
      await client.unsafe('TRUNCATE sync_records, sync_blobs, sync_accounts');
    },
    close: async () => {
      await client.end();
    },
  };
}
