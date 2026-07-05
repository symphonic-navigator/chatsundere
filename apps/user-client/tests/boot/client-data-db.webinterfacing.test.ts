// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';

describe('settings.webInterfacing (Dexie v11)', () => {
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('seeds the settings singleton with an empty webInterfacing block', async () => {
    const db = await openClientDataDb();
    const settings = await db.settings.get(1);
    expect(settings?.webInterfacing).toEqual({ search: null, fetch: null });
  });

  it('is at version 11', async () => {
    const db = await openClientDataDb();
    expect(db.verno).toBe(34);
  });
});
