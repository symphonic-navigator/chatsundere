// SPDX-License-Identifier: LGPL-3.0-only
import { beforeEach, describe, expect, it } from 'bun:test';
import { getLocalAccount } from '../../src/db/local-account.js';
import { openLocalDb } from '../../src/db/open.js';
import { decodeRecoveryKey } from '../../src/encoding/recovery-key.js';
import { CryptoError } from '../../src/errors.js';
import { createLocalAccount } from '../../src/flows/create-local-account.js';

const DB = 'chatsundere-test-create';

beforeEach(async () => {
  await new Promise<void>((r) => {
    const req = globalThis.indexedDB.deleteDatabase(DB);
    req.onsuccess = () => r();
    req.onerror = () => r();
    req.onblocked = () => r();
  });
});

describe('createLocalAccount', () => {
  it('creates the local row and returns a usable session + RK string', async () => {
    const db = await openLocalDb(DB);
    const { session, recoveryKeyString } = await createLocalAccount({
      db,
      username: 'alice',
      passphrase: 'correct horse battery staple',
    });
    expect(session.mode).toBe('local');
    expect(session.username).toBe('alice');
    const row = await getLocalAccount(db);
    expect(row).not.toBeNull();
    expect(row?.username).toBe('alice');
    expect(decodeRecoveryKey(recoveryKeyString).length).toBe(32);
    session.close();
    db.close();
  });

  it('rejects a duplicate account', async () => {
    const db = await openLocalDb(DB);
    // Create the first account with a valid username.
    await createLocalAccount({ db, username: 'alice', passphrase: 'passphrase-one' });
    // A second call must fail regardless of the new username — one account per origin.
    await expect(
      createLocalAccount({ db, username: 'bob', passphrase: 'passphrase-two' }),
    ).rejects.toBeInstanceOf(CryptoError);
    db.close();
  });

  it('rejects an invalid username (uppercase)', async () => {
    const db = await openLocalDb(DB);
    await expect(
      createLocalAccount({ db, username: 'ADMIN', passphrase: 'passphrase' }),
    ).rejects.toBeInstanceOf(CryptoError);
    db.close();
  });

  it('rejects a reserved username', async () => {
    const db = await openLocalDb(DB);
    await expect(
      createLocalAccount({ db, username: 'admin', passphrase: 'passphrase' }),
    ).rejects.toBeInstanceOf(CryptoError);
    db.close();
  });

  it('rejects a username that is too short', async () => {
    const db = await openLocalDb(DB);
    await expect(
      createLocalAccount({ db, username: 'ab', passphrase: 'passphrase' }),
    ).rejects.toBeInstanceOf(CryptoError);
    db.close();
  });

  it('persists wrapped_mk_local_aad that round-trips through login', async () => {
    // Verify the AAD stored in IndexedDB matches what create wrote so that
    // login can use bundle.aad directly without recomputing.
    const db = await openLocalDb(DB);
    await createLocalAccount({ db, username: 'carol', passphrase: 'hunter2' });
    const row = await getLocalAccount(db);
    const expectedAad = new TextEncoder().encode('carol::local::v1');
    expect(row?.wrapped_mk_local_aad).toEqual(expectedAad);
    db.close();
  });
});
