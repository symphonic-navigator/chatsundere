// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { type MasterKey, asMasterKey, getRandomBytes } from '@chatsundere/crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type ProviderRow,
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { providerKeySource } from '../../src/credentials/sources/provider-key-source.js';
import { sealSecret } from '../../src/lib/secrets.js';

let mk: MasterKey;
let otherMk: MasterKey;

beforeAll(() => {
  mk = asMasterKey(getRandomBytes(32));
  otherMk = asMasterKey(getRandomBytes(32));
});

async function addProvider(args: {
  id: string;
  templateId: string;
  enabled: boolean;
  key: string;
}): Promise<void> {
  const apiKey = await sealSecret(args.key, mk, `provider/${args.id}/api-key`);
  const now = Date.now();
  const row: ProviderRow = {
    id: args.id,
    templateId: args.templateId,
    displayName: args.templateId,
    baseUrl: '',
    apiKey,
    routing: { kind: 'direct' },
    enabled: args.enabled,
    createdAt: now,
    updatedAt: now,
  };
  await getClientDataDb().providers.add(row);
}

describe('providerKeySource', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('has() is true for an enabled provider row', async () => {
    await addProvider({ id: 'row-a', templateId: 'nano-gpt', enabled: true, key: 'k' });
    expect(await providerKeySource.has('nano-gpt')).toBe(true);
  });

  it('has() is false for a disabled provider row', async () => {
    await addProvider({ id: 'row-a', templateId: 'nano-gpt', enabled: false, key: 'k' });
    expect(await providerKeySource.has('nano-gpt')).toBe(false);
  });

  it('has() is false when no row matches the id', async () => {
    expect(await providerKeySource.has('nano-gpt')).toBe(false);
  });

  it('get() opens the sealed key for an enabled row', async () => {
    await addProvider({ id: 'row-a', templateId: 'nano-gpt', enabled: true, key: 'secret-key' });
    expect(await providerKeySource.get('nano-gpt', mk)).toBe('secret-key');
  });

  it('get() returns null for a disabled row', async () => {
    await addProvider({ id: 'row-a', templateId: 'nano-gpt', enabled: false, key: 'secret-key' });
    expect(await providerKeySource.get('nano-gpt', mk)).toBeNull();
  });

  it('get() returns null when no row matches the id', async () => {
    expect(await providerKeySource.get('nano-gpt', mk)).toBeNull();
  });

  it('get() throws with the wrong MasterKey (AES-GCM tag)', async () => {
    await addProvider({ id: 'row-a', templateId: 'nano-gpt', enabled: true, key: 'secret-key' });
    await expect(providerKeySource.get('nano-gpt', otherMk)).rejects.toThrow();
  });
});
