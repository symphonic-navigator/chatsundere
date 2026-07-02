// SPDX-License-Identifier: AGPL-3.0-only

import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { syncAccounts, syncBlobs } from '../db/schema.js';

// Blob metadata store (blob spec §4/§7.1). Mirrors records/store.ts's lock shape:
// every mutation takes the same `sync_accounts` FOR UPDATE lock that serialises
// record batches, so blob writes and record batches cannot race the shared
// `total_bytes` counter. Quota is enforced UNDER the lock, not by the §7.1
// pre-check (which is a cheap fast-fail only).

export type BlobCommitResult =
  | { status: 'created' }
  | { status: 'blob_exists' }
  | { status: 'quota_exceeded'; usedBytes: number; quotaBytes: number };

/** Byte-wise equality, used for ciphertext-hash comparison. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Each blob charges `max(bytes, floor)` against the shared quota (§4). */
export const flooredBytes = (bytes: number, floor: number): number => Math.max(bytes, floor);

/** The account's current `total_bytes` (0 if never written) — the §7.1 quota pre-check read. */
export async function getAccountTotal(db: Db, accountId: string): Promise<number> {
  const [account] = await db
    .select()
    .from(syncAccounts)
    .where(eq(syncAccounts.accountId, accountId));
  return account?.totalBytes ?? 0;
}

/** Looks up a blob row (existence check without an S3 round trip). */
export async function findBlob(
  db: Db,
  accountId: string,
  blobId: string,
): Promise<{ bytes: number; ciphertextHash: Uint8Array } | null> {
  const [row] = await db
    .select()
    .from(syncBlobs)
    .where(and(eq(syncBlobs.accountId, accountId), eq(syncBlobs.blobId, blobId)));
  return row ? { bytes: row.bytes, ciphertextHash: row.ciphertextHash } : null;
}

/**
 * Commits an uploaded blob: locks the `sync_accounts` row FOR UPDATE, re-verifies
 * the quota under the lock (floored, §7.1 step 6), inserts the row, and bumps
 * `total_bytes`. Idempotent — a row already present (a concurrent winner or a
 * lost-ack retry) neither errors nor double-counts.
 */
export async function commitBlob(
  db: Db,
  accountId: string,
  blobId: string,
  bytes: number,
  hash: Uint8Array,
  limits: { quotaBytes: number; floorBytes: number },
): Promise<BlobCommitResult> {
  return db.transaction(async (tx) => {
    await tx.insert(syncAccounts).values({ accountId }).onConflictDoNothing();
    const [account] = await tx
      .select()
      .from(syncAccounts)
      .where(eq(syncAccounts.accountId, accountId))
      .for('update');
    const totalBytes = account?.totalBytes ?? 0;

    // Under the lock: a row already present with the SAME hash is already
    // counted → idempotent. A DIFFERENT hash means a divergent-body racer won
    // the id (spec §7.1 step 3 semantics re-checked here, because both racers
    // can pass the unlocked route-level existence check) — the caller must see
    // `blob_exists`, never a false success, so the §12 fresh-id repair fires.
    const [existing] = await tx
      .select()
      .from(syncBlobs)
      .where(and(eq(syncBlobs.accountId, accountId), eq(syncBlobs.blobId, blobId)));
    if (existing) {
      return bytesEqual(existing.ciphertextHash, hash)
        ? { status: 'created' as const }
        : { status: 'blob_exists' as const };
    }

    const charge = flooredBytes(bytes, limits.floorBytes);
    if (totalBytes + charge > limits.quotaBytes) {
      return {
        status: 'quota_exceeded' as const,
        usedBytes: totalBytes,
        quotaBytes: limits.quotaBytes,
      };
    }

    await tx
      .insert(syncBlobs)
      .values({ accountId, blobId, bytes, ciphertextHash: hash })
      .onConflictDoNothing();
    await tx
      .update(syncAccounts)
      .set({ totalBytes: totalBytes + charge })
      .where(eq(syncAccounts.accountId, accountId));
    return { status: 'created' as const };
  });
}

/**
 * DB-first delete (blob spec §7.3): removes the row and credits the floored
 * bytes under the lock. Idempotent — an absent row credits nothing.
 */
export async function deleteBlobRow(
  db: Db,
  accountId: string,
  blobId: string,
  floorBytes: number,
): Promise<{ existed: boolean }> {
  return db.transaction(async (tx) => {
    await tx.insert(syncAccounts).values({ accountId }).onConflictDoNothing();
    const [account] = await tx
      .select()
      .from(syncAccounts)
      .where(eq(syncAccounts.accountId, accountId))
      .for('update');
    const [row] = await tx
      .select()
      .from(syncBlobs)
      .where(and(eq(syncBlobs.accountId, accountId), eq(syncBlobs.blobId, blobId)));
    if (!row) return { existed: false };

    await tx
      .delete(syncBlobs)
      .where(and(eq(syncBlobs.accountId, accountId), eq(syncBlobs.blobId, blobId)));
    const credited = flooredBytes(row.bytes, floorBytes);
    const totalBytes = Math.max(0, (account?.totalBytes ?? 0) - credited);
    await tx.update(syncAccounts).set({ totalBytes }).where(eq(syncAccounts.accountId, accountId));
    return { existed: true };
  });
}

/** Account-scoped inventory (blob spec §7.4). Unpaginated in v1 (§4 floor bounds it). */
export async function listBlobs(
  db: Db,
  accountId: string,
): Promise<{ blobs: { blobId: string; bytes: number }[]; totalBytes: number }> {
  const rows = await db.select().from(syncBlobs).where(eq(syncBlobs.accountId, accountId));
  const [account] = await db
    .select()
    .from(syncAccounts)
    .where(eq(syncAccounts.accountId, accountId));
  return {
    blobs: rows.map((r) => ({ blobId: r.blobId, bytes: r.bytes })),
    totalBytes: account?.totalBytes ?? 0,
  };
}
