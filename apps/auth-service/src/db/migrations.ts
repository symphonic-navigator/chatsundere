// SPDX-License-Identifier: AGPL-3.0-only

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

async function main(): Promise<void> {
  const sql = postgres(
    process.env.DATABASE_URL ?? 'postgres://chatsundere:dev@localhost:5432/auth_db',
    { max: 1 },
  );
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: './migrations' });
  await sql.end();
  // eslint-disable-next-line no-console
  console.log('migrations applied');
}

if (import.meta.main) await main();
