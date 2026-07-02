// SPDX-License-Identifier: AGPL-3.0-only

import { and, asc, eq, gt } from 'drizzle-orm';
import type { SyncRecordErrorCode } from '@chatsundere/shared-types';
import type { Db } from '../db/client.js';
import { syncAccounts, syncRecords } from '../db/schema.js';
import { isSyncCollection } from './collections.js';

/** A record as it arrives on the push path, binary fields already decoded. */
export interface StoreWriteRecord {
  blindId: Uint8Array;
  collection: string;
  envelopeVersion: number;
  baseRev: number;
  deleted: boolean;
  nonce?: Uint8Array;
  ciphertext?: Uint8Array;
  ciphertextHash?: Uint8Array;
}

/** A stored record in binary form (the route base64url-encodes it for the wire). */
export interface StoredRecord {
  blindId: Uint8Array;
  collection: string;
  envelopeVersion: number;
  rev: number;
  deleted: boolean;
  nonce: Uint8Array | null;
  ciphertext: Uint8Array | null;
  ciphertextHash: Uint8Array | null;
}

/** Per-record write outcome (binary `current`; the route maps it to the wire type). */
export type StoreResult =
  | { status: 'ok'; rev: number }
  | { status: 'conflict'; current: StoredRecord }
  | { status: 'tombstoned'; current: StoredRecord }
  | { status: 'error'; code: SyncRecordErrorCode; usedBytes?: number; quotaBytes?: number };

export interface BatchLimits {
  maxRecordBytes: number;
  quotaBytes: number;
  /** Returns how many of `count` requested tombstones the delete-rate window permits. */
  deleteAllowance: (count: number) => Promise<number>;
}

function toStored(row: typeof syncRecords.$inferSelect): StoredRecord {
  return {
    blindId: row.blindId,
    collection: row.collection,
    envelopeVersion: row.envelopeVersion,
    rev: row.rev,
    deleted: row.deleted,
    nonce: row.nonce ?? null,
    ciphertext: row.ciphertext ?? null,
    ciphertextHash: row.ciphertextHash ?? null,
  };
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Applies a push batch under a single transaction. The `sync_accounts` row is
 * locked FOR UPDATE unconditionally at batch start (spec §4), serialising
 * concurrent batches so per-record CAS can never race into a composite-PK
 * abort. Returns per-record outcomes positionally aligned with `records`, the
 * new `head`, and whether any record got a fresh rev (drives the doorbell).
 */
export async function applyBatch(
  db: Db,
  accountId: string,
  records: StoreWriteRecord[],
  limits: BatchLimits,
): Promise<{ head: number; results: StoreResult[]; accepted: boolean }> {
  return db.transaction(async (tx) => {
    await tx.insert(syncAccounts).values({ accountId }).onConflictDoNothing();
    const [account] = await tx
      .select()
      .from(syncAccounts)
      .where(eq(syncAccounts.accountId, accountId))
      .for('update');
    let head = account?.headRev ?? 0;
    let totalBytes = account?.totalBytes ?? 0;
    let accepted = false;

    const deletesRequested = records.filter((r) => r.deleted).length;
    let deleteAllowance = deletesRequested > 0 ? await limits.deleteAllowance(deletesRequested) : 0;

    const results: StoreResult[] = [];

    for (const record of records) {
      const existing = await tx
        .select()
        .from(syncRecords)
        .where(and(eq(syncRecords.accountId, accountId), eq(syncRecords.blindId, record.blindId)));
      const current = existing[0];
      const oldSize = current?.ciphertext?.length ?? 0;

      // 1. Insert/update against a tombstone → terminal.
      if (current?.deleted && !record.deleted) {
        results.push({ status: 'tombstoned', current: toStored(current) });
        continue;
      }

      // 2. Delete — unconditional (skips CAS), bounded by the delete-rate window.
      if (record.deleted) {
        if (current?.deleted) {
          results.push({ status: 'ok', rev: current.rev }); // idempotent, no head bump
          continue;
        }
        if (deleteAllowance <= 0) {
          results.push({ status: 'error', code: 'delete_rate_limited' });
          continue;
        }
        deleteAllowance -= 1;
        const rev = ++head;
        await tx
          .insert(syncRecords)
          .values({
            accountId,
            blindId: record.blindId,
            collection: current?.collection ?? record.collection,
            envelopeVersion: current?.envelopeVersion ?? record.envelopeVersion,
            rev,
            deleted: true,
            nonce: null,
            ciphertext: null,
            ciphertextHash: null,
          })
          .onConflictDoUpdate({
            target: [syncRecords.accountId, syncRecords.blindId],
            set: { rev, deleted: true, nonce: null, ciphertext: null, ciphertextHash: null },
          });
        totalBytes -= oldSize;
        accepted = true;
        results.push({ status: 'ok', rev });
        continue;
      }

      // 3. Unknown collection.
      if (!isSyncCollection(record.collection)) {
        results.push({ status: 'error', code: 'bad_collection' });
        continue;
      }
      // 4. Update whose collection differs from the stored tag.
      if (current && current.collection !== record.collection) {
        results.push({ status: 'error', code: 'collection_mismatch' });
        continue;
      }
      const ciphertext = record.ciphertext;
      const ciphertextHash = record.ciphertextHash;
      if (!ciphertext || !ciphertextHash || !record.nonce) {
        // A non-delete write must carry all crypto fields (route validates shape).
        results.push({ status: 'error', code: 'hash_mismatch' });
        continue;
      }
      // 5. Record too large.
      if (ciphertext.length > limits.maxRecordBytes) {
        results.push({ status: 'error', code: 'record_too_large' });
        continue;
      }
      // 6. Hash mismatch.
      if (!bytesEqual(await sha256(ciphertext), ciphertextHash)) {
        results.push({ status: 'error', code: 'hash_mismatch' });
        continue;
      }
      // 7. Compare-and-swap.
      const isInsert = record.baseRev === 0;
      const casConflict = isInsert === (current !== undefined) || (current && current.rev !== record.baseRev);
      if (casConflict) {
        results.push({ status: 'conflict', current: toStored(current as typeof syncRecords.$inferSelect) });
        continue;
      }
      // 8. Quota.
      const newSize = ciphertext.length;
      if (totalBytes - oldSize + newSize > limits.quotaBytes) {
        results.push({
          status: 'error',
          code: 'quota_exceeded',
          usedBytes: totalBytes,
          quotaBytes: limits.quotaBytes,
        });
        continue;
      }
      // 9. Accept.
      const rev = ++head;
      await tx
        .insert(syncRecords)
        .values({
          accountId,
          blindId: record.blindId,
          collection: record.collection,
          envelopeVersion: record.envelopeVersion,
          rev,
          deleted: false,
          nonce: record.nonce,
          ciphertext,
          ciphertextHash,
        })
        .onConflictDoUpdate({
          target: [syncRecords.accountId, syncRecords.blindId],
          set: { collection: record.collection, envelopeVersion: record.envelopeVersion, rev, deleted: false, nonce: record.nonce, ciphertext, ciphertextHash },
        });
      totalBytes = totalBytes - oldSize + newSize;
      accepted = true;
      results.push({ status: 'ok', rev });
    }

    await tx
      .update(syncAccounts)
      .set({ headRev: head, totalBytes })
      .where(eq(syncAccounts.accountId, accountId));
    return { head, results, accepted };
  });
}

/** The account's current high-water rev (0 if the account has never written). */
export async function getHead(db: Db, accountId: string): Promise<number> {
  const [account] = await db.select().from(syncAccounts).where(eq(syncAccounts.accountId, accountId));
  return account?.headRev ?? 0;
}

/**
 * Returns records with `rev > since`, ascending, up to `limit` and the page
 * byte budget (a page ends early with `more: true` when the next record would
 * exceed the budget — the first record always goes, so a large record never
 * stalls the pull).
 */
export async function pullSince(
  db: Db,
  accountId: string,
  since: number,
  limit: number,
  byteBudget: number,
): Promise<{ head: number; more: boolean; records: StoredRecord[] }> {
  const head = await getHead(db, accountId);
  const rows = await db
    .select()
    .from(syncRecords)
    .where(and(eq(syncRecords.accountId, accountId), gt(syncRecords.rev, since)))
    .orderBy(asc(syncRecords.rev))
    .limit(limit + 1);

  const out: StoredRecord[] = [];
  let bytes = 0;
  let more = false;
  for (let i = 0; i < rows.length; i++) {
    if (i >= limit) {
      more = true;
      break;
    }
    const row = rows[i] as typeof syncRecords.$inferSelect;
    const size = row.ciphertext?.length ?? 0;
    if (out.length > 0 && bytes + size > byteBudget) {
      more = true;
      break;
    }
    out.push(toStored(row));
    bytes += size;
  }
  return { head, more, records: out };
}
