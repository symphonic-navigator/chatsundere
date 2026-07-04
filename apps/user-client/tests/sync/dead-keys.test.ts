// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { isDeadKey, markDead } from '../../src/sync/dead-keys.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});

afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('dead-keys — §3.9 durable H-1 anchor', () => {
  it('reports a marked key as dead', async () => {
    await markDead('chats', 'c1');
    expect(await isDeadKey('chats', 'c1')).toBe(true);
  });

  it('reports an unmarked key as not dead', async () => {
    expect(await isDeadKey('chats', 'never')).toBe(false);
  });
});
