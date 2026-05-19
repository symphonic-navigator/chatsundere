// SPDX-License-Identifier: LGPL-3.0-only
import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { ready as opaqueReady, server as opaqueServer } from '@serenity-kit/opaque';
import { getLinkedAccount } from '../../src/db/linked-account.js';
import { getLocalAccount, putLocalAccount } from '../../src/db/local-account.js';
import { openLocalDb } from '../../src/db/open.js';
import { CryptoError } from '../../src/errors.js';
import { createLocalAccount } from '../../src/flows/create-local-account.js';
import { linkToServer } from '../../src/flows/link-to-server.js';
import {
  loginLocalWithPassphrase,
  loginLocalWithRecoveryKey,
} from '../../src/flows/login-local.js';
import { deleteServerAccount } from '../../src/flows/server-account-delete.js';
import type { ServerClient } from '../../src/server-client.js';
import { asMasterKey } from '../../src/types.js';

const DB = 'chatsundere-test-lifecycle';

beforeAll(async () => {
  await opaqueReady;
});

beforeEach(async () => {
  await new Promise<void>((r) => {
    const req = globalThis.indexedDB.deleteDatabase(DB);
    req.onsuccess = () => r();
    req.onerror = () => r();
    req.onblocked = () => r();
  });
});

describe('full lifecycle', () => {
  it('create → login → link → delete-server → re-link to other operator', async () => {
    const db = await openLocalDb(DB);

    // 1. Create local account.
    const { session, recoveryKeyString } = await createLocalAccount({
      db,
      username: 'alice',
      passphrase: 'first-pw',
    });
    expect(session.username).toBe('alice');
    session.close();

    // 2. Log in with passphrase.
    const login2 = await loginLocalWithPassphrase({ db, passphrase: 'first-pw' });
    expect(login2.session.username).toBe('alice');
    login2.session.close();

    // 3. Log in with recovery key.
    const login3 = await loginLocalWithRecoveryKey({ db, recoveryKeyString });
    expect(login3.session.username).toBe('alice');
    login3.session.close();

    // 4. Link to operator A.
    const setupA = opaqueServer.createSetup();
    const fakeA: ServerClient = makeFakeServer(setupA, 'srv-A-uuid');
    const fakeMk = asMasterKey(Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 1)));
    await linkToServer({
      db,
      serverClient: fakeA,
      invitationToken: 'inv-A',
      baseUrl: 'https://operator-a.example.com/api',
      issuerLabel: 'A',
      passphrase: 'first-pw',
      mk: fakeMk,
    });
    expect((await getLinkedAccount(db))?.server_user_id).toBe('srv-A-uuid');

    // 5. Self-delete from operator A.
    await deleteServerAccount({ db, serverClient: fakeA, accessToken: 'tok' });
    expect(await getLinkedAccount(db)).toBeNull();
    expect(await getLocalAccount(db)).not.toBeNull();

    // 6. Re-link to operator B with the same local account and same MK.
    const setupB = opaqueServer.createSetup();
    const fakeB: ServerClient = makeFakeServer(setupB, 'srv-B-uuid');
    await linkToServer({
      db,
      serverClient: fakeB,
      invitationToken: 'inv-B',
      baseUrl: 'https://operator-b.example.com/api',
      issuerLabel: 'B',
      passphrase: 'first-pw',
      mk: fakeMk,
    });
    expect((await getLinkedAccount(db))?.server_user_id).toBe('srv-B-uuid');

    db.close();
  });

  it("rejects a login when an IndexedDB row's integrity HMAC is tampered with", async () => {
    const db = await openLocalDb(DB);

    // 1. Create a local account.
    const { session } = await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });
    session.close();

    // 2. Read the raw local_account row.
    const row = await getLocalAccount(db);
    if (!row) throw new Error('row must exist after createLocalAccount');

    // 3. Flip one bit in the integrity HMAC to simulate an IndexedDB tamper.
    const tampered = new Uint8Array(row.wrapped_mk_local_integrity);
    if (tampered.length === 0) throw new Error('integrity HMAC must not be empty');
    tampered[0] = (tampered[0] as number) ^ 0x01;
    row.wrapped_mk_local_integrity = tampered;

    // 4. Write the corrupted row back.
    await putLocalAccount(db, row);

    // 5. Attempt login — must fail with integrity_check_failed.
    const loginErr = await loginLocalWithPassphrase({ db, passphrase: 'pw' }).catch(
      (e: unknown) => e,
    );
    expect(loginErr).toBeInstanceOf(CryptoError);
    expect((loginErr as CryptoError).code).toBe('integrity_check_failed');

    db.close();
  });
});

function makeFakeServer(serverSetup: string, userId: string): ServerClient {
  return {
    async linkOpaqueStart(req, _baseUrl) {
      const { registrationResponse } = opaqueServer.createRegistrationResponse({
        serverSetup,
        userIdentifier: 'alice',
        registrationRequest: req.registration_request,
      });
      return { session_id: 'sess', registration_response: registrationResponse };
    },
    async linkOpaqueFinish(_req, _baseUrl) {
      return { user_id: userId, role: 'user', access_token: 'tok', expires_in: 900 };
    },
    async linkPasskeyStart(_req, _baseUrl, _token) {
      throw new Error('not in test');
    },
    async linkPasskeyFinish(_req, _baseUrl, _token) {
      throw new Error('not in test');
    },
    async loginOpaqueStart(_req, _baseUrl) {
      throw new Error('not in test');
    },
    async loginOpaqueFinish(_req, _baseUrl) {
      throw new Error('not in test');
    },
    async recoveryStart(_req, _baseUrl) {
      throw new Error('not in test');
    },
    async recoveryFinish(_req, _baseUrl) {
      throw new Error('not in test');
    },
    async deleteMe(_baseUrl, _accessToken) {
      /* no-op */
    },
    async passphraseChangeStart(_req, _baseUrl, _accessToken) {
      throw new Error('not in test');
    },
    async passphraseChangeFinish(_req, _baseUrl, _accessToken) {
      throw new Error('not in test');
    },
  };
}
