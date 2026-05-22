// SPDX-License-Identifier: LGPL-3.0-only
import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { ready as opaqueReady, server as opaqueServer } from '@serenity-kit/opaque';
import { getLinkedAccount } from '../../src/db/linked-account.js';
import { openLocalDb } from '../../src/db/open.js';
import { createLocalAccount } from '../../src/flows/create-local-account.js';
import { linkToServer } from '../../src/flows/link-to-server.js';
import type { ServerClient } from '../../src/server-client.js';
import { asMasterKey } from '../../src/types.js';

const DB = 'chatsundere-test-link';

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

describe('linkToServer', () => {
  it('completes the OPAQUE link and writes a linked_account row', async () => {
    const db = await openLocalDb(DB);
    const { session } = await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });

    const serverSetup = opaqueServer.createSetup();

    const fakeServer: ServerClient = {
      async joinStart(req, _baseUrl) {
        if (req.kind !== 'invitation') throw new Error('unexpected kind');
        const { registrationResponse } = opaqueServer.createRegistrationResponse({
          serverSetup,
          userIdentifier: 'alice',
          registrationRequest: req.registration_request,
        });
        return {
          kind: 'invitation',
          session_id: 'test-session',
          registration_response: registrationResponse,
          suggested_username: null,
        };
      },
      async joinFinish(_req, _baseUrl) {
        return {
          kind: 'invitation',
          user_id: 'srv-uuid',
          username: 'alice',
          role: 'user',
          access_token: 'jwt',
          expires_in: 900,
          is_new_account: true,
        };
      },
      async linkPasskeyStart() {
        throw new Error('not used');
      },
      async linkPasskeyFinish() {
        throw new Error('not used');
      },
      async loginOpaqueStart() {
        throw new Error('not used');
      },
      async loginOpaqueFinish() {
        throw new Error('not used');
      },
      async recoveryStart() {
        throw new Error('not used');
      },
      async recoveryFinish() {
        throw new Error('not used');
      },
      async deleteMe() {
        throw new Error('not used');
      },
      async passphraseChangeStart() {
        throw new Error('not used');
      },
      async passphraseChangeFinish() {
        throw new Error('not used');
      },
    };

    const fakeMk = asMasterKey(Uint8Array.from(Array.from({ length: 32 }, (_, i) => i)));
    await linkToServer({
      db,
      serverClient: fakeServer,
      invitationToken: 'inv-token',
      baseUrl: 'https://example.com/api',
      issuerLabel: 'test',
      passphrase: 'pw',
      mk: fakeMk,
    });

    const linked = await getLinkedAccount(db);
    expect(linked?.server_user_id).toBe('srv-uuid');
    expect(linked?.role).toBe('user');
    expect(linked?.base_url).toBe('https://example.com/api');
    expect(linked?.issuer_label).toBe('test');
    expect(linked?.wrapped_mk_opaque_ciphertext).toBeInstanceOf(Uint8Array);
    expect(linked?.wrapped_mk_opaque_integrity).toBeInstanceOf(Uint8Array);

    session.close();
    db.close();
  });
});
