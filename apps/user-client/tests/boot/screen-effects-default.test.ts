// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

describe('screenEffectsEnabled default', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('seeds true for a fresh settings row', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    const row = await db.settings.get(1);
    expect(row?.screenEffectsEnabled).toBe(true);
  });
});
