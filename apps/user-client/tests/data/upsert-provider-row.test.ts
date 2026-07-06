// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { asMasterKey, getRandomBytes } from '@chatsundere/crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { upsertProviderRow } from '../../src/data/providers.js';
import { sealSecret } from '../../src/lib/secrets.js';

const mk = asMasterKey(getRandomBytes(32));
const seal = (v: string) => sealSecret(v, mk, 'provider/nano-gpt/api-key');

describe('upsertProviderRow (keyed by templateId)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => await _resetClientDataDbForTests());

  it('creates a row whose id equals its templateId, with keySlot = templateId', async () => {
    const row = await upsertProviderRow({
      templateId: 'nano-gpt',
      apiKey: await seal('k1'),
      enabled: false,
      keySlot: 'nano-gpt',
    });
    expect(row.id).toBe('nano-gpt');
    expect(row.keySlot).toBe('nano-gpt');
    expect((await getClientDataDb().providers.get('nano-gpt'))?.id).toBe('nano-gpt');
  });

  it('a second upsert of the same templateId updates in place — exactly one row', async () => {
    await upsertProviderRow({
      templateId: 'nano-gpt',
      apiKey: await seal('a'),
      enabled: false,
      keySlot: 'nano-gpt',
    });
    await upsertProviderRow({
      templateId: 'nano-gpt',
      apiKey: await seal('b'),
      enabled: true,
      keySlot: 'nano-gpt',
    });
    const db = getClientDataDb();
    expect(await db.providers.where('templateId').equals('nano-gpt').count()).toBe(1);
    expect((await db.providers.get('nano-gpt'))?.enabled).toBe(true);
  });
});
