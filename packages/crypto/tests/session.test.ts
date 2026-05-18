// SPDX-License-Identifier: LGPL-3.0-only
import { beforeEach, describe, expect, it } from 'bun:test';
import { openLocalDb } from '../src/db/open.js';
import { listPasskeyCredentials } from '../src/db/passkey-credentials.js';
import { CryptoError } from '../src/errors.js';
import { createLocalAccount } from '../src/flows/create-local-account.js';
import { createMasterKeySession } from '../src/session.js';
import { asMasterKey } from '../src/types.js';

const MK = asMasterKey(Uint8Array.from(Array.from({ length: 32 }, (_, i) => i)));

describe('MasterKeySession', () => {
  it('exposes mode, userId, username, online', () => {
    const session = createMasterKeySession({
      mk: MK,
      userId: 'local-uuid',
      username: 'alice',
      mode: 'local',
      online: false,
    });
    expect(session.mode).toBe('local');
    expect(session.username).toBe('alice');
    expect(session.online).toBe(false);
  });

  it('derives a DEK and encrypts/decrypts under it', async () => {
    const session = createMasterKeySession({
      mk: MK,
      userId: 'u',
      username: 'alice',
      mode: 'local',
      online: false,
    });
    const { ciphertext, nonce } = await session.encrypt(
      new TextEncoder().encode('secret'),
      'vault/test',
    );
    const decrypted = await session.decrypt({ ciphertext, nonce, context: 'vault/test' });
    expect(new TextDecoder().decode(decrypted)).toBe('secret');
  });

  it('close() zeros the MK buffer (best-effort)', () => {
    const mkCopy = new Uint8Array(MK);
    const session = createMasterKeySession({
      mk: asMasterKey(mkCopy),
      userId: 'u',
      username: 'alice',
      mode: 'local',
      online: false,
    });
    session.close();
    expect(mkCopy.every((b) => b === 0)).toBe(true);
  });
});

describe('MasterKeySession.registerLocalBiometric', () => {
  const DB = 'chatsundere-test-session-biometric';

  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      const req = globalThis.indexedDB.deleteDatabase(DB);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });

  it('persists a passkey credential row using the in-session MK without a raw mk argument', async () => {
    const db = await openLocalDb(DB);
    const { session } = await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });
    await session.registerLocalBiometric({
      db,
      credentialId: Uint8Array.from([1, 2, 3, 4]),
      publicKey: Uint8Array.from([0xa0, 0xa1]),
      aaguid: null,
      prfOutput: Uint8Array.from(Array.from({ length: 32 }, (_, i) => 0x40 + i)),
      label: 'session-test device',
    });
    const list = await listPasskeyCredentials(db);
    expect(list.length).toBe(1);
    expect(list[0]?.label).toBe('session-test device');
    expect(list[0]?.is_synced_with_server).toBe(false);
    expect(list[0]?.wrapped_mk_prf_ciphertext.length).toBeGreaterThan(0);
    expect(list[0]?.wrapped_mk_prf_integrity.length).toBeGreaterThan(0);
    session.close();
    db.close();
  });

  it('rejects a PRF output that is not 32 bytes', async () => {
    const db = await openLocalDb(DB);
    const { session } = await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });
    await expect(
      session.registerLocalBiometric({
        db,
        credentialId: Uint8Array.from([1, 2, 3]),
        publicKey: Uint8Array.from([0xa0]),
        aaguid: null,
        prfOutput: new Uint8Array(16),
        label: 'too-short prf',
      }),
    ).rejects.toBeInstanceOf(CryptoError);
    const list = await listPasskeyCredentials(db);
    expect(list.length).toBe(0);
    session.close();
    db.close();
  });

  it('throws expired_state after session.close()', async () => {
    const db = await openLocalDb(DB);
    const { session } = await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });
    session.close();
    await expect(
      session.registerLocalBiometric({
        db,
        credentialId: Uint8Array.from([1, 2, 3, 4]),
        publicKey: Uint8Array.from([0xa0]),
        aaguid: null,
        prfOutput: new Uint8Array(32).fill(0x7f),
        label: 'after-close',
      }),
    ).rejects.toMatchObject({ code: 'expired_state' });
    db.close();
  });

  it('persists the AAGUID when one is provided', async () => {
    const db = await openLocalDb(DB);
    const { session } = await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });
    await session.registerLocalBiometric({
      db,
      credentialId: Uint8Array.from([9, 9, 9, 9]),
      publicKey: Uint8Array.from([0x04]),
      aaguid: 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd',
      prfOutput: new Uint8Array(32).fill(0x55),
      label: 'platform passkey',
    });
    const list = await listPasskeyCredentials(db);
    expect(list[0]?.aaguid).toBe('fbfc3007-154e-4ecc-8c0b-6e020557d7bd');
    session.close();
    db.close();
  });
});
