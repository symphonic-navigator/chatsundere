// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { getInstanceEpoch } from '../src/db/client.js';
import { reEpoch } from '../src/db/epoch.js';
import { type TestDb, withTestDb } from './helpers/test-db.js';

let t: TestDb;
beforeAll(async () => {
  t = await withTestDb();
});
afterAll(async () => {
  await t.close();
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('reEpoch', () => {
  test('replaces the single sync_meta row with a fresh epoch the server would read', async () => {
    const before = await getInstanceEpoch(t.db);
    const { old, next } = await reEpoch(t.db);
    expect(old).toBe(before);
    expect(next).toMatch(UUID);
    expect(next).not.toBe(before);
    // The value the server reads at boot has changed, and there is still exactly one row.
    expect(await getInstanceEpoch(t.db)).toBe(next);
    const rows = await t.sql.unsafe('SELECT instance_epoch FROM sync_meta');
    expect(rows.length).toBe(1);
  });
});
