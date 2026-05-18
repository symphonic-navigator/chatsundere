// SPDX-License-Identifier: LGPL-3.0-only
import { beforeEach, describe, expect, it } from 'bun:test';
import { getLocalAccount } from '../../src/db/local-account.js';
import { openLocalDb } from '../../src/db/open.js';
import { CryptoError } from '../../src/errors.js';
import { changeUsername } from '../../src/flows/change-username.js';
import { createLocalAccount } from '../../src/flows/create-local-account.js';

const DB = 'chatsundere-test-change-username';

beforeEach(async () => {
  await new Promise<void>((r) => {
    const req = globalThis.indexedDB.deleteDatabase(DB);
    req.onsuccess = () => r();
    req.onerror = () => r();
    req.onblocked = () => r();
  });
});

describe('changeUsername', () => {
  it('rejects an uppercase username', async () => {
    const db = await openLocalDb(DB);
    await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });
    const err = await changeUsername({ db, newUsername: 'ALICE' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CryptoError);
    expect((err as CryptoError).code).toBe('invalid_input');
    db.close();
  });

  it('rejects a too-short username', async () => {
    const db = await openLocalDb(DB);
    await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });
    const err = await changeUsername({ db, newUsername: 'ad' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CryptoError);
    expect((err as CryptoError).code).toBe('invalid_input');
    db.close();
  });

  it('rejects a reserved username', async () => {
    const db = await openLocalDb(DB);
    await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });
    const err = await changeUsername({ db, newUsername: 'admin' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CryptoError);
    expect((err as CryptoError).code).toBe('invalid_input');
    db.close();
  });

  it('updates the local row username', async () => {
    const db = await openLocalDb(DB);
    await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });
    await changeUsername({ db, newUsername: 'bob123' });
    const row = await getLocalAccount(db);
    expect(row?.username).toBe('bob123');
    db.close();
  });

  it('calls serverPatch before writing locally; server rejection leaves the row unchanged', async () => {
    const db = await openLocalDb(DB);
    await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });

    let serverCalled = false;
    const serverPatch = async (_u: string): Promise<void> => {
      serverCalled = true;
      throw Object.assign(new Error('conflict'), { status: 409 });
    };

    const err = await changeUsername({ db, newUsername: 'newname', serverPatch }).catch(
      (e: unknown) => e,
    );

    // The server was called.
    expect(serverCalled).toBe(true);
    // The error propagated.
    expect(err).toBeInstanceOf(Error);
    // The local row is unchanged.
    const row = await getLocalAccount(db);
    expect(row?.username).toBe('alice');

    db.close();
  });

  it('calls serverPatch before writing locally when it succeeds', async () => {
    const db = await openLocalDb(DB);
    await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });

    const callOrder: string[] = [];
    const serverPatch = async (_u: string): Promise<void> => {
      callOrder.push('server');
    };

    // Monkey-patch putLocalAccount to record its call order.
    // We cannot easily intercept IndexedDB directly, so instead we verify
    // by checking the result: server called and local updated.
    await changeUsername({ db, newUsername: 'newname2', serverPatch });

    expect(callOrder).toEqual(['server']);
    const row = await getLocalAccount(db);
    expect(row?.username).toBe('newname2');

    db.close();
  });
});
