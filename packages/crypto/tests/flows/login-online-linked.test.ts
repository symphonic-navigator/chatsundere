// SPDX-License-Identifier: LGPL-3.0-only
import { beforeEach, describe, expect, it } from 'bun:test';
import { putLinkedAccount } from '../../src/db/linked-account.js';
import { openLocalDb } from '../../src/db/open.js';
import { createLocalAccount } from '../../src/flows/create-local-account.js';
import { loginOnlineLinked } from '../../src/flows/login-online-linked.js';
import type { ServerClient } from '../../src/server-client.js';

const DB = 'chatsundere-test-login-online-linked';

const LINKED_ROW = {
  server_user_id: 'srv-uuid-1',
  base_url: 'https://example.com/api',
  issuer_label: null,
  role: 'user' as const,
  wrapped_mk_opaque_ciphertext: new Uint8Array(48),
  wrapped_mk_opaque_nonce: new Uint8Array(12),
  wrapped_mk_opaque_aad: new Uint8Array(0),
  wrapped_mk_opaque_integrity: new Uint8Array(32),
  linked_at: new Date(),
};

function makeServerClient(behaviour: 'ok' | '401' | '500'): ServerClient {
  return {
    async linkOpaqueStart() {
      throw new Error('unexpected');
    },
    async linkOpaqueFinish() {
      throw new Error('unexpected');
    },
    async linkPasskeyStart() {
      throw new Error('unexpected');
    },
    async linkPasskeyFinish() {
      throw new Error('unexpected');
    },
    async loginOpaqueStart() {
      if (behaviour === '401') {
        throw Object.assign(new Error('Unauthorised'), { status: 401 });
      }
      if (behaviour === '500') {
        throw Object.assign(new Error('Internal Server Error'), { status: 500 });
      }
      // For 'ok', this path is still reached and would need OPAQUE state.
      // We throw here to indicate the test should use a simpler path.
      throw new Error('use full OPAQUE mock for ok path');
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
    async deleteMe() {
      throw new Error('unexpected');
    },
    async passphraseChangeStart() {
      throw new Error('unexpected');
    },
    async passphraseChangeFinish() {
      throw new Error('unexpected');
    },
  };
}

beforeEach(async () => {
  await new Promise<void>((r) => {
    const req = globalThis.indexedDB.deleteDatabase(DB);
    req.onsuccess = () => r();
    req.onerror = () => r();
    req.onblocked = () => r();
  });
});

describe('loginOnlineLinked — ServerOutcome classification', () => {
  it('classifies a 401 response as auth_failed', async () => {
    const db = await openLocalDb(DB);
    await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });
    await putLinkedAccount(db, LINKED_ROW);

    const result = await loginOnlineLinked({
      db,
      serverClient: makeServerClient('401'),
      passphrase: 'pw',
    });

    expect(result.serverOutcome.kind).toBe('auth_failed');
    // Backward-compat fields.
    expect(result.serverReachable).toBe(false);
    expect(result.serverAuthOk).toBe(false);
    // Session degrades to offline linked.
    expect(result.session.mode).toBe('linked');
    expect(result.session.online).toBe(false);
    result.session.close();
    db.close();
  });

  it('classifies a 5xx / network error as unreachable', async () => {
    const db = await openLocalDb(DB);
    await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });
    await putLinkedAccount(db, LINKED_ROW);

    const result = await loginOnlineLinked({
      db,
      serverClient: makeServerClient('500'),
      passphrase: 'pw',
    });

    expect(result.serverOutcome.kind).toBe('unreachable');
    expect(result.serverReachable).toBe(false);
    expect(result.serverAuthOk).toBe(false);
    expect(result.session.online).toBe(false);
    result.session.close();
    db.close();
  });

  it('classifies the outcome as skipped when no linked account exists', async () => {
    const db = await openLocalDb(DB);
    await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });
    // No putLinkedAccount — local-only account.

    const result = await loginOnlineLinked({
      db,
      serverClient: makeServerClient('500'), // should never be called
      passphrase: 'pw',
    });

    expect(result.serverOutcome.kind).toBe('skipped');
    expect(result.session.mode).toBe('local');
    expect(result.session.online).toBe(false);
    result.session.close();
    db.close();
  });
});
