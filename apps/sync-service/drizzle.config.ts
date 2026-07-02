// SPDX-License-Identifier: AGPL-3.0-only
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://chatsundere:dev@localhost:5432/sync_db',
  },
  strict: true,
  verbose: true,
} satisfies Config;
