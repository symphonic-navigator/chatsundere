// SPDX-License-Identifier: LGPL-3.0-only
import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { opaqueServerIdentity } from '@chatsundere/shared-types';
import { ready as opaqueReady, server as opaqueServer } from '@serenity-kit/opaque';
import { getLinkedAccount, putLinkedAccount } from '../../src/db/linked-account.js';
import { openLocalDb } from '../../src/db/open.js';
import type { LinkedAccountRow } from '../../src/db/schema.js';
import { changeUsername } from '../../src/flows/change-username.js';
import { createLocalAccount } from '../../src/flows/create-local-account.js';
import { loginOnlineLinked } from '../../src/flows/login-online-linked.js';
import { stepUpWithPassphrase } from '../../src/flows/step-up.js';
import { opaqueRegistrationFinish, opaqueRegistrationStart } from '../../src/opaque/client.js';
import type { ServerClient } from '../../src/server-client.js';

const DB = 'chatsundere-test-change-username-opaque';
const BASE_URL = 'https://example.com/api';
const SERVER_ID = opaqueServerIdentity(BASE_URL);
const PASSPHRASE = 'correct horse battery staple';

function baseLinkedRow(overrides: Partial<LinkedAccountRow> = {}): LinkedAccountRow {
  return {
    server_user_id: 'srv-uuid-1',
    base_url: BASE_URL,
    issuer_label: null,
    role: 'user',
    wrapped_mk_opaque_ciphertext: new Uint8Array(48),
    wrapped_mk_opaque_nonce: new Uint8Array(12),
    wrapped_mk_opaque_aad: new Uint8Array(0),
    wrapped_mk_opaque_integrity: new Uint8Array(32),
    linked_at: new Date(),
    ...overrides,
  };
}

function httpError(status: number, code: string): Error {
  return Object.assign(new Error(code), { status, code });
}

/** ServerClient stub whose members are configurable; unconfigured ones throw. */
function rejectingServerClient(overrides: Partial<ServerClient>): ServerClient {
  const reject = () => {
    throw new Error('unexpected server call');
  };
  return {
    joinStart: reject,
    joinFinish: reject,
    linkPasskeyStart: reject,
    linkPasskeyFinish: reject,
    loginOpaqueStart: reject,
    loginOpaqueFinish: reject,
    recoveryStart: reject,
    recoveryFinish: reject,
    updateRecovery: reject,
    deleteMe: reject,
    patchMe: async () => {},
    passphraseChangeStart: reject,
    passphraseChangeFinish: reject,
    stepUpStart: reject,
    stepUpFinish: reject,
    ...overrides,
  } as ServerClient;
}

/**
 * Registers a real OPAQUE credential under `registeredIdentifier` (mirroring
 * what `linkToServer` freezes into `auth_methods.opaque_client_identifier`
 * server-side), and returns a `ServerClient` whose `loginOpaqueStart`/`Finish`
 * and `stepUpStart`/`Finish` mimic the real auth-service: `identifiers.client`
 * is always bound to the FROZEN `registeredIdentifier`, never to whatever
 * live username the client happens to send along.
 */
async function makeFrozenIdentifierServer(
  registeredIdentifier: string,
  userId: string,
): Promise<ServerClient> {
  const serverSetup = opaqueServer.createSetup();
  const { clientRegistrationState, registrationRequest } =
    await opaqueRegistrationStart(PASSPHRASE);
  const { registrationResponse } = opaqueServer.createRegistrationResponse({
    serverSetup,
    userIdentifier: userId,
    registrationRequest,
  });
  const { registrationRecord } = await opaqueRegistrationFinish({
    clientRegistrationState,
    registrationResponse,
    passphrase: PASSPHRASE,
    username: registeredIdentifier,
    serverIdentity: SERVER_ID,
  });
  const registrationRecordB64 = Buffer.from(registrationRecord).toString('base64url');

  let loginState: string | null = null;
  let stepUpState: string | null = null;

  return rejectingServerClient({
    async loginOpaqueStart(req, _baseUrl) {
      const started = opaqueServer.startLogin({
        serverSetup,
        registrationRecord: registrationRecordB64,
        startLoginRequest: req.start_login_request,
        userIdentifier: userId,
        identifiers: { client: registeredIdentifier, server: SERVER_ID },
      });
      loginState = started.serverLoginState;
      return {
        session_id: 'login-sess',
        login_response: started.loginResponse,
        // Unused by the client (it keeps the locally-unwrapped MK) but
        // non-null per the wire type.
        wrapped_mk_opaque: 'AA',
        wrap_nonce_opaque: 'AA',
        wrap_aad_opaque: 'AA',
      };
    },
    async loginOpaqueFinish(req, _baseUrl) {
      if (!loginState) throw new Error('loginOpaqueStart was not called first');
      const finished = opaqueServer.finishLogin({
        serverLoginState: loginState,
        finishLoginRequest: req.finish_login_request,
      });
      if (!finished) throw httpError(401, 'opaque_evidence_invalid');
      return {
        user_id: userId,
        role: 'user' as const,
        access_token: 'access-token',
        expires_in: 900,
      };
    },
    async stepUpStart(req, _baseUrl, _accessToken) {
      if (req.mechanism !== 'opaque' || !req.login_request) {
        throw new Error('expected opaque start');
      }
      const started = opaqueServer.startLogin({
        serverSetup,
        registrationRecord: registrationRecordB64,
        startLoginRequest: req.login_request,
        userIdentifier: userId,
        identifiers: { client: registeredIdentifier, server: SERVER_ID },
      });
      stepUpState = started.serverLoginState;
      return {
        session_id: 'step-up-sess',
        mechanism: 'opaque' as const,
        login_response: started.loginResponse,
      };
    },
    async stepUpFinish(req, _baseUrl) {
      if (req.mechanism !== 'opaque' || !req.login_evidence || !stepUpState) {
        throw new Error('expected opaque finish with evidence');
      }
      const finished = opaqueServer.finishLogin({
        serverLoginState: stepUpState,
        finishLoginRequest: req.login_evidence,
      });
      if (!finished) throw httpError(401, 'opaque_authentication_failed');
      return { tier_confirmed: 't1' as const, expires_at: '2026-07-02T00:00:00.000Z' };
    },
  });
}

let db: IDBDatabase;

beforeAll(async () => {
  await opaqueReady;
});

beforeEach(async () => {
  if (db) db.close();
  await new Promise<void>((r) => {
    const req = globalThis.indexedDB.deleteDatabase(DB);
    req.onsuccess = () => r();
    req.onerror = () => r();
    req.onblocked = () => r();
  });
});

describe('OPAQUE client identifier survives a username change', () => {
  it('login-online-linked succeeds under the frozen identifier after a rename', async () => {
    db = await openLocalDb(DB);
    await createLocalAccount({ db, username: 'alice', passphrase: PASSPHRASE });
    const serverClient = await makeFrozenIdentifierServer('alice', 'srv-uuid-1');
    // What linkToServer would have written: the OPAQUE registration-time
    // username frozen alongside the wraps.
    await putLinkedAccount(db, baseLinkedRow({ opaque_client_identifier: 'alice' }));

    // Rename after link. local_account.username changes; the frozen OPAQUE
    // identifier on linked_account must not.
    await changeUsername({ db, newUsername: 'alice-renamed' });

    const result = await loginOnlineLinked({ db, serverClient, passphrase: PASSPHRASE });

    expect(result.serverOutcome.kind).toBe('ok');
    expect(result.session.online).toBe(true);
    result.session.close();
  });

  it('step-up succeeds under the frozen identifier after a rename', async () => {
    db = await openLocalDb(DB);
    await createLocalAccount({ db, username: 'alice', passphrase: PASSPHRASE });
    const serverClient = await makeFrozenIdentifierServer('alice', 'srv-uuid-1');
    await putLinkedAccount(db, baseLinkedRow({ opaque_client_identifier: 'alice' }));

    await changeUsername({ db, newUsername: 'alice-renamed' });

    const outcome = await stepUpWithPassphrase({
      db,
      serverClient,
      accessToken: 'tok',
      tier: 't1',
      passphrase: PASSPHRASE,
    });

    expect(outcome).toBe('confirmed');
  });

  it('changeUsername never touches the frozen opaque_client_identifier', async () => {
    db = await openLocalDb(DB);
    await createLocalAccount({ db, username: 'alice', passphrase: PASSPHRASE });
    await putLinkedAccount(db, baseLinkedRow({ opaque_client_identifier: 'alice' }));

    await changeUsername({ db, newUsername: 'alice-renamed' });

    const linked = await getLinkedAccount(db);
    expect(linked?.opaque_client_identifier).toBe('alice');
  });
});

describe('legacy linked_account rows self-heal the frozen identifier', () => {
  it('login-online-linked stamps opaque_client_identifier on first success when absent', async () => {
    db = await openLocalDb(DB);
    await createLocalAccount({ db, username: 'bob', passphrase: PASSPHRASE });
    const serverClient = await makeFrozenIdentifierServer('bob', 'srv-uuid-2');
    // Legacy row: linked before this field existed. No rename has happened
    // yet, so the live username still matches the registration-time identity.
    await putLinkedAccount(db, baseLinkedRow({ server_user_id: 'srv-uuid-2' }));

    const before = await getLinkedAccount(db);
    expect(before?.opaque_client_identifier).toBeUndefined();

    const result = await loginOnlineLinked({ db, serverClient, passphrase: PASSPHRASE });
    expect(result.serverOutcome.kind).toBe('ok');
    result.session.close();

    const after = await getLinkedAccount(db);
    expect(after?.opaque_client_identifier).toBe('bob');
  });

  it('step-up stamps opaque_client_identifier on first success when absent', async () => {
    db = await openLocalDb(DB);
    await createLocalAccount({ db, username: 'bob', passphrase: PASSPHRASE });
    const serverClient = await makeFrozenIdentifierServer('bob', 'srv-uuid-2');
    await putLinkedAccount(db, baseLinkedRow({ server_user_id: 'srv-uuid-2' }));

    const outcome = await stepUpWithPassphrase({
      db,
      serverClient,
      accessToken: 'tok',
      tier: 't1',
      passphrase: PASSPHRASE,
    });
    expect(outcome).toBe('confirmed');

    const after = await getLinkedAccount(db);
    expect(after?.opaque_client_identifier).toBe('bob');
  });
});
