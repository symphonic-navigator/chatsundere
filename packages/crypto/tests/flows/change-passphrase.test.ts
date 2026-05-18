// SPDX-License-Identifier: LGPL-3.0-only
import { beforeEach, describe, expect, it } from 'bun:test';
import { openLocalDb } from '../../src/db/open.js';
import { getStaging, putStaging } from '../../src/db/staging.js';
import { CryptoError } from '../../src/errors.js';
import {
  changePassphraseLinkedOnline,
  changePassphraseLocalOnly,
  reconcileStagingOnBoot,
} from '../../src/flows/change-passphrase.js';
import { createLocalAccount } from '../../src/flows/create-local-account.js';
import { loginLocalWithPassphrase } from '../../src/flows/login-local.js';

const DB = 'chatsundere-test-changepw';

beforeEach(async () => {
  await new Promise<void>((r) => {
    const req = globalThis.indexedDB.deleteDatabase(DB);
    req.onsuccess = () => r();
    req.onerror = () => r();
    req.onblocked = () => r();
  });
});

describe('changePassphraseLocalOnly', () => {
  it('old passphrase fails and new passphrase opens a session afterwards', async () => {
    const db = await openLocalDb(DB);
    const { session } = await createLocalAccount({ db, username: 'alice', passphrase: 'old' });
    // Re-login to obtain the MK.
    const { session: loginSession, mk } = await loginLocalWithPassphrase({ db, passphrase: 'old' });
    loginSession.close();

    await changePassphraseLocalOnly({ db, session, mk, newPassphrase: 'new-passphrase' });
    session.close();

    // New passphrase must work.
    const { session: s2 } = await loginLocalWithPassphrase({ db, passphrase: 'new-passphrase' });
    expect(s2.username).toBe('alice');
    s2.close();

    // Old passphrase must fail.
    await expect(loginLocalWithPassphrase({ db, passphrase: 'old' })).rejects.toBeInstanceOf(
      CryptoError,
    );

    db.close();
  });

  it('clears the staging slot after completion', async () => {
    const db = await openLocalDb(DB);
    const { session } = await createLocalAccount({ db, username: 'alice', passphrase: 'old' });
    const { session: s, mk } = await loginLocalWithPassphrase({ db, passphrase: 'old' });
    s.close();
    await changePassphraseLocalOnly({ db, session, mk, newPassphrase: 'new2' });
    expect(await getStaging(db)).toBeNull();
    session.close();
    db.close();
  });

  it('throws if serverCommit is provided (wrong function)', async () => {
    const db = await openLocalDb(DB);
    const { session } = await createLocalAccount({ db, username: 'alice', passphrase: 'old' });
    const { session: s, mk } = await loginLocalWithPassphrase({ db, passphrase: 'old' });
    s.close();
    await expect(
      changePassphraseLocalOnly({
        db,
        session,
        mk,
        newPassphrase: 'new3',
        serverCommit: async () => {},
      }),
    ).rejects.toBeInstanceOf(CryptoError);
    session.close();
    db.close();
  });
});

describe('changePassphraseLinkedOnline', () => {
  it('rolls back and deletes staging when serverCommit throws', async () => {
    const db = await openLocalDb(DB);
    const { session } = await createLocalAccount({ db, username: 'alice', passphrase: 'old' });
    const { session: s, mk } = await loginLocalWithPassphrase({ db, passphrase: 'old' });
    s.close();
    const serverErr = new Error('server error');
    await expect(
      changePassphraseLinkedOnline({
        db,
        session,
        mk,
        newPassphrase: 'new',
        serverCommit: async () => {
          throw serverErr;
        },
      }),
    ).rejects.toBe(serverErr);
    // Staging must be gone after rollback.
    expect(await getStaging(db)).toBeNull();
    // Original passphrase still works after rollback.
    const { session: s3 } = await loginLocalWithPassphrase({ db, passphrase: 'old' });
    expect(s3.username).toBe('alice');
    s3.close();
    session.close();
    db.close();
  });

  it('throws if serverCommit is omitted', async () => {
    const db = await openLocalDb(DB);
    const { session } = await createLocalAccount({ db, username: 'alice', passphrase: 'old' });
    const { session: s, mk } = await loginLocalWithPassphrase({ db, passphrase: 'old' });
    s.close();
    await expect(
      changePassphraseLinkedOnline({ db, session, mk, newPassphrase: 'new' }),
    ).rejects.toBeInstanceOf(CryptoError);
    session.close();
    db.close();
  });
});

describe('reconcileStagingOnBoot', () => {
  it('clears a pending staging slot', async () => {
    const db = await openLocalDb(DB);
    // Plant a pending staging row to simulate a crash mid-change.
    await putStaging(db, {
      key: 'pending_passphrase_change',
      new_local_salt: new Uint8Array(16),
      new_wrapped_mk_local_ciphertext: new Uint8Array(48),
      new_wrapped_mk_local_nonce: new Uint8Array(12),
      new_wrapped_mk_local_aad: new TextEncoder().encode('a::local::v1'),
      new_wrapped_mk_local_integrity: new Uint8Array(32),
      server_state: 'pending',
      created_at: new Date(),
    });
    await reconcileStagingOnBoot(db);
    expect(await getStaging(db)).toBeNull();
    db.close();
  });

  it('clears a rolled_back staging slot', async () => {
    const db = await openLocalDb(DB);
    await putStaging(db, {
      key: 'pending_passphrase_change',
      new_local_salt: new Uint8Array(16),
      new_wrapped_mk_local_ciphertext: new Uint8Array(48),
      new_wrapped_mk_local_nonce: new Uint8Array(12),
      new_wrapped_mk_local_aad: new TextEncoder().encode('b::local::v1'),
      new_wrapped_mk_local_integrity: new Uint8Array(32),
      server_state: 'rolled_back',
      created_at: new Date(),
    });
    await reconcileStagingOnBoot(db);
    expect(await getStaging(db)).toBeNull();
    db.close();
  });

  it('is a no-op when no staging slot exists', async () => {
    const db = await openLocalDb(DB);
    await reconcileStagingOnBoot(db);
    expect(await getStaging(db)).toBeNull();
    db.close();
  });
});
