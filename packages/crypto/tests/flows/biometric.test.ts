// SPDX-License-Identifier: LGPL-3.0-only
import { beforeEach, describe, expect, it } from 'bun:test';
import { openLocalDb } from '../../src/db/open.js';
import { listPasskeyCredentials } from '../../src/db/passkey-credentials.js';
import { CryptoError } from '../../src/errors.js';
import { createLocalAccount } from '../../src/flows/create-local-account.js';
import { completeLocalBiometricRegistration } from '../../src/flows/setup-biometric.js';
import { asMasterKey } from '../../src/types.js';

const DB = 'chatsundere-test-biometric';

beforeEach(async () => {
  await new Promise<void>((r) => {
    const req = globalThis.indexedDB.deleteDatabase(DB);
    req.onsuccess = () => r();
    req.onerror = () => r();
    req.onblocked = () => r();
  });
});

describe('completeLocalBiometricRegistration', () => {
  it('persists a credential row that wraps the MK', async () => {
    const db = await openLocalDb(DB);
    const { session } = await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });
    const fakeMk = asMasterKey(Uint8Array.from(Array.from({ length: 32 }, (_, i) => i)));
    await completeLocalBiometricRegistration({
      db,
      session,
      mk: fakeMk,
      credentialId: Uint8Array.from([1, 2, 3, 4]),
      publicKey: Uint8Array.from([0xa0, 0xa1]),
      aaguid: null,
      prfOutput: Uint8Array.from(Array.from({ length: 32 }, (_, i) => 0x40 + i)),
      label: 'test device',
    });
    const list = await listPasskeyCredentials(db);
    expect(list.length).toBe(1);
    expect(list[0]?.label).toBe('test device');
    session.close();
    db.close();
  });

  it('rejects a PRF output that is not 32 bytes', async () => {
    const db = await openLocalDb(DB);
    const { session } = await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });
    const fakeMk = asMasterKey(new Uint8Array(32).fill(0xab));
    await expect(
      completeLocalBiometricRegistration({
        db,
        session,
        mk: fakeMk,
        credentialId: Uint8Array.from([1, 2, 3]),
        publicKey: Uint8Array.from([0xa0]),
        aaguid: null,
        prfOutput: new Uint8Array(16), // wrong length
        label: 'bad device',
      }),
    ).rejects.toBeInstanceOf(CryptoError);
    session.close();
    db.close();
  });

  it('stores is_synced_with_server as false', async () => {
    const db = await openLocalDb(DB);
    const { session } = await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });
    const fakeMk = asMasterKey(new Uint8Array(32).fill(0x11));
    await completeLocalBiometricRegistration({
      db,
      session,
      mk: fakeMk,
      credentialId: Uint8Array.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00, 0x11]),
      publicKey: Uint8Array.from([0x04]),
      aaguid: '00000000-0000-0000-0000-000000000000',
      prfOutput: new Uint8Array(32).fill(0x7f),
      label: 'platform key',
    });
    const list = await listPasskeyCredentials(db);
    expect(list[0]?.is_synced_with_server).toBe(false);
    expect(list[0]?.aaguid).toBe('00000000-0000-0000-0000-000000000000');
    session.close();
    db.close();
  });
});
