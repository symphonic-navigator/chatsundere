// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import {
  type BatchLimits,
  type StoreWriteRecord,
  applyBatch,
  getHead,
  pullSince,
} from '../src/records/store.js';
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

const ACC = '11111111-1111-1111-1111-111111111111';
const ACC2 = '22222222-2222-2222-2222-222222222222';
const allow: BatchLimits = {
  maxRecordBytes: 2_000_000,
  quotaBytes: 1_000_000_000,
  deleteAllowance: async (c) => c,
};

async function rec(
  fill: number,
  opts: { collection?: string; baseRev?: number; size?: number; deleted?: boolean } = {},
): Promise<StoreWriteRecord> {
  const { collection = 'chats', baseRev = 0, size = 100, deleted = false } = opts;
  const blindId = new Uint8Array(16).fill(fill);
  if (deleted) return { blindId, collection, envelopeVersion: 1, baseRev, deleted: true };
  const ciphertext = new Uint8Array(size).fill(fill);
  const ciphertextHash = new Uint8Array(await crypto.subtle.digest('SHA-256', ciphertext));
  return {
    blindId,
    collection,
    envelopeVersion: 1,
    baseRev,
    deleted: false,
    nonce: new Uint8Array(12),
    ciphertext,
    ciphertextHash,
  };
}

describe('applyBatch CAS matrix', () => {
  test('insert on absent → ok rev 1, head 1', async () => {
    const { head, results, accepted } = await applyBatch(t.db, ACC, [await rec(1)], allow);
    expect(results[0]).toEqual({ status: 'ok', rev: 1 });
    expect(head).toBe(1);
    expect(accepted).toBe(true);
  });

  test('insert on present → conflict with current', async () => {
    await applyBatch(t.db, ACC, [await rec(1)], allow);
    const { results } = await applyBatch(t.db, ACC, [await rec(1)], allow);
    expect(results[0]?.status).toBe('conflict');
    expect((results[0] as { current: { rev: number } }).current.rev).toBe(1);
  });

  test('baseRev>0 on an absent blindId → resurrect as insert (no crash, heals lost-record drift)', async () => {
    // The client still holds a CAS base (baseRev>0) for a blindId the server has
    // no row for — e.g. a Postgres restore that left the epoch unchanged. The old
    // code hit this as a conflict and called toStored(undefined) → TypeError →
    // HTTP 500, wedging the drain forever. It must now accept the write as a fresh
    // insert, re-establishing the client's data.
    const { head, results, accepted } = await applyBatch(
      t.db,
      ACC,
      [await rec(7, { baseRev: 5 })],
      allow,
    );
    expect(results[0]).toEqual({ status: 'ok', rev: 1 });
    expect(head).toBe(1);
    expect(accepted).toBe(true);
  });

  test('update matching baseRev → ok; stale → conflict', async () => {
    await applyBatch(t.db, ACC, [await rec(1)], allow); // rev 1
    const ok = await applyBatch(t.db, ACC, [await rec(1, { baseRev: 1 })], allow);
    expect(ok.results[0]).toEqual({ status: 'ok', rev: 2 });
    const stale = await applyBatch(t.db, ACC, [await rec(1, { baseRev: 1 })], allow);
    expect(stale.results[0]?.status).toBe('conflict');
  });

  test('update with a mismatched collection → collection_mismatch', async () => {
    await applyBatch(t.db, ACC, [await rec(1, { collection: 'chats' })], allow);
    const { results } = await applyBatch(
      t.db,
      ACC,
      [await rec(1, { collection: 'personas', baseRev: 1 })],
      allow,
    );
    expect(results[0]).toEqual({ status: 'error', code: 'collection_mismatch' });
  });

  test('delete with a stale baseRev still wins; row nulled', async () => {
    await applyBatch(t.db, ACC, [await rec(1)], allow); // rev 1
    const del = await applyBatch(t.db, ACC, [await rec(1, { deleted: true, baseRev: 0 })], allow);
    expect(del.results[0]?.status).toBe('ok');
    const [row] = await t.sql.unsafe(
      `SELECT deleted, nonce, ciphertext, ciphertext_hash FROM sync_records WHERE account_id = '${ACC}'`,
    );
    expect(row?.deleted).toBe(true);
    expect(row?.nonce).toBeNull();
    expect(row?.ciphertext).toBeNull();
    expect(row?.ciphertext_hash).toBeNull();
  });

  test('delete of an absent blindId creates a terminal tombstone', async () => {
    const { results, accepted } = await applyBatch(
      t.db,
      ACC,
      [await rec(5, { deleted: true })],
      allow,
    );
    expect(results[0]?.status).toBe('ok');
    expect(accepted).toBe(true);
  });

  test('delete with an unvalidated collection is rejected before any write', async () => {
    // An authenticated client could otherwise push a delete of a fresh blindId
    // tagged with an arbitrary collection string; without a pre-write check it
    // would be stored as a tombstone and served to every device on the account,
    // crashing clients that try db.table('evil').
    const { results, accepted } = await applyBatch(
      t.db,
      ACC,
      [await rec(6, { deleted: true, collection: 'evil' })],
      allow,
    );
    expect(results[0]).toEqual({ status: 'error', code: 'bad_collection' });
    expect(accepted).toBe(false);
    const rows = await t.sql.unsafe(`SELECT * FROM sync_records WHERE account_id = '${ACC}'`);
    expect(rows.length).toBe(0);
  });

  test('delete with a valid collection still tombstones', async () => {
    const { results, accepted } = await applyBatch(
      t.db,
      ACC,
      [await rec(6, { deleted: true, collection: 'chats' })],
      allow,
    );
    expect(results[0]?.status).toBe('ok');
    expect(accepted).toBe(true);
  });

  test('delete of a tombstone is idempotent — no head bump, accepted false', async () => {
    await applyBatch(t.db, ACC, [await rec(5, { deleted: true })], allow); // head 1
    const again = await applyBatch(t.db, ACC, [await rec(5, { deleted: true })], allow);
    expect(again.results[0]?.status).toBe('ok');
    expect(again.head).toBe(1);
    expect(again.accepted).toBe(false);
  });

  test('insert and update against a tombstone → tombstoned', async () => {
    await applyBatch(t.db, ACC, [await rec(5, { deleted: true })], allow);
    const ins = await applyBatch(t.db, ACC, [await rec(5, { baseRev: 0 })], allow);
    expect(ins.results[0]?.status).toBe('tombstoned');
    const upd = await applyBatch(t.db, ACC, [await rec(5, { baseRev: 1 })], allow);
    expect(upd.results[0]?.status).toBe('tombstoned');
  });

  test('per-record atomicity: [ok, conflict, ok] aligned, both inserts persisted', async () => {
    await applyBatch(t.db, ACC, [await rec(2)], allow); // rev 1, makes rec(2) conflict on re-insert
    const { results } = await applyBatch(
      t.db,
      ACC,
      [await rec(1), await rec(2), await rec(3)],
      allow,
    );
    expect(results.map((r) => r.status)).toEqual(['ok', 'conflict', 'ok']);
    expect(await getHead(t.db, ACC)).toBe(3);
  });

  test('two concurrent batches inserting the same blindId → one ok, one conflict', async () => {
    const [a, b] = await Promise.all([
      applyBatch(t.db, ACC, [await rec(9)], allow),
      applyBatch(t.db, ACC, [await rec(9)], allow),
    ]);
    const statuses = [a.results[0]?.status, b.results[0]?.status].sort();
    expect(statuses).toEqual(['conflict', 'ok']);
  });

  test('revs are contiguous within a batch and accounts are isolated', async () => {
    const { results } = await applyBatch(
      t.db,
      ACC,
      [await rec(1), await rec(2), await rec(3)],
      allow,
    );
    expect(results.map((r) => (r as { rev: number }).rev)).toEqual([1, 2, 3]);
    const b = await applyBatch(t.db, ACC2, [await rec(1)], allow);
    expect(b.results[0]).toEqual({ status: 'ok', rev: 1 }); // account B starts fresh
  });

  test('record_too_large and quota_exceeded', async () => {
    const tooBig = await applyBatch(t.db, ACC, [await rec(1, { size: 200 })], {
      ...allow,
      maxRecordBytes: 100,
    });
    expect(tooBig.results[0]).toEqual({ status: 'error', code: 'record_too_large' });
    const overQuota = await applyBatch(t.db, ACC, [await rec(2, { size: 500 })], {
      ...allow,
      quotaBytes: 100,
    });
    expect(overQuota.results[0]).toMatchObject({
      status: 'error',
      code: 'quota_exceeded',
      quotaBytes: 100,
    });
  });

  test('quota accounting: update replaces old bytes, tombstone frees them', async () => {
    await applyBatch(t.db, ACC, [await rec(1, { size: 500 })], allow); // used 500
    await applyBatch(t.db, ACC, [await rec(1, { size: 200, baseRev: 1 })], allow); // used 200
    const [acct1] = await t.sql.unsafe(
      `SELECT total_bytes FROM sync_accounts WHERE account_id = '${ACC}'`,
    );
    expect(Number(acct1?.total_bytes)).toBe(200);
    await applyBatch(t.db, ACC, [await rec(1, { deleted: true })], allow); // freed
    const [acct2] = await t.sql.unsafe(
      `SELECT total_bytes FROM sync_accounts WHERE account_id = '${ACC}'`,
    );
    expect(Number(acct2?.total_bytes)).toBe(0);
  });

  test('delete_rate_limited when the allowance grants fewer than requested', async () => {
    const limits: BatchLimits = { ...allow, deleteAllowance: async () => 1 };
    const { results } = await applyBatch(
      t.db,
      ACC,
      [await rec(1, { deleted: true }), await rec(2, { deleted: true })],
      limits,
    );
    expect(results[0]?.status).toBe('ok');
    expect(results[1]).toEqual({ status: 'error', code: 'delete_rate_limited' });
  });
});

describe('pullSince', () => {
  test('ascending, since boundary, limit, and tombstone shape', async () => {
    await applyBatch(t.db, ACC, [await rec(1), await rec(2), await rec(3)], allow); // revs 1,2,3
    await applyBatch(t.db, ACC, [await rec(2, { deleted: true, baseRev: 2 })], allow); // rev 4 tombstone

    const all = await pullSince(t.db, ACC, 0, 200, 8_388_608);
    expect(all.head).toBe(4);
    expect(all.records.map((r) => r.rev)).toEqual([1, 3, 4]); // rec(2) overwritten by its rev-4 tombstone
    const tomb = all.records.find((r) => r.rev === 4);
    expect(tomb?.deleted).toBe(true);
    expect(tomb?.ciphertext).toBeNull();

    const sinceMid = await pullSince(t.db, ACC, 3, 200, 8_388_608);
    expect(sinceMid.records.map((r) => r.rev)).toEqual([4]);
  });

  test('limit truncates with more: true', async () => {
    await applyBatch(t.db, ACC, [await rec(1), await rec(2), await rec(3)], allow);
    const page = await pullSince(t.db, ACC, 0, 2, 8_388_608);
    expect(page.records).toHaveLength(2);
    expect(page.more).toBe(true);
  });

  test('byte budget ends a page early with more: true', async () => {
    await applyBatch(
      t.db,
      ACC,
      [await rec(1, { size: 1000 }), await rec(2, { size: 1000 })],
      allow,
    );
    const page = await pullSince(t.db, ACC, 0, 200, 1500); // second record would exceed budget
    expect(page.records).toHaveLength(1);
    expect(page.more).toBe(true);
  });
});
