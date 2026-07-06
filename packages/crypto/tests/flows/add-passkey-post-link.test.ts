// SPDX-License-Identifier: LGPL-3.0-only
import { beforeEach, describe, expect, it } from 'bun:test';
import { putLinkedAccount } from '../../src/db/linked-account.js';
import { openLocalDb } from '../../src/db/open.js';
import { getPasskeyCredential, putPasskeyCredential } from '../../src/db/passkey-credentials.js';
import { CryptoError } from '../../src/errors.js';
import { addPasskeyPostLink } from '../../src/flows/add-passkey-post-link.js';
import type { ServerClient } from '../../src/server-client.js';
import { asMasterKey } from '../../src/types.js';

const DB = 'chatsundere-test-add-passkey-post-link';

const CREDENTIAL_ID = Uint8Array.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
const PUBLIC_KEY = Uint8Array.from([0x04, 0xab, 0xcd]);
const PRF_OUTPUT = new Uint8Array(32).fill(0x42);
const FAKE_MK = asMasterKey(new Uint8Array(32).fill(0x11));

/** A ServerClient that no-ops on linkPasskeyFinish and throws on everything else. */
function makeFakeClient(): ServerClient {
  return {
    async joinStart() {
      throw new Error('unexpected');
    },
    async joinFinish() {
      throw new Error('unexpected');
    },
    async linkPasskeyStart() {
      throw new Error('unexpected');
    },
    async linkPasskeyFinish() {
      return {
        user_id: 'srv-uuid-1',
        role: 'user' as const,
        access_token: 'tok',
        expires_in: 900,
        auth_method_id: 'method-1',
        method_type: 'passkey' as const,
      };
    },
    async loginOpaqueStart() {
      throw new Error('unexpected');
    },
    async loginOpaqueFinish() {
      throw new Error('unexpected');
    },
    async recoveryStart() {
      throw new Error('unexpected');
    },
    async recoveryFinish() {
      throw new Error('unexpected');
    },
    async patchMe() {},
    async updateRecovery() {},
    async deleteMe() {
      throw new Error('unexpected');
    },
    async passphraseChangeStart() {
      throw new Error('unexpected');
    },
    async passphraseChangeFinish() {
      throw new Error('unexpected');
    },
    async stepUpStart() {
      throw new Error('unexpected');
    },
    async stepUpFinish() {
      throw new Error('unexpected');
    },
  };
}

async function seedLinkedAccount(db: IDBDatabase): Promise<void> {
  await putLinkedAccount(db, {
    server_user_id: 'srv-uuid-1',
    base_url: 'https://example.com/api',
    issuer_label: null,
    role: 'user',
    wrapped_mk_opaque_ciphertext: new Uint8Array(48),
    wrapped_mk_opaque_nonce: new Uint8Array(12),
    wrapped_mk_opaque_aad: new Uint8Array(0),
    wrapped_mk_opaque_integrity: new Uint8Array(32),
    linked_at: new Date(),
  });
}

beforeEach(async () => {
  await new Promise<void>((r) => {
    const req = globalThis.indexedDB.deleteDatabase(DB);
    req.onsuccess = () => r();
    req.onerror = () => r();
    req.onblocked = () => r();
  });
});

describe('addPasskeyPostLink', () => {
  it('preserves sign_counter from an existing local credential row', async () => {
    const db = await openLocalDb(DB);
    await seedLinkedAccount(db);

    // Pre-seed a credential row as if setup-biometric already ran and the
    // authenticator has been used (counter = 5).
    await putPasskeyCredential(db, {
      credential_id: CREDENTIAL_ID,
      public_key: PUBLIC_KEY,
      sign_counter: 5,
      aaguid: 'aagu-id-from-biometric',
      label: 'old label',
      wrapped_mk_prf_ciphertext: new Uint8Array(48),
      wrapped_mk_prf_nonce: new Uint8Array(12),
      wrapped_mk_prf_aad: new Uint8Array(0),
      wrapped_mk_prf_integrity: new Uint8Array(32),
      is_synced_with_server: false,
      created_at: new Date('2024-01-01T00:00:00Z'),
    });

    await addPasskeyPostLink({
      db,
      serverClient: makeFakeClient(),
      accessToken: 'tok',
      mk: FAKE_MK,
      credentialJson: {} as never,
      credentialId: CREDENTIAL_ID,
      publicKey: PUBLIC_KEY,
      aaguid: null,
      prfOutput: PRF_OUTPUT,
      label: 'new label',
      sessionId: 'sess-1',
    });

    const after = await getPasskeyCredential(db, CREDENTIAL_ID);
    // sign_counter must not be reset to 0.
    expect(after?.sign_counter).toBe(5);
    // aaguid from the existing row must be preserved when the new call passes null.
    expect(after?.aaguid).toBe('aagu-id-from-biometric');
    // created_at must be the original date, not re-created.
    expect(after?.created_at.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    // is_synced_with_server must now be true.
    expect(after?.is_synced_with_server).toBe(true);

    db.close();
  });

  it('throws CryptoError("conflict") when called a second time for the same credential', async () => {
    const db = await openLocalDb(DB);
    await seedLinkedAccount(db);

    const args = {
      db,
      serverClient: makeFakeClient(),
      accessToken: 'tok',
      mk: FAKE_MK,
      credentialJson: {} as never,
      credentialId: CREDENTIAL_ID,
      publicKey: PUBLIC_KEY,
      aaguid: 'test-aaguid',
      prfOutput: PRF_OUTPUT,
      label: 'my key',
      sessionId: 'sess-2',
    };

    // First call: succeeds and marks is_synced_with_server = true.
    await addPasskeyPostLink(args);

    // Second call: must throw conflict because the credential is already synced.
    const err = await addPasskeyPostLink(args).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CryptoError);
    expect((err as CryptoError).code).toBe('conflict');

    db.close();
  });
});
