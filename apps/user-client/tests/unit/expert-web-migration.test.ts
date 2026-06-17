// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';

afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('Dexie v17 expertWeb', () => {
  it('seeds expertWeb on a fresh settings singleton', async () => {
    const db = await openClientDataDb();
    const s = await db.settings.get(1);
    expect(s?.expertWeb).toEqual({ search: null, fetch: null, searchTierId: null });
    expect(db.verno).toBe(26);
  });
});
