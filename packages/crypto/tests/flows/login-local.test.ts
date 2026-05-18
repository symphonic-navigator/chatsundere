// SPDX-License-Identifier: LGPL-3.0-only
import { beforeEach, describe, expect, it } from 'bun:test';
import { openLocalDb } from '../../src/db/open.js';
import { CryptoError } from '../../src/errors.js';
import { createLocalAccount } from '../../src/flows/create-local-account.js';
import {
  listLocalBiometric,
  loginLocalWithPassphrase,
  loginLocalWithRecoveryKey,
} from '../../src/flows/login-local.js';

const DB = 'chatsundere-test-login';

beforeEach(async () => {
  await new Promise<void>((r) => {
    const req = globalThis.indexedDB.deleteDatabase(DB);
    req.onsuccess = () => r();
    req.onerror = () => r();
    req.onblocked = () => r();
  });
});

describe('loginLocalWithPassphrase', () => {
  it('opens a session for the correct passphrase', async () => {
    const db = await openLocalDb(DB);
    await createLocalAccount({ db, username: 'alice', passphrase: 'pw1' });
    const { session } = await loginLocalWithPassphrase({ db, passphrase: 'pw1' });
    expect(session.username).toBe('alice');
    expect(session.mode).toBe('local');
    session.close();
    db.close();
  });

  it('throws CryptoError for the wrong passphrase', async () => {
    const db = await openLocalDb(DB);
    await createLocalAccount({ db, username: 'alice', passphrase: 'pw1' });
    await expect(loginLocalWithPassphrase({ db, passphrase: 'wrong-pw' })).rejects.toBeInstanceOf(
      CryptoError,
    );
    db.close();
  });

  it('session derived from login can encrypt and decrypt', async () => {
    const db = await openLocalDb(DB);
    await createLocalAccount({ db, username: 'alice', passphrase: 'vault-pw' });
    const { session } = await loginLocalWithPassphrase({ db, passphrase: 'vault-pw' });
    const plaintext = new TextEncoder().encode('super secret');
    const { ciphertext, nonce } = await session.encrypt(plaintext, 'test-context');
    const decrypted = await session.decrypt({ ciphertext, nonce, context: 'test-context' });
    expect(new TextDecoder().decode(decrypted)).toBe('super secret');
    session.close();
    db.close();
  });

  it('returns a 32-byte MK alongside the session', async () => {
    const db = await openLocalDb(DB);
    await createLocalAccount({ db, username: 'alice', passphrase: 'pw1' });
    const { session, mk } = await loginLocalWithPassphrase({ db, passphrase: 'pw1' });
    expect(mk.length).toBe(32);
    session.close();
    db.close();
  });
});

describe('loginLocalWithRecoveryKey', () => {
  it('opens a session with the printed recovery key', async () => {
    const db = await openLocalDb(DB);
    const { recoveryKeyString } = await createLocalAccount({
      db,
      username: 'alice',
      passphrase: 'pw',
    });
    const { session } = await loginLocalWithRecoveryKey({ db, recoveryKeyString });
    expect(session.username).toBe('alice');
    expect(session.mode).toBe('local');
    session.close();
    db.close();
  });

  it('throws CryptoError for a recovery key with a tampered checksum', async () => {
    const db = await openLocalDb(DB);
    const { recoveryKeyString } = await createLocalAccount({
      db,
      username: 'alice',
      passphrase: 'pw',
    });
    // Flip the last character to corrupt the checksum.
    const tampered = recoveryKeyString.slice(0, -1) + (recoveryKeyString.endsWith('A') ? 'B' : 'A');
    await expect(
      loginLocalWithRecoveryKey({ db, recoveryKeyString: tampered }),
    ).rejects.toBeInstanceOf(CryptoError);
    db.close();
  });

  it('throws CryptoError for a completely wrong recovery key', async () => {
    const db = await openLocalDb(DB);
    // Create account with one recovery key, then try a different valid-format key.
    const { recoveryKeyString: rk1 } = await createLocalAccount({
      db,
      username: 'alice',
      passphrase: 'pw',
    });
    // Generate a second account to get a different valid RK string, then delete
    // the DB row and re-insert so we have only one account but a foreign RK.
    // Simpler: encode a known-wrong 32-byte key and present it.
    // We can derive a wrong key from the known test vector.
    const wrongBytes = new Uint8Array(32).fill(0xff);
    // Build a valid-format string for wrongBytes: encode then present.
    // Use the encode helper indirectly via import.
    const { encodeRecoveryKey } = await import('../../src/encoding/recovery-key.js');
    const { asRecoveryKey } = await import('../../src/types.js');
    const wrongRkString = encodeRecoveryKey(asRecoveryKey(wrongBytes));
    // Sanity: wrongRkString must differ from the real one.
    expect(wrongRkString).not.toBe(rk1);
    await expect(
      loginLocalWithRecoveryKey({ db, recoveryKeyString: wrongRkString }),
    ).rejects.toBeInstanceOf(CryptoError);
    db.close();
  });

  it('returns a 32-byte MK alongside the session', async () => {
    const db = await openLocalDb(DB);
    const { recoveryKeyString } = await createLocalAccount({
      db,
      username: 'alice',
      passphrase: 'pw',
    });
    const { session, mk } = await loginLocalWithRecoveryKey({ db, recoveryKeyString });
    expect(mk.length).toBe(32);
    session.close();
    db.close();
  });
});

describe('listLocalBiometric', () => {
  it('returns an empty array when no biometric credentials are registered', async () => {
    const db = await openLocalDb(DB);
    await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });
    const creds = await listLocalBiometric(db);
    expect(creds).toEqual([]);
    db.close();
  });
});
