// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';

afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('Dexie v19 imageGeneration', () => {
  it('seeds imageGeneration on a fresh settings singleton', async () => {
    const db = await openClientDataDb();
    const s = await db.settings.get(1);
    expect(s?.imageGeneration).toEqual({ primary: null, nsfw: null });
    expect(db.verno).toBe(27);
  });
});
