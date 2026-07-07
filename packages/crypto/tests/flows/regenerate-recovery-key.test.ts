// SPDX-License-Identifier: LGPL-3.0-only
import { beforeEach, describe, expect, it } from 'bun:test';
import { getLocalAccount } from '../../src/db/local-account.js';
import { openLocalDb } from '../../src/db/open.js';
import { createLocalAccount } from '../../src/flows/create-local-account.js';
import { loginLocalWithRecoveryKey } from '../../src/flows/login-local.js';
import { regenerateRecoveryKey } from '../../src/flows/regenerate-recovery-key.js';

const DB = 'chatsundere-test-regenerate-recovery-key';

beforeEach(async () => {
  await new Promise<void>((r) => {
    const req = globalThis.indexedDB.deleteDatabase(DB);
    req.onsuccess = () => r();
    req.onerror = () => r();
    req.onblocked = () => r();
  });
});

describe('regenerateRecoveryKey', () => {
  it('rotates the local wrap: the new key unlocks, the old one no longer does', async () => {
    const db = await openLocalDb(DB);
    const created = await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });

    const { recoveryKeyString } = await regenerateRecoveryKey({ db, mk: created.mk });
    expect(recoveryKeyString).not.toBe(created.recoveryKeyString);

    const unlocked = await loginLocalWithRecoveryKey({ db, recoveryKeyString });
    expect(unlocked.mk).toEqual(created.mk);
    unlocked.session.close();

    const err = await loginLocalWithRecoveryKey({
      db,
      recoveryKeyString: created.recoveryKeyString,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);

    db.close();
  });

  it('calls serverUpdate BEFORE the local write; a server rejection leaves the old key valid', async () => {
    const db = await openLocalDb(DB);
    const created = await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });
    const before = await getLocalAccount(db);

    let serverCalled = false;
    const err = await regenerateRecoveryKey({
      db,
      mk: created.mk,
      serverUpdate: async () => {
        serverCalled = true;
        throw new Error('server unreachable');
      },
    }).catch((e: unknown) => e);

    expect(serverCalled).toBe(true);
    expect(err).toBeInstanceOf(Error);

    // The local row is byte-identical: the OLD recovery key must still work.
    const after = await getLocalAccount(db);
    expect(after?.wrapped_mk_recovery_ciphertext).toEqual(before?.wrapped_mk_recovery_ciphertext);
    expect(after?.recovery_verifier_key).toEqual(before?.recovery_verifier_key);
    const unlocked = await loginLocalWithRecoveryKey({
      db,
      recoveryKeyString: created.recoveryKeyString,
    });
    expect(unlocked.mk).toEqual(created.mk);
    unlocked.session.close();

    db.close();
  });

  it('linked tail failure (server accepted, local write fails) still returns the key', async () => {
    const db = await openLocalDb(DB);
    const created = await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });

    // Close the connection inside serverUpdate: the server "accepted", then
    // the local putLocalAccount hits a closed database and fails. The flow
    // must NOT throw — the returned key is the only one deviceless recovery
    // now accepts, so swallowing it would strand the user.
    const result = await regenerateRecoveryKey({
      db,
      mk: created.mk,
      serverUpdate: async () => {
        db.close();
      },
    });
    expect(result.localWriteFailed).toBe(true);
    expect(result.recoveryKeyString).not.toBe(created.recoveryKeyString);

    // The local row is unchanged: the OLD key still opens this device.
    const db2 = await openLocalDb(DB);
    const unlocked = await loginLocalWithRecoveryKey({
      db: db2,
      recoveryKeyString: created.recoveryKeyString,
    });
    expect(unlocked.mk).toEqual(created.mk);
    unlocked.session.close();
    db2.close();
  });

  it('on success the material pushed to the server matches what is persisted locally', async () => {
    const db = await openLocalDb(DB);
    const created = await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });

    let pushed:
      | {
          new_recovery_verifier_key: Uint8Array;
          new_wrapped_mk_recovery_ciphertext: Uint8Array;
          new_wrapped_mk_recovery_nonce: Uint8Array;
          new_wrapped_mk_recovery_aad: Uint8Array;
        }
      | undefined;
    await regenerateRecoveryKey({
      db,
      mk: created.mk,
      serverUpdate: async (args) => {
        pushed = args;
      },
    });

    const row = await getLocalAccount(db);
    expect(pushed).toBeDefined();
    expect(pushed?.new_recovery_verifier_key).toEqual(row?.recovery_verifier_key ?? undefined);
    expect(pushed?.new_wrapped_mk_recovery_ciphertext).toEqual(
      row?.wrapped_mk_recovery_ciphertext ?? undefined,
    );
    expect(pushed?.new_wrapped_mk_recovery_nonce).toEqual(
      row?.wrapped_mk_recovery_nonce ?? undefined,
    );
    expect(pushed?.new_wrapped_mk_recovery_aad).toEqual(row?.wrapped_mk_recovery_aad ?? undefined);

    db.close();
  });
});
