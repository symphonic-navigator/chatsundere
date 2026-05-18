// SPDX-License-Identifier: LGPL-3.0-only
import { beforeEach, describe, expect, it } from 'bun:test';
import { getLinkedAccount, putLinkedAccount } from '../../src/db/linked-account.js';
import { getLocalAccount } from '../../src/db/local-account.js';
import { openLocalDb } from '../../src/db/open.js';
import { createLocalAccount } from '../../src/flows/create-local-account.js';
import { deleteServerAccount } from '../../src/flows/server-account-delete.js';
import type { ServerClient } from '../../src/server-client.js';

const DB = 'chatsundere-test-delete';

beforeEach(async () => {
  await new Promise<void>((r) => {
    const req = globalThis.indexedDB.deleteDatabase(DB);
    req.onsuccess = () => r();
    req.onerror = () => r();
    req.onblocked = () => r();
  });
});

describe('deleteServerAccount', () => {
  it('removes linked_account locally but keeps local_account', async () => {
    const db = await openLocalDb(DB);
    await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });
    await putLinkedAccount(db, {
      server_user_id: 's-1',
      base_url: 'https://example.com/api',
      issuer_label: null,
      role: 'user',
      wrapped_mk_opaque_ciphertext: new Uint8Array(48),
      wrapped_mk_opaque_nonce: new Uint8Array(12),
      wrapped_mk_opaque_aad: new Uint8Array(0),
      wrapped_mk_opaque_integrity: new Uint8Array(32),
      linked_at: new Date(),
    });
    let deleteMeCalled = false;
    const fake: ServerClient = {
      async linkOpaqueStart() {
        throw new Error('nope');
      },
      async linkOpaqueFinish() {
        throw new Error('nope');
      },
      async linkPasskeyStart() {
        throw new Error('nope');
      },
      async linkPasskeyFinish() {
        throw new Error('nope');
      },
      async loginOpaqueStart() {
        throw new Error('nope');
      },
      async loginOpaqueFinish() {
        throw new Error('nope');
      },
      async recoveryStart() {
        throw new Error('nope');
      },
      async recoveryFinish() {
        throw new Error('nope');
      },
      async deleteMe() {
        deleteMeCalled = true;
      },
    };
    await deleteServerAccount({ db, serverClient: fake, accessToken: 'tok' });
    expect(deleteMeCalled).toBe(true);
    expect(await getLinkedAccount(db)).toBeNull();
    expect(await getLocalAccount(db)).not.toBeNull();
    db.close();
  });
});
