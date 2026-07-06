// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import {
  type LocalAccountRow,
  type MasterKey,
  asMasterKey,
  deriveDek,
  deriveIdentityTag,
  putLocalAccount,
} from '@chatsundere/crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import {
  CLIENT_DATA_IDENTITY_CONTEXT,
  enforceClientDataIdentity,
  wipeClientDataForFreshOnboarding,
  wipeClientDataStores,
} from '../../src/boot/client-data-identity.js';
import { closeDb, openDb } from '../../src/boot/open-db.js';

const ACCOUNT: LocalAccountRow = {
  schema_version: 1,
  username: 'existing',
  local_salt: new Uint8Array(16),
  wrapped_mk_local_ciphertext: new Uint8Array(1),
  wrapped_mk_local_nonce: new Uint8Array(12),
  wrapped_mk_local_aad: new Uint8Array(1),
  wrapped_mk_local_integrity: new Uint8Array(32),
  wrapped_mk_recovery_ciphertext: new Uint8Array(1),
  wrapped_mk_recovery_nonce: new Uint8Array(12),
  wrapped_mk_recovery_aad: new Uint8Array(1),
  wrapped_mk_recovery_integrity: new Uint8Array(32),
  recovery_verifier_key: new Uint8Array(32),
  created_at: new Date(0),
};

const deleteRaw = (name: string) =>
  new Promise<void>((res) => {
    const r = indexedDB.deleteDatabase(name);
    r.onsuccess = () => res();
    r.onerror = () => res();
  });

const MK_A = asMasterKey(Uint8Array.from(Array.from({ length: 32 }, (_, i) => i)));
const MK_B = asMasterKey(Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 100)));

// A minimal MasterKeySession stand-in: only the encapsulated `deriveDek` the
// guard consumes. Mirrors the real session, which never surfaces the raw MK.
const sessionFor = (mk: MasterKey) => ({ deriveDek: (context: string) => deriveDek(mk, context) });
const tagFor = (mk: MasterKey) => deriveIdentityTag(mk, CLIENT_DATA_IDENTITY_CONTEXT);

function dummyProvider(id: string) {
  return {
    id,
    templateId: 'nano-gpt',
    displayName: 'nano',
    baseUrl: 'https://example.test',
    apiKey: {
      version: 1 as const,
      ciphertext: new Uint8Array([1, 2, 3]),
      nonce: new Uint8Array(12),
    },
    routing: { kind: 'direct' as const },
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('enforceClientDataIdentity', () => {
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('adopts the current identity on a tag-less (legacy) store without wiping', async () => {
    const db = await openClientDataDb();
    await db.providers.add(dummyProvider('p1'));

    await enforceClientDataIdentity(sessionFor(MK_A));

    const after = await openClientDataDb();
    expect(await after.providers.get('p1')).toBeDefined();
    expect((await after.settings.get(1))?.identityTag).toBe(await tagFor(MK_A));
  });

  it('keeps the store when the identity matches', async () => {
    const db = await openClientDataDb();
    await db.settings.update(1, { identityTag: await tagFor(MK_A) });
    await db.providers.add(dummyProvider('p1'));

    await enforceClientDataIdentity(sessionFor(MK_A));

    const after = await openClientDataDb();
    expect(await after.providers.get('p1')).toBeDefined();
    expect((await after.settings.get(1))?.identityTag).toBe(await tagFor(MK_A));
  });

  it('wipes client-data and rebinds when the identity differs', async () => {
    const db = await openClientDataDb();
    await db.settings.update(1, { identityTag: await tagFor(MK_A) });
    await db.providers.add(dummyProvider('p1'));

    await enforceClientDataIdentity(sessionFor(MK_B));

    const after = await openClientDataDb();
    expect(await after.providers.get('p1')).toBeUndefined();
    expect((await after.settings.get(1))?.identityTag).toBe(await tagFor(MK_B));
  });
});

describe('wipeClientDataStores (the onboarding pre-persist wipe)', () => {
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('clears client-data (including legacy tag-less rows) so a fresh onboarding starts empty', async () => {
    const db = await openClientDataDb();
    await db.settings.update(1, { identityTag: await tagFor(MK_A) });
    await db.providers.add(dummyProvider('p1'));

    await wipeClientDataStores();

    const after = await openClientDataDb();
    expect(await after.providers.get('p1')).toBeUndefined();
    expect((await after.settings.get(1))?.identityTag).toBeUndefined();
  });
});

describe('wipeClientDataForFreshOnboarding (the HIGH-1 data-loss guard)', () => {
  afterEach(async () => {
    closeDb();
    await _resetClientDataDbForTests();
    await deleteRaw('chatsundere'); // the raw crypto account DB
  });

  it('wipes on a genuinely fresh device (no local account)', async () => {
    const cryptoDb = await openDb();
    const cd = await openClientDataDb();
    await cd.providers.add(dummyProvider('p1'));

    await wipeClientDataForFreshOnboarding(cryptoDb);

    expect(await (await openClientDataDb()).providers.get('p1')).toBeUndefined();
  });

  it('does NOT wipe when a local account already exists (must not destroy a returning user)', async () => {
    const cryptoDb = await openDb();
    await putLocalAccount(cryptoDb, ACCOUNT);
    const cd = await openClientDataDb();
    await cd.providers.add(dummyProvider('p1'));

    await wipeClientDataForFreshOnboarding(cryptoDb);

    expect(await (await openClientDataDb()).providers.get('p1')).toBeDefined();
  });
});
