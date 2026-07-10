// SPDX-License-Identifier: LGPL-3.0-only
import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { opaqueServerIdentity } from '@chatsundere/shared-types';
import {
  client as opaqueClient,
  ready as opaqueReady,
  server as opaqueServer,
} from '@serenity-kit/opaque';
import { deriveOpaqueAmk } from '../../src/amk.js';
import { getLinkedAccount } from '../../src/db/linked-account.js';
import { getLocalAccount } from '../../src/db/local-account.js';
import { openLocalDb } from '../../src/db/open.js';
import { fromBase64Url, toBase64Url } from '../../src/encoding/base64url.js';
import { CryptoError } from '../../src/errors.js';
import { finishJoinByPairing, startJoinByPairing } from '../../src/flows/join-by-pairing.js';
import { makeLocalAccountAad } from '../../src/primitives/aad.js';
import { aeadEncrypt } from '../../src/primitives/aead.js';
import { addIntegrityHmac, deriveIntegrityKey } from '../../src/primitives/integrity.js';
import { getRandomBytes } from '../../src/primitives/random.js';
import type { ServerClient } from '../../src/server-client.js';
import { asMasterKey } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB = 'chatsundere-test-join-by-pairing';
const BASE_URL = 'https://example.com/api';
const CODE = 'QR9XZ-2KPNT';
const PASSPHRASE = 'correct horse battery staple';
const USERNAME = 'alice';
const SERVER_ID = opaqueServerIdentity(BASE_URL);

// ---------------------------------------------------------------------------
// OPAQUE server-side simulation helpers
// ---------------------------------------------------------------------------

/**
 * Registers a user on an in-memory OPAQUE server setup using the raw
 * `@serenity-kit/opaque` client API directly (simpler than going through the
 * crypto-package wrappers). Returns:
 *  - exportKey (base64url string, as returned by the library)
 *  - registrationRecord (base64url string, to pass to opaqueServer.startLogin)
 */
async function registerOpaqueUser(
  serverSetup: string,
  passphrase: string,
  username: string,
): Promise<{ exportKey: string; registrationRecord: string }> {
  const { clientRegistrationState, registrationRequest } = opaqueClient.startRegistration({
    password: passphrase,
  });

  const { registrationResponse } = opaqueServer.createRegistrationResponse({
    serverSetup,
    userIdentifier: username,
    registrationRequest,
  });

  const { registrationRecord, exportKey } = opaqueClient.finishRegistration({
    password: passphrase,
    registrationResponse,
    clientRegistrationState,
    identifiers: { client: username, server: SERVER_ID },
  });

  return { exportKey, registrationRecord };
}

/**
 * Builds a realistic wrapped-MK bundle using real crypto, as the server would
 * store it after registration. Returns base64url-encoded fields matching the
 * `JoinFinishResponse` pairing shape.
 *
 * `exportKeyB64` is the base64url export-key string from `@serenity-kit/opaque`
 * registration (the same key that the client will derive again during login).
 */
async function buildServerWrappedMk(
  exportKeyB64: string,
  mk: Uint8Array,
  username: string,
): Promise<{
  wrapped_mk_opaque: string;
  wrap_nonce_opaque: string;
  wrap_aad_opaque: string;
}> {
  const opaqueAmk = await deriveOpaqueAmk(fromBase64Url(exportKeyB64));
  const aad = makeLocalAccountAad(username, 'opaque');
  const wrapped = await aeadEncrypt(opaqueAmk, mk, aad);
  // No integrity HMAC on the server-side copy (client-side IDB invariant only).
  return {
    wrapped_mk_opaque: toBase64Url(wrapped.ciphertext),
    wrap_nonce_opaque: toBase64Url(wrapped.nonce),
    wrap_aad_opaque: toBase64Url(wrapped.aad),
  };
}

// ---------------------------------------------------------------------------
// Mock ServerClient factory
// ---------------------------------------------------------------------------

interface MockClientOpts {
  serverSetup: string;
  /**
   * The registration record (base64url) produced during OPAQUE registration.
   * Required by `opaqueServer.startLogin` to produce a valid KE2 message.
   */
  registrationRecord?: string;
  /** If set, joinFinish throws this error instead of returning a response. */
  rejectFinishWith?: Error;
  /** If set, joinStart returns the wrong kind to test kind-mismatch handling. */
  wrongStartKind?: boolean;
  /** If set, joinFinish returns the wrong kind to test kind-mismatch handling. */
  wrongFinishKind?: boolean;
  /** Precomputed wrapped MK fields; built lazily if not set. */
  wrappedMkFields?: {
    wrapped_mk_opaque: string;
    wrap_nonce_opaque: string;
    wrap_aad_opaque: string;
  };
  /**
   * The OPAQUE client identifier the registration record was actually sealed
   * under (used for `opaqueServer.startLogin`'s `userIdentifier`/
   * `identifiers.client`, and echoed back as the response's
   * `opaque_client_identifier`). Defaults to `USERNAME` so existing tests,
   * where the account has never been renamed, see no divergence.
   */
  opaqueClientIdentifier?: string;
  /**
   * The live display username returned as `username` in both the start and
   * finish responses. Defaults to `USERNAME`. Set this different from
   * `opaqueClientIdentifier` to simulate pairing to a renamed account.
   */
  liveUsername?: string;
  /** If set, the `/join/start` pairing response omits `opaque_client_identifier` entirely, simulating a pre-fix server. */
  omitOpaqueClientIdentifier?: boolean;
}

function makeServerClient(opts: MockClientOpts): ServerClient {
  // Stateful login session (KE2 must be computed against KE1 for mutual auth).
  let loginSession: string | null = null;

  return {
    async joinStart(req, _baseUrl) {
      if (opts.wrongStartKind) {
        // Return invitation shape to trigger kind-mismatch in startJoinByPairing.
        return {
          kind: 'invitation',
          session_id: 'bad-kind-session',
          registration_response: 'ignored',
          suggested_username: null,
        };
      }
      if (req.kind !== 'pairing') throw new Error('expected pairing kind');

      const clientIdentifier = opts.opaqueClientIdentifier ?? USERNAME;
      const { serverLoginState, loginResponse } = opaqueServer.startLogin({
        serverSetup: opts.serverSetup,
        userIdentifier: clientIdentifier,
        startLoginRequest: req.login_request,
        registrationRecord: opts.registrationRecord ?? '',
        identifiers: { client: clientIdentifier, server: SERVER_ID },
      });
      loginSession = serverLoginState;

      return {
        kind: 'pairing',
        session_id: 'test-pairing-session-456',
        login_response: loginResponse,
        username: opts.liveUsername ?? USERNAME,
        ...(opts.omitOpaqueClientIdentifier ? {} : { opaque_client_identifier: clientIdentifier }),
      };
    },

    async joinFinish(req, _baseUrl) {
      if (opts.rejectFinishWith) throw opts.rejectFinishWith;
      if (opts.wrongFinishKind) {
        // Return invitation shape to trigger kind-mismatch in finishJoinByPairing.
        return {
          kind: 'invitation',
          user_id: 'ignored',
          username: opts.liveUsername ?? USERNAME,
          role: 'user',
          access_token: 'ignored',
          expires_in: 900,
          is_new_account: true,
        };
      }
      if (req.kind !== 'pairing') throw new Error('expected pairing kind');
      if (!loginSession) throw new Error('no login session — joinStart not called');

      // Validate KE3 on the server side (finishLogin returns null on failure).
      const finishResult = opaqueServer.finishLogin({
        serverLoginState: loginSession,
        finishLoginRequest: req.login_evidence,
      });
      if (!finishResult) {
        throw Object.assign(new Error('OPAQUE evidence invalid'), {
          status: 401,
          code: 'opaque_evidence_invalid',
        });
      }

      return {
        kind: 'pairing',
        user_id: 'srv-uuid-xyz',
        username: opts.liveUsername ?? USERNAME,
        role: 'user',
        access_token: 'access-jwt-pairing',
        expires_in: 900,
        is_new_account: false,
        ...(opts.wrappedMkFields ?? {
          wrapped_mk_opaque: toBase64Url(new Uint8Array(48)),
          wrap_nonce_opaque: toBase64Url(new Uint8Array(12)),
          wrap_aad_opaque: toBase64Url(new Uint8Array(0)),
        }),
      };
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
    async patchMe() {},
    async updateRecovery() {},
    async deleteMe() {
      throw new Error('not used');
    },
    async passphraseChangeStart() {
      throw new Error('not used');
    },
    async passphraseChangeFinish() {
      throw new Error('not used');
    },
    async linkPasskeyStart() {
      throw new Error('not used');
    },
    async linkPasskeyFinish() {
      throw new Error('not used');
    },
    async stepUpStart() {
      throw new Error('not used');
    },
    async stepUpFinish() {
      throw new Error('not used');
    },
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// startJoinByPairing
// ---------------------------------------------------------------------------

describe('startJoinByPairing', () => {
  it('returns the username from the server response', async () => {
    const serverSetup = opaqueServer.createSetup();
    const { registrationRecord } = await registerOpaqueUser(serverSetup, PASSPHRASE, USERNAME);
    const client = makeServerClient({ serverSetup, registrationRecord });

    const state = await startJoinByPairing({
      serverClient: client,
      baseUrl: BASE_URL,
      code: CODE,
      passphrase: PASSPHRASE,
    });

    expect(state.username).toBe(USERNAME);
    expect(state.opaqueClientIdentifier).toBe(USERNAME);
    expect(state.sessionId).toBe('test-pairing-session-456');
    expect(typeof state.loginResponse).toBe('string');
    expect(state.loginResponse.length).toBeGreaterThan(0);
    expect(state.clientLoginState).toBeTruthy();
  });

  it('throws CryptoError("opaque_protocol_error") when server returns wrong kind', async () => {
    const serverSetup = opaqueServer.createSetup();
    // No registrationRecord needed — wrong kind is returned before OPAQUE login.
    const client = makeServerClient({ serverSetup, wrongStartKind: true });

    await expect(
      startJoinByPairing({
        serverClient: client,
        baseUrl: BASE_URL,
        code: CODE,
        passphrase: PASSPHRASE,
      }),
    ).rejects.toMatchObject({ code: 'opaque_protocol_error' });
  });

  it('falls back to username when the server omits opaque_client_identifier (legacy server)', async () => {
    const serverSetup = opaqueServer.createSetup();
    const { registrationRecord } = await registerOpaqueUser(serverSetup, PASSPHRASE, USERNAME);
    const client = makeServerClient({
      serverSetup,
      registrationRecord,
      omitOpaqueClientIdentifier: true,
    });

    const state = await startJoinByPairing({
      serverClient: client,
      baseUrl: BASE_URL,
      code: CODE,
      passphrase: PASSPHRASE,
    });

    expect(state.opaqueClientIdentifier).toBe(USERNAME);
  });
});

// ---------------------------------------------------------------------------
// finishJoinByPairing
// ---------------------------------------------------------------------------

describe('finishJoinByPairing', () => {
  it('happy path: unwraps MK, persists both rows, returns correct session', async () => {
    const db = await openLocalDb(DB);
    const serverSetup = opaqueServer.createSetup();

    // Register user on the server side so the OPAQUE login round is valid.
    const { exportKey, registrationRecord } = await registerOpaqueUser(
      serverSetup,
      PASSPHRASE,
      USERNAME,
    );

    // Build realistic wrapped MK material using the known export-key.
    const originalMk = getRandomBytes(32);
    const wrappedMkFields = await buildServerWrappedMk(exportKey, originalMk, USERNAME);

    const client = makeServerClient({ serverSetup, registrationRecord, wrappedMkFields });

    const joinState = await startJoinByPairing({
      serverClient: client,
      baseUrl: BASE_URL,
      code: CODE,
      passphrase: PASSPHRASE,
    });

    const result = await finishJoinByPairing({
      db,
      serverClient: client,
      baseUrl: BASE_URL,
      joinState,
      passphrase: PASSPHRASE,
      issuerLabel: 'My Chatsundere',
    });

    // The recovered MK must match the original. MasterKey is a branded
    // Uint8Array; compare raw bytes to dodge the brand mismatch.
    expect(result.mk).toBeInstanceOf(Uint8Array);
    expect(result.mk.length).toBe(32);
    expect(new Uint8Array(result.mk)).toEqual(new Uint8Array(originalMk));

    // Session shape.
    expect(result.session.mode).toBe('linked');
    expect(result.session.online).toBe(true);
    expect(result.session.userId).toBe('srv-uuid-xyz');
    expect(result.session.username).toBe(USERNAME);
    expect(result.session.accessToken).toBe('access-jwt-pairing');
    expect(result.session.role).toBe('user');

    // local_account row written.
    const localRow = await getLocalAccount(db);
    expect(localRow).not.toBeNull();
    expect(localRow?.username).toBe(USERNAME);
    expect(localRow?.wrapped_mk_local_ciphertext).toBeInstanceOf(Uint8Array);
    expect(localRow?.wrapped_mk_local_integrity).toBeInstanceOf(Uint8Array);
    expect(localRow?.wrapped_mk_local_aad).toEqual(
      new TextEncoder().encode(`${USERNAME}::local::v1`),
    );

    // linked_account row written with issuer label.
    const linkedRow = await getLinkedAccount(db);
    expect(linkedRow).not.toBeNull();
    expect(linkedRow?.server_user_id).toBe('srv-uuid-xyz');
    expect(linkedRow?.base_url).toBe(BASE_URL);
    expect(linkedRow?.role).toBe('user');
    expect(linkedRow?.issuer_label).toBe('My Chatsundere');
    expect(linkedRow?.wrapped_mk_opaque_ciphertext).toBeInstanceOf(Uint8Array);
    expect(linkedRow?.wrapped_mk_opaque_integrity).toBeInstanceOf(Uint8Array);

    result.session.close();
    db.close();
  });

  it('succeeds pairing to a RENAMED account using the server-returned frozen identifier, not the live username', async () => {
    const db = await openLocalDb(DB);
    const serverSetup = opaqueServer.createSetup();
    const FROZEN_ID = 'alice'; // the identifier the OPAQUE record was registered under
    const LIVE_USERNAME = 'alice-renamed'; // the current display username after a rename

    // Registration happened under the frozen identifier — a username change
    // afterwards never touches the OPAQUE record (Finding #3, Task C1).
    const { exportKey, registrationRecord } = await registerOpaqueUser(
      serverSetup,
      PASSPHRASE,
      FROZEN_ID,
    );

    const originalMk = getRandomBytes(32);
    const wrappedMkFields = await buildServerWrappedMk(exportKey, originalMk, FROZEN_ID);

    const client = makeServerClient({
      serverSetup,
      registrationRecord,
      wrappedMkFields,
      opaqueClientIdentifier: FROZEN_ID,
      liveUsername: LIVE_USERNAME,
    });

    const joinState = await startJoinByPairing({
      serverClient: client,
      baseUrl: BASE_URL,
      code: CODE,
      passphrase: PASSPHRASE,
    });

    expect(joinState.username).toBe(LIVE_USERNAME);
    expect(joinState.opaqueClientIdentifier).toBe(FROZEN_ID);

    // RED (pre-fix): finishJoinByPairing presented `joinState.username`
    // (LIVE_USERNAME) as the OPAQUE client identity, which mismatches what
    // the server bound the KE2/KE3 evidence to (FROZEN_ID) — finishLogin
    // fails mutual authentication and the round throws opaque_protocol_error.
    const result = await finishJoinByPairing({
      db,
      serverClient: client,
      baseUrl: BASE_URL,
      joinState,
      passphrase: PASSPHRASE,
    });

    expect(new Uint8Array(result.mk)).toEqual(new Uint8Array(originalMk));

    // Device B's local account keeps the LIVE display username...
    const localRow = await getLocalAccount(db);
    expect(localRow?.username).toBe(LIVE_USERNAME);

    // ...but the linked_account row must stamp the FROZEN identifier, so
    // this device's future logins/step-ups keep presenting the value the
    // server actually expects.
    const linkedRow = await getLinkedAccount(db);
    expect(linkedRow?.opaque_client_identifier).toBe(FROZEN_ID);

    result.session.close();
    db.close();
  });

  it('happy path without issuerLabel persists null in linked_account', async () => {
    const db = await openLocalDb(DB);
    const serverSetup = opaqueServer.createSetup();
    const { exportKey, registrationRecord } = await registerOpaqueUser(
      serverSetup,
      PASSPHRASE,
      USERNAME,
    );
    const originalMk = getRandomBytes(32);
    const wrappedMkFields = await buildServerWrappedMk(exportKey, originalMk, USERNAME);
    const client = makeServerClient({ serverSetup, registrationRecord, wrappedMkFields });

    const joinState = await startJoinByPairing({
      serverClient: client,
      baseUrl: BASE_URL,
      code: CODE,
      passphrase: PASSPHRASE,
    });

    const result = await finishJoinByPairing({
      db,
      serverClient: client,
      baseUrl: BASE_URL,
      joinState,
      passphrase: PASSPHRASE,
    });

    const linkedRow = await getLinkedAccount(db);
    expect(linkedRow?.issuer_label).toBeNull();

    result.session.close();
    db.close();
  });

  it('throws CryptoError("opaque_protocol_error") when server returns wrong kind at finish', async () => {
    const db = await openLocalDb(DB);
    const serverSetup = opaqueServer.createSetup();
    const { registrationRecord } = await registerOpaqueUser(serverSetup, PASSPHRASE, USERNAME);
    const client = makeServerClient({ serverSetup, registrationRecord, wrongFinishKind: true });

    const joinState = await startJoinByPairing({
      serverClient: client,
      baseUrl: BASE_URL,
      code: CODE,
      passphrase: PASSPHRASE,
    });

    await expect(
      finishJoinByPairing({
        db,
        serverClient: client,
        baseUrl: BASE_URL,
        joinState,
        passphrase: PASSPHRASE,
      }),
    ).rejects.toMatchObject({ code: 'opaque_protocol_error' });

    db.close();
  });

  it('throws CryptoError("opaque_protocol_error") on 401 opaque_evidence_invalid', async () => {
    const db = await openLocalDb(DB);
    const serverSetup = opaqueServer.createSetup();
    const { registrationRecord } = await registerOpaqueUser(serverSetup, PASSPHRASE, USERNAME);

    const evidenceError = Object.assign(new Error('OPAQUE evidence invalid'), {
      status: 401,
      code: 'opaque_evidence_invalid',
    });
    const client = makeServerClient({
      serverSetup,
      registrationRecord,
      rejectFinishWith: evidenceError,
    });

    const joinState = await startJoinByPairing({
      serverClient: client,
      baseUrl: BASE_URL,
      code: CODE,
      passphrase: PASSPHRASE,
    });

    await expect(
      finishJoinByPairing({
        db,
        serverClient: client,
        baseUrl: BASE_URL,
        joinState,
        passphrase: PASSPHRASE,
      }),
    ).rejects.toMatchObject({ code: 'opaque_protocol_error' });

    db.close();
  });

  it('throws CryptoError("conflict") when a local_account already exists', async () => {
    const db = await openLocalDb(DB);
    const serverSetup = opaqueServer.createSetup();
    const { registrationRecord } = await registerOpaqueUser(serverSetup, PASSPHRASE, USERNAME);

    // Pre-populate a local account to simulate a non-fresh PWA.
    const { createLocalAccount } = await import('../../src/flows/create-local-account.js');
    await createLocalAccount({ db, username: USERNAME, passphrase: PASSPHRASE });

    const client = makeServerClient({ serverSetup, registrationRecord });

    const joinState = await startJoinByPairing({
      serverClient: client,
      baseUrl: BASE_URL,
      code: CODE,
      passphrase: PASSPHRASE,
    });

    await expect(
      finishJoinByPairing({
        db,
        serverClient: client,
        baseUrl: BASE_URL,
        joinState,
        passphrase: PASSPHRASE,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });

    db.close();
  });

  it('propagates non-evidence-invalid server errors unchanged', async () => {
    const db = await openLocalDb(DB);
    const serverSetup = opaqueServer.createSetup();
    const { registrationRecord } = await registerOpaqueUser(serverSetup, PASSPHRASE, USERNAME);

    const networkError = Object.assign(new Error('Network error'), { status: 503 });
    const client = makeServerClient({
      serverSetup,
      registrationRecord,
      rejectFinishWith: networkError,
    });

    const joinState = await startJoinByPairing({
      serverClient: client,
      baseUrl: BASE_URL,
      code: CODE,
      passphrase: PASSPHRASE,
    });

    await expect(
      finishJoinByPairing({
        db,
        serverClient: client,
        baseUrl: BASE_URL,
        joinState,
        passphrase: PASSPHRASE,
      }),
    ).rejects.toMatchObject({ message: 'Network error' });

    db.close();
  });
});
