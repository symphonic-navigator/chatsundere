// SPDX-License-Identifier: LGPL-3.0-only
import { beforeEach, describe, expect, it } from 'bun:test';
import { opaqueServerIdentity } from '@chatsundere/shared-types';
import { ready as opaqueReady, server as opaqueServer } from '@serenity-kit/opaque';
import { putLinkedAccount } from '../../src/db/linked-account.js';
import { openLocalDb } from '../../src/db/open.js';
import { createLocalAccount } from '../../src/flows/create-local-account.js';
import { loginLocalWithPassphrase } from '../../src/flows/login-local.js';
import { loginOnlineLinked } from '../../src/flows/login-online-linked.js';
import { opaqueRegistrationFinish, opaqueRegistrationStart } from '../../src/opaque/client.js';
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

function makeServerClient(behaviour: 'ok' | '401' | '500' | '429'): ServerClient {
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
      throw new Error('unexpected');
    },
    async loginOpaqueStart() {
      if (behaviour === '401') {
        throw Object.assign(new Error('Unauthorised'), { status: 401 });
      }
      if (behaviour === '500') {
        throw Object.assign(new Error('Internal Server Error'), { status: 500 });
      }
      if (behaviour === '429') {
        throw Object.assign(new Error('Too Many Requests'), {
          status: 429,
          code: 'rate_limited',
          retryAfterSeconds: 42,
        });
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

  it('classifies a 429 response as rate_limited, not unreachable', async () => {
    const db = await openLocalDb(DB);
    await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });
    await putLinkedAccount(db, LINKED_ROW);

    const result = await loginOnlineLinked({
      db,
      serverClient: makeServerClient('429'),
      passphrase: 'pw',
    });

    expect(result.serverOutcome.kind).toBe('rate_limited');
    // The server answered (429), so it was reachable — the honest signal is
    // "throttled", never "unreachable".
    if (result.serverOutcome.kind === 'rate_limited') {
      expect(result.serverOutcome.retryAfterSeconds).toBe(42);
    }
    expect(result.serverReachable).toBe(true);
    expect(result.serverAuthOk).toBe(false);
    // No access token was issued, so the session still degrades to offline linked.
    expect(result.session.mode).toBe('linked');
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

describe('loginOnlineLinked — successful double-auth login', () => {
  const USERNAME = 'alice';
  const PASSPHRASE = 'first-pw';
  const IDENTITY_CONTEXT = 'client-data-identity';

  /**
   * Build a fake ServerClient that runs a real OPAQUE login round-trip against a
   * registration record produced ahead of time, so the happy path returns a
   * genuine `ok` outcome. Regression cover for the shared-buffer defect where
   * closing the temporary local session zeroed the master key handed to the new
   * online session (an all-zero MK made the boot identity check wipe local data).
   */
  async function makeOkServer(): Promise<ServerClient> {
    const serverSetup = opaqueServer.createSetup();
    const serverId = opaqueServerIdentity(LINKED_ROW.base_url);
    const userIdentifier = LINKED_ROW.server_user_id;

    // Register the OPAQUE credential the login will authenticate against, binding
    // the same identifiers the client uses at login (client = username, server =
    // origin-derived identity).
    const { clientRegistrationState, registrationRequest } =
      await opaqueRegistrationStart(PASSPHRASE);
    const { registrationResponse } = opaqueServer.createRegistrationResponse({
      serverSetup,
      userIdentifier,
      registrationRequest,
    });
    const { registrationRecord } = await opaqueRegistrationFinish({
      clientRegistrationState,
      registrationResponse,
      passphrase: PASSPHRASE,
      username: USERNAME,
      serverIdentity: serverId,
    });
    const registrationRecordB64 = Buffer.from(registrationRecord).toString('base64url');

    let serverLoginState: string | null = null;

    return {
      ...makeServerClient('ok'),
      async loginOpaqueStart(req, _baseUrl) {
        const started = opaqueServer.startLogin({
          serverSetup,
          registrationRecord: registrationRecordB64,
          startLoginRequest: req.start_login_request,
          userIdentifier,
          identifiers: { client: USERNAME, server: serverId },
        });
        serverLoginState = started.serverLoginState;
        return {
          session_id: 'login-sess',
          login_response: started.loginResponse,
          // Unused by the client (it keeps the locally-unwrapped MK) but non-null
          // per the wire type.
          wrapped_mk_opaque: 'AA',
          wrap_nonce_opaque: 'AA',
          wrap_aad_opaque: 'AA',
        };
      },
      async loginOpaqueFinish(req, _baseUrl) {
        if (!serverLoginState) throw new Error('loginOpaqueStart was not called first');
        // Throws if the KE3 MAC does not verify — proves the client authenticated.
        opaqueServer.finishLogin({
          serverLoginState,
          finishLoginRequest: req.finish_login_request,
        });
        return {
          user_id: LINKED_ROW.server_user_id,
          role: 'user',
          access_token: 'access-token',
          expires_in: 900,
        };
      },
    };
  }

  it('opens a linked+online session whose master key survives closing the local session', async () => {
    await opaqueReady;

    // Reference DEK derived from a plain local login — the value the boot identity
    // check compares against. Copy the bytes out before closing (the session and
    // its returned mk share one buffer).
    const refDb = await openLocalDb(DB);
    await createLocalAccount({ db: refDb, username: USERNAME, passphrase: PASSPHRASE });
    const refLogin = await loginLocalWithPassphrase({ db: refDb, passphrase: PASSPHRASE });
    const referenceDek = Uint8Array.from(await refLogin.session.deriveDek(IDENTITY_CONTEXT));
    refLogin.session.close();
    refDb.close();

    const db = await openLocalDb(DB);
    await putLinkedAccount(db, LINKED_ROW);

    const result = await loginOnlineLinked({
      db,
      serverClient: await makeOkServer(),
      passphrase: PASSPHRASE,
    });

    expect(result.serverOutcome.kind).toBe('ok');
    expect(result.session.mode).toBe('linked');
    expect(result.session.online).toBe(true);

    // The defect zeroed the shared buffer, so the returned key would be all-zero.
    expect(result.mk.some((b) => b !== 0)).toBe(true);

    // The online session must derive the SAME DEK as a local login — otherwise the
    // boot identity check treats the store as foreign and wipes local data.
    const onlineDek = Uint8Array.from(await result.session.deriveDek(IDENTITY_CONTEXT));
    expect(Buffer.from(onlineDek).equals(Buffer.from(referenceDek))).toBe(true);

    result.session.close();
    db.close();
  });
});
