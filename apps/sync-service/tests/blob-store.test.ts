// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  commitBlob,
  deleteBlobRow,
  findBlob,
  flooredBytes,
  listBlobs,
} from '../src/blobs/store.js';
import { syncAccounts } from '../src/db/schema.js';
import { applyBatch } from '../src/records/store.js';
import { type TestDb, withTestDb } from './helpers/test-db.js';

let t: TestDb;
beforeAll(async () => {
  t = await withTestDb();
});
afterEach(async () => {
  await t.reset();
});
afterAll(async () => {
  await t.close();
});

const ACC = '44444444-4444-4444-4444-444444444444';
const ACC2 = '55555555-5555-5555-5555-555555555555';
const FLOOR = 65536;
const hash = (fill: number) => new Uint8Array(32).fill(fill);

async function total(accountId: string): Promise<number> {
  const [a] = await t.db.select().from(syncAccounts).where(eq(syncAccounts.accountId, accountId));
  return a?.totalBytes ?? 0;
}

describe('flooredBytes', () => {
  test('charges at least the floor', () => {
    expect(flooredBytes(1024, FLOOR)).toBe(FLOOR);
    expect(flooredBytes(100000, FLOOR)).toBe(100000);
  });
});

describe('commitBlob', () => {
  const limits = { quotaBytes: 10 * FLOOR, floorBytes: FLOOR };

  test('inserts a row and bumps total_bytes by the floored size', async () => {
    const r = await commitBlob(t.db, ACC, 'blobAAAAAAAAAAAAAAAAAA', 1024, hash(1), limits);
    expect(r.status).toBe('created');
    const row = await findBlob(t.db, ACC, 'blobAAAAAAAAAAAAAAAAAA');
    expect(row?.bytes).toBe(1024); // true size stored
    expect(await total(ACC)).toBe(FLOOR); // floored charge
  });

  test('a large blob charges its true size', async () => {
    await commitBlob(t.db, ACC, 'blobBBBBBBBBBBBBBBBBBB', 200000, hash(2), limits);
    expect(await total(ACC)).toBe(200000);
  });

  test('exact fit passes; one more byte → quota_exceeded', async () => {
    const tight = { quotaBytes: 2 * FLOOR, floorBytes: FLOOR };
    expect(
      (await commitBlob(t.db, ACC, 'b1AAAAAAAAAAAAAAAAAAAA', FLOOR, hash(1), tight)).status,
    ).toBe('created');
    expect(
      (await commitBlob(t.db, ACC, 'b2AAAAAAAAAAAAAAAAAAAA', FLOOR, hash(2), tight)).status,
    ).toBe('created');
    const over = await commitBlob(t.db, ACC, 'b3AAAAAAAAAAAAAAAAAAAA', 1, hash(3), tight);
    expect(over.status).toBe('quota_exceeded');
    if (over.status === 'quota_exceeded') {
      expect(over.usedBytes).toBe(2 * FLOOR);
      expect(over.quotaBytes).toBe(2 * FLOOR);
    }
  });

  test('idempotent re-commit of the same blobId does not double-count', async () => {
    await commitBlob(t.db, ACC, 'dupAAAAAAAAAAAAAAAAAAA', 1024, hash(1), limits);
    const again = await commitBlob(t.db, ACC, 'dupAAAAAAAAAAAAAAAAAAA', 1024, hash(1), limits);
    expect(again.status).toBe('created');
    expect(await total(ACC)).toBe(FLOOR); // still one charge
  });

  test('two concurrent commits that each fit alone but not together → one created, counter ≤ quota', async () => {
    const tight = { quotaBytes: FLOOR + 1024, floorBytes: FLOOR };
    const [a, b] = await Promise.all([
      commitBlob(t.db, ACC, 'raceAAAAAAAAAAAAAAAAA1', 1024, hash(1), tight),
      commitBlob(t.db, ACC, 'raceAAAAAAAAAAAAAAAAA2', 1024, hash(2), tight),
    ]);
    const created = [a, b].filter((r) => r.status === 'created').length;
    expect(created).toBe(1);
    expect(await total(ACC)).toBeLessThanOrEqual(tight.quotaBytes);
  });

  test('a blob commit and a record batch share the counter (no overshoot)', async () => {
    // Near-quota: a ~100 KiB record already stored; the quota then leaves less
    // than one floored blob's room, so the blob must be refused under the lock.
    const quota = 150000;
    const blindId = new Uint8Array(16).fill(7);
    const ct = new Uint8Array(100000).fill(1);
    const ch = new Uint8Array(await crypto.subtle.digest('SHA-256', ct));
    await applyBatch(
      t.db,
      ACC,
      [
        {
          blindId,
          collection: 'chats',
          envelopeVersion: 1,
          baseRev: 0,
          deleted: false,
          nonce: new Uint8Array(12),
          ciphertext: ct,
          ciphertextHash: ch,
        },
      ],
      { maxRecordBytes: 2_097_152, quotaBytes: quota, deleteAllowance: async () => 0 },
    );
    // Now a blob that alone fits the floor but together overshoots.
    const r = await commitBlob(t.db, ACC, 'coexistAAAAAAAAAAAAAA1', 1024, hash(3), {
      quotaBytes: quota,
      floorBytes: FLOOR,
    });
    expect(r.status).toBe('quota_exceeded');
    expect(await total(ACC)).toBeLessThanOrEqual(quota);
  });
});

describe('deleteBlobRow', () => {
  test('credits the floored bytes and is idempotent', async () => {
    const limits = { quotaBytes: 10 * FLOOR, floorBytes: FLOOR };
    await commitBlob(t.db, ACC, 'delAAAAAAAAAAAAAAAAAAA', 1024, hash(1), limits);
    expect(await total(ACC)).toBe(FLOOR);
    const first = await deleteBlobRow(t.db, ACC, 'delAAAAAAAAAAAAAAAAAAA', FLOOR);
    expect(first.existed).toBe(true);
    expect(await total(ACC)).toBe(0);
    const second = await deleteBlobRow(t.db, ACC, 'delAAAAAAAAAAAAAAAAAAA', FLOOR);
    expect(second.existed).toBe(false);
    expect(await total(ACC)).toBe(0);
  });
});

describe('listBlobs', () => {
  test('is account-scoped with per-account totals', async () => {
    const limits = { quotaBytes: 10 * FLOOR, floorBytes: FLOOR };
    await commitBlob(t.db, ACC, 'l1AAAAAAAAAAAAAAAAAAAA', 1024, hash(1), limits);
    await commitBlob(t.db, ACC, 'l2AAAAAAAAAAAAAAAAAAAA', 2048, hash(2), limits);
    await commitBlob(t.db, ACC2, 'l3AAAAAAAAAAAAAAAAAAAA', 4096, hash(3), limits);
    const listA = await listBlobs(t.db, ACC);
    expect(listA.blobs.length).toBe(2);
    expect(listA.totalBytes).toBe(2 * FLOOR);
    const listB = await listBlobs(t.db, ACC2);
    expect(listB.blobs.length).toBe(1);
    expect(listB.blobs[0]?.bytes).toBe(4096);
  });

  test('empty account → empty list', async () => {
    const list = await listBlobs(t.db, ACC);
    expect(list.blobs).toEqual([]);
    expect(list.totalBytes).toBe(0);
  });
});
