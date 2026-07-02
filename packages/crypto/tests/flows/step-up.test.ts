// SPDX-License-Identifier: LGPL-3.0-only
import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import {
  client as opaqueClient,
  ready as opaqueReady,
  server as opaqueServer,
} from '@serenity-kit/opaque';
import { deleteLinkedAccount, putLinkedAccount } from '../../src/db/linked-account.js';
import { openLocalDb } from '../../src/db/open.js';
import { createLocalAccount } from '../../src/flows/create-local-account.js';
import { stepUpWithPasskey, stepUpWithPassphrase } from '../../src/flows/step-up.js';
import type { ServerClient } from '../../src/server-client.js';

const DB = 'chatsundere-test-step-up';
const USERNAME = 'casey';

// Reuse the LINKED_ROW fixture shape from login-online-linked.test.ts verbatim.
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

const SERVER_ID = `${LINKED_ROW.base_url}/auth/v1`;

function httpError(status: number, code: string): Error {
  return Object.assign(new Error(code), { status, code });
}

/** Structurally-valid AuthenticationResponseJSON for tests that never verify it. */
const FAKE_ASSERTION = {
  id: 'Y3JlZC1pZA',
  rawId: 'Y3JlZC1pZA',
  type: 'public-key' as const,
  response: {
    clientDataJSON: 'e30',
    authenticatorData: 'AAAA',
    signature: 'AAAA',
  },
  clientExtensionResults: {},
};

/** ServerClient stub whose step-up members are configurable; all others throw. */
function makeServerClient(overrides: Partial<ServerClient>): ServerClient {
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
    deleteMe: reject,
    passphraseChangeStart: reject,
    passphraseChangeFinish: reject,
    stepUpStart: reject,
    stepUpFinish: reject,
    ...overrides,
  } as ServerClient;
}

/**
 * Registers an OPAQUE record for the given passphrase against the step-up
 * client identifiers (client: username, server: `${base_url}/auth/v1`) and
 * returns the server setup plus the registration record needed to answer
 * `startLogin` server-side.
 */
async function registerOpaqueUser(
  passphrase: string,
): Promise<{ serverSetup: string; registrationRecord: string }> {
  const serverSetup = opaqueServer.createSetup();
  const { clientRegistrationState, registrationRequest } = opaqueClient.startRegistration({
    password: passphrase,
  });
  const { registrationResponse } = opaqueServer.createRegistrationResponse({
    serverSetup,
    userIdentifier: USERNAME,
    registrationRequest,
  });
  const { registrationRecord } = opaqueClient.finishRegistration({
    password: passphrase,
    registrationResponse,
    clientRegistrationState,
    identifiers: { client: USERNAME, server: SERVER_ID },
  });
  return { serverSetup, registrationRecord };
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
  db = await openLocalDb(DB);
  await createLocalAccount({ db, username: USERNAME, passphrase: 'a-long-passphrase' });
  await putLinkedAccount(db, LINKED_ROW);
});

describe('stepUpWithPasskey', () => {
  it("returns 'no_passkey' when start rejects with the no_passkey code", async () => {
    const sc = makeServerClient({
      stepUpStart: async () => {
        throw httpError(400, 'no_passkey');
      },
    });
    const outcome = await stepUpWithPasskey({
      db,
      serverClient: sc,
      accessToken: 'tok',
      tier: 't1',
      getAssertion: async () => {
        throw new Error('must not be called');
      },
    });
    expect(outcome).toBe('no_passkey');
  });

  it("returns 'uv_required' when finish rejects with webauthn_uv_required", async () => {
    const sc = makeServerClient({
      stepUpStart: async () => ({
        session_id: 'round-1',
        mechanism: 'webauthn' as const,
        options: { challenge: 'Y2hhbGxlbmdl', rpId: 'example.com' },
      }),
      stepUpFinish: async () => {
        throw httpError(401, 'webauthn_uv_required');
      },
    });
    const outcome = await stepUpWithPasskey({
      db,
      serverClient: sc,
      accessToken: 'tok',
      tier: 't1',
      getAssertion: async () => FAKE_ASSERTION,
    });
    expect(outcome).toBe('uv_required');
  });

  it("returns 'confirmed' when finish succeeds", async () => {
    let finishCalled = false;
    const sc = makeServerClient({
      stepUpStart: async () => ({
        session_id: 'round-1',
        mechanism: 'webauthn' as const,
        options: { challenge: 'Y2hhbGxlbmdl', rpId: 'example.com' },
      }),
      stepUpFinish: async () => {
        finishCalled = true;
        return { tier_confirmed: 't1' as const, expires_at: '2026-07-02T00:00:00.000Z' };
      },
    });
    const outcome = await stepUpWithPasskey({
      db,
      serverClient: sc,
      accessToken: 'tok',
      tier: 't1',
      getAssertion: async () => FAKE_ASSERTION,
    });
    expect(outcome).toBe('confirmed');
    expect(finishCalled).toBe(true);
  });

  it("returns 'failed' when the assertion callback throws (user abort)", async () => {
    let finishCalled = false;
    const sc = makeServerClient({
      stepUpStart: async () => ({
        session_id: 'round-1',
        mechanism: 'webauthn' as const,
        options: { challenge: 'Y2hhbGxlbmdl', rpId: 'example.com' },
      }),
      stepUpFinish: async () => {
        finishCalled = true;
        return { tier_confirmed: 't1' as const, expires_at: '2026-07-02T00:00:00.000Z' };
      },
    });
    const outcome = await stepUpWithPasskey({
      db,
      serverClient: sc,
      accessToken: 'tok',
      tier: 't1',
      getAssertion: async () => {
        throw new DOMException('user aborted', 'NotAllowedError');
      },
    });
    expect(outcome).toBe('failed');
    expect(finishCalled).toBe(false);
  });
});

describe('stepUpWithPassphrase', () => {
  it("returns 'wrong_passphrase' on opaque_authentication_failed from finish", async () => {
    const passphrase = 'correct horse battery staple';
    const { serverSetup, registrationRecord } = await registerOpaqueUser(passphrase);
    let serverLoginState: string | null = null;
    const sc = makeServerClient({
      stepUpStart: async (req) => {
        if (req.mechanism !== 'opaque' || !req.login_request) {
          throw new Error('expected opaque start');
        }
        const { serverLoginState: state, loginResponse } = opaqueServer.startLogin({
          serverSetup,
          userIdentifier: USERNAME,
          startLoginRequest: req.login_request,
          registrationRecord,
          identifiers: { client: USERNAME, server: SERVER_ID },
        });
        serverLoginState = state;
        return {
          session_id: 'round-1',
          mechanism: 'opaque' as const,
          login_response: loginResponse,
        };
      },
      stepUpFinish: async () => {
        throw httpError(401, 'opaque_authentication_failed');
      },
    });
    const outcome = await stepUpWithPassphrase({
      db,
      serverClient: sc,
      accessToken: 'tok',
      tier: 't1',
      passphrase,
    });
    expect(serverLoginState).not.toBeNull();
    expect(outcome).toBe('wrong_passphrase');
  });

  it("returns 'wrong_passphrase' when the client-side OPAQUE round rejects the KE2 (CryptoError wrong_passphrase)", async () => {
    // Server registered a record for a DIFFERENT passphrase than the one the
    // client supplies — the client-side finishLogin rejects the KE2.
    const { serverSetup, registrationRecord } = await registerOpaqueUser('the-real-passphrase');
    const sc = makeServerClient({
      stepUpStart: async (req) => {
        if (req.mechanism !== 'opaque' || !req.login_request) {
          throw new Error('expected opaque start');
        }
        const { loginResponse } = opaqueServer.startLogin({
          serverSetup,
          userIdentifier: USERNAME,
          startLoginRequest: req.login_request,
          registrationRecord,
          identifiers: { client: USERNAME, server: SERVER_ID },
        });
        return {
          session_id: 'round-1',
          mechanism: 'opaque' as const,
          login_response: loginResponse,
        };
      },
      stepUpFinish: async () => {
        throw new Error('stepUpFinish must not be called on a client-side rejection');
      },
    });
    const outcome = await stepUpWithPassphrase({
      db,
      serverClient: sc,
      accessToken: 'tok',
      tier: 't1',
      passphrase: 'a-different-passphrase',
    });
    expect(outcome).toBe('wrong_passphrase');
  });

  it("returns 'confirmed' on a full successful round", async () => {
    const passphrase = 'correct horse battery staple';
    const { serverSetup, registrationRecord } = await registerOpaqueUser(passphrase);
    let serverLoginState: string | null = null;
    const sc = makeServerClient({
      stepUpStart: async (req) => {
        if (req.mechanism !== 'opaque' || !req.login_request) {
          throw new Error('expected opaque start');
        }
        const { serverLoginState: state, loginResponse } = opaqueServer.startLogin({
          serverSetup,
          userIdentifier: USERNAME,
          startLoginRequest: req.login_request,
          registrationRecord,
          identifiers: { client: USERNAME, server: SERVER_ID },
        });
        serverLoginState = state;
        return {
          session_id: 'round-1',
          mechanism: 'opaque' as const,
          login_response: loginResponse,
        };
      },
      stepUpFinish: async (req) => {
        if (req.mechanism !== 'opaque' || !req.login_evidence || !serverLoginState) {
          throw new Error('expected opaque finish with evidence');
        }
        const finished = opaqueServer.finishLogin({
          serverLoginState,
          finishLoginRequest: req.login_evidence,
        });
        if (!finished) throw httpError(401, 'opaque_authentication_failed');
        return { tier_confirmed: 't1' as const, expires_at: '2026-07-02T00:00:00.000Z' };
      },
    });
    const outcome = await stepUpWithPassphrase({
      db,
      serverClient: sc,
      accessToken: 'tok',
      tier: 't1',
      passphrase,
    });
    expect(outcome).toBe('confirmed');
  });

  it("returns 'failed' when no linked account exists", async () => {
    await deleteLinkedAccount(db);
    const sc = makeServerClient({
      stepUpStart: async () => {
        throw new Error('stepUpStart must not be called without a linked account');
      },
    });
    const outcome = await stepUpWithPassphrase({
      db,
      serverClient: sc,
      accessToken: 'tok',
      tier: 't1',
      passphrase: 'anything',
    });
    expect(outcome).toBe('failed');
  });
});
