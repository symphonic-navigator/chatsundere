// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import { bigint, boolean, customType, index, pgTable, primaryKey, smallint, text, uuid } from 'drizzle-orm/pg-core';

// bytea for fixed-shape binary fields (blind ids, nonces, ciphertext, hashes).
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

// Deliberately no timestamp columns anywhere (spec §4): receipt times are
// metadata the store simply does not have at rest.
export const syncRecords = pgTable(
  'sync_records',
  {
    accountId: uuid('account_id').notNull(),
    blindId: bytea('blind_id').notNull(),
    collection: text('collection').notNull(),
    envelopeVersion: smallint('envelope_version').notNull().default(1),
    rev: bigint('rev', { mode: 'number' }).notNull(),
    deleted: boolean('deleted').notNull().default(false),
    nonce: bytea('nonce'),
    ciphertext: bytea('ciphertext'),
    ciphertextHash: bytea('ciphertext_hash'),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.blindId] }),
    index('sync_records_account_rev_idx').on(t.accountId, t.rev),
  ],
);

export const syncAccounts = pgTable('sync_accounts', {
  accountId: uuid('account_id').primaryKey(),
  headRev: bigint('head_rev', { mode: 'number' }).notNull().default(0),
  totalBytes: bigint('total_bytes', { mode: 'number' }).notNull().default(0),
});

export const syncMeta = pgTable('sync_meta', {
  instanceEpoch: uuid('instance_epoch').primaryKey().default(sql`gen_random_uuid()`),
});
