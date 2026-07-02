// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

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

// Blob metadata (blob spec §4): quota ledger + existence check + listing backing
// + purge inventory. The object bytes live in S3 under key `<account_id>/<blob_id>`.
export const syncBlobs = pgTable(
  'sync_blobs',
  {
    accountId: uuid('account_id').notNull(),
    blobId: text('blob_id').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    ciphertextHash: bytea('ciphertext_hash').notNull(),
    // A deliberate, spec-justified exception to the no-timestamps rule (§4):
    // a blob's upload receipt time is a live observable the server has anyway,
    // and persisting it earns the reconcile sweep (§19) its "older than the
    // grace window" guard. Unlike sync_records, which hides content-creation time.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.blobId] })],
);
