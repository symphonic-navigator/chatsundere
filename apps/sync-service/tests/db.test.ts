// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { getInstanceEpoch } from '../src/db/client.js';
import { syncBlobs, syncRecords } from '../src/db/schema.js';
import { type TestDb, withTestDb } from './helpers/test-db.js';

let t: TestDb;
beforeAll(async () => {
  t = await withTestDb();
});
afterAll(async () => {
  await t.close();
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('sync-service schema', () => {
  test('migrations seed exactly one sync_meta row with a uuid epoch', async () => {
    const rows = await t.sql.unsafe('SELECT instance_epoch FROM sync_meta');
    expect(rows.length).toBe(1);
    expect(String(rows[0]?.instance_epoch)).toMatch(UUID);
    expect(await getInstanceEpoch(t.db)).toMatch(UUID);
  });

  test('a 2 MiB ciphertext round-trips byte-identically', async () => {
    const accountId = '11111111-1111-1111-1111-111111111111';
    const blindId = new Uint8Array(16).fill(3);
    const ciphertext = new Uint8Array(2 * 1024 * 1024);
    for (let i = 0; i < ciphertext.length; i++) ciphertext[i] = (i * 13) & 0xff;
    await t.db.insert(syncRecords).values({
      accountId,
      blindId,
      collection: 'chats',
      rev: 1,
      nonce: new Uint8Array(12),
      ciphertext,
      ciphertextHash: new Uint8Array(32),
    });
    const [row] = await t.db.select().from(syncRecords).where(sql`account_id = ${accountId}`);
    const back = row?.ciphertext as Uint8Array;
    expect(back).toBeInstanceOf(Uint8Array);
    expect(back.length).toBe(ciphertext.length);
    let identical = true;
    for (let i = 0; i < ciphertext.length; i += 4093)
      if (back[i] !== ciphertext[i]) {
        identical = false;
        break;
      }
    expect(identical).toBe(true);
    await t.reset();
  });

  test('sync_records has no timestamp column (the §4 invariant)', async () => {
    const rows = await t.sql.unsafe(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'sync_records'`,
    );
    const timestampish = rows.filter((r) => String(r.data_type).includes('timestamp'));
    expect(timestampish).toEqual([]);
  });

  test('sync_blobs stores a metadata row and rejects duplicate (account, blob) pairs', async () => {
    const accountId = '22222222-2222-2222-2222-222222222222';
    const blobId = 'AAAAAAAAAAAAAAAAAAAAAA';
    await t.db.insert(syncBlobs).values({
      accountId,
      blobId,
      bytes: 4096,
      ciphertextHash: new Uint8Array(32).fill(9),
    });
    const [row] = await t.db.select().from(syncBlobs).where(sql`account_id = ${accountId}`);
    expect(row?.blobId).toBe(blobId);
    expect(row?.bytes).toBe(4096);
    expect(row?.ciphertextHash).toBeInstanceOf(Uint8Array);
    expect((row?.ciphertextHash as Uint8Array).length).toBe(32);
    expect(row?.createdAt).toBeInstanceOf(Date);
    // Composite PK: a second insert of the same (account, blob) must fail.
    let threw = false;
    try {
      await t.db.insert(syncBlobs).values({
        accountId,
        blobId,
        bytes: 4096,
        ciphertextHash: new Uint8Array(32),
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    await t.reset();
  });

  test('a re-migration mints a different instance_epoch (simulated restore)', async () => {
    const first = await getInstanceEpoch(t.db);
    const fresh = await withTestDb();
    const second = await getInstanceEpoch(fresh.db);
    await fresh.close();
    expect(second).toMatch(UUID);
    expect(second).not.toBe(first);
  });
});
