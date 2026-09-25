// SPDX-License-Identifier: AGPL-3.0-only

import postgres from 'postgres';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://chatsundere:dev@localhost:5432/auth_test_db';
const databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');

if (!databaseName.toLowerCase().includes('test')) {
  throw new Error(
    `Refusing to reset non-test database "${databaseName}". Set DATABASE_URL to a dedicated test database.`,
  );
}

const sql = postgres(databaseUrl, { max: 1 });

try {
  await sql.unsafe(
    'TRUNCATE audit_log, refresh_tokens, auth_methods, pending_codes, users RESTART IDENTITY CASCADE',
  );
} finally {
  await sql.end();
}
