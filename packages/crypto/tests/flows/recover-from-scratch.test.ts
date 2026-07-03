// SPDX-License-Identifier: LGPL-3.0-only
import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { opaqueServerIdentity } from '@chatsundere/shared-types';
import {
  client as opaqueClient,
  ready as opaqueReady,
  server as opaqueServer,
} from '@serenity-kit/opaque';
import { deriveRecoveryAmk } from '../../src/amk.js';
import { getLinkedAccount } from '../../src/db/linked-account.js';
import { getLocalAccount } from '../../src/db/local-account.js';
import { openLocalDb } from '../../src/db/open.js';
import { fromBase64Url, toBase64Url } from '../../src/encoding/base64url.js';
import { encodeRecoveryKey } from '../../src/encoding/recovery-key.js';
import { CryptoError } from '../../src/errors.js';
import { recoverFromScratch } from '../../src/flows/recover-from-scratch.js';
import { makeLocalAccountAad } from '../../src/primitives/aad.js';
import { aeadEncrypt } from '../../src/primitives/aead.js';
import { getRandomBytes } from '../../src/primitives/random.js';
import type { ServerClient } from '../../src/server-client.js';
import { asRecoveryKey } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB = 'chatsundere-test-recover-from-scratch';
const BASE_URL = 'https://example.com/api';
const PASSPHRASE = 'correct horse battery staple';
const NEW_PASSPHRASE = 'new passphrase for fresh device';
const USERNAME = 'alice';
const SERVER_ID = opaqueServerIdentity(BASE_URL);

// ---------------------------------------------------------------------------
// OPAQUE server-side simulation helpers
// ---------------------------------------------------------------------------

/**
 * Registers a user on an in-memory OPAQUE server. Returns the registration
 * record needed for future server-side login rounds and the export key used
 * to build the server-side wrapped-MK fixtures.
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
 * Builds a realistic server-side recovery-slot wrap using a given recovery key
 * and MK. Returns base64url fields matching `RecoveryStartResponse`.
 */
async function buildServerRecoveryWrap(
  recoveryKeyBytes: Uint8Array,
  mk: Uint8Array,
  username: string,
): Promise<{
  wrapped_mk_recovery: string;
  wrap_nonce_recovery: string;
  wrap_aad_recovery: string;
}> {
  const rk = asRecoveryKey(recoveryKeyBytes);
  const recoveryAmk = await deriveRecoveryAmk(rk);
  // Use the same AAD the server stores (matching what makeLocalAccountAad produces
  // during the original registration).
  const aad = makeLocalAccountAad(username, 'recovery');
  const wrapped = await aeadEncrypt(recoveryAmk, mk, aad);
  return {
    wrapped_mk_recovery: toBase64Url(wrapped.ciphertext),
    wrap_nonce_recovery: toBase64Url(wrapped.nonce),
    wrap_aad_recovery: toBase64Url(wrapped.aad),
  };
}

// ---------------------------------------------------------------------------
// Mock ServerClient factory
// ---------------------------------------------------------------------------

interface MockOpts {
  serverSetup: string;
  /** Pre-built recovery wrap fields for the recoveryStart response. */
  recoveryWrapFields?: {
    wrapped_mk_recovery: string;
    wrap_nonce_recovery: string;
    wrap_aad_recovery: string;
  };
  /** Override nonce returned in recoveryStart. */
  nonce?: string;
  /** Throw this from recoveryStart instead of returning a response. */
  rejectStartWith?: Error;
  /** Throw this from recoveryFinish instead of returning a response. */
  rejectFinishWith?: Error;
}

function makeServerClient(opts: MockOpts): ServerClient {
  const nonce = opts.nonce ?? toBase64Url(getRandomBytes(32));

  return {
    async recoveryStart(req, _baseUrl) {
      if (opts.rejectStartWith) throw opts.rejectStartWith;

      // Produce a real OPAQUE registration_response for the new passphrase.
      const { registrationResponse } = opaqueServer.createRegistrationResponse({
        serverSetup: opts.serverSetup,
        userIdentifier: req.username,
        registrationRequest: req.registration_request,
      });

      return {
        nonce,
        registration_response: registrationResponse,
        ...(opts.recoveryWrapFields ?? {
          wrapped_mk_recovery: toBase64Url(new Uint8Array(48)),
          wrap_nonce_recovery: toBase64Url(new Uint8Array(12)),
          wrap_aad_recovery: toBase64Url(new Uint8Array(0)),
        }),
      };
    },

    async recoveryFinish(_req, _baseUrl) {
      if (opts.rejectFinishWith) throw opts.rejectFinishWith;
      return {
        user_id: 'srv-uuid-recovered',
        role: 'user',
        access_token: 'access-jwt-recovery',
        expires_in: 900,
      };
    },

    async joinStart() {
      throw new Error('not used');
    },
    async joinFinish() {
      throw new Error('not used');
    },
    async loginOpaqueStart() {
      throw new Error('not used');
    },
    async loginOpaqueFinish() {
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
    async stepUpStart() {
      throw new Error('not used');
    },
    async stepUpFinish() {
      throw new Error('not used');
    },
    async linkPasskeyStart() {
      throw new Error('not used');
    },
    async linkPasskeyFinish() {
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
// Tests
// ---------------------------------------------------------------------------

describe('recoverFromScratch', () => {
  it('happy path: recovers MK, writes both IDB rows, returns correct session', async () => {
    const db = await openLocalDb(DB);
    const serverSetup = opaqueServer.createSetup();

    // Build a "real" original MK and recovery key as would exist on the server.
    const originalMk = getRandomBytes(32);
    const recoveryKeyBytes = getRandomBytes(32);
    const rk = asRecoveryKey(recoveryKeyBytes);
    const recoveryKeyString = encodeRecoveryKey(rk);

    const recoveryWrapFields = await buildServerRecoveryWrap(
      recoveryKeyBytes,
      originalMk,
      USERNAME,
    );

    const client = makeServerClient({ serverSetup, recoveryWrapFields });

    const result = await recoverFromScratch({
      db,
      serverClient: client,
      baseUrl: BASE_URL,
      username: USERNAME,
      recoveryKeyString,
      newPassphrase: NEW_PASSPHRASE,
      issuerLabel: 'My Chatsundere',
    });

    // The recovered MK must match the original. Compare raw bytes since
    // MasterKey is a branded Uint8Array; `toEqual` against the branded type
    // tightens unhelpfully — strip the brand by wrapping in a plain Uint8Array.
    expect(result.mk).toBeInstanceOf(Uint8Array);
    expect(result.mk.length).toBe(32);
    expect(new Uint8Array(result.mk)).toEqual(new Uint8Array(originalMk));

    // Session shape.
    expect(result.session.mode).toBe('linked');
    expect(result.session.online).toBe(true);
    expect(result.session.userId).toBe('srv-uuid-recovered');
    expect(result.session.username).toBe(USERNAME);
    expect(result.session.accessToken).toBe('access-jwt-recovery');
    expect(result.session.role).toBe('user');

    // local_account row was written with all expected fields.
    const localRow = await getLocalAccount(db);
    expect(localRow).not.toBeNull();
    expect(localRow?.username).toBe(USERNAME);
    expect(localRow?.local_salt).toBeInstanceOf(Uint8Array);
    expect(localRow?.wrapped_mk_local_ciphertext).toBeInstanceOf(Uint8Array);
    expect(localRow?.wrapped_mk_local_integrity).toBeInstanceOf(Uint8Array);
    expect(localRow?.wrapped_mk_local_aad).toEqual(
      new TextEncoder().encode(`${USERNAME}::local::v1`),
    );
    expect(localRow?.wrapped_mk_recovery_ciphertext).toBeInstanceOf(Uint8Array);
    expect(localRow?.wrapped_mk_recovery_integrity).toBeInstanceOf(Uint8Array);
    expect(localRow?.wrapped_mk_recovery_aad).toEqual(
      new TextEncoder().encode(`${USERNAME}::recovery::v1`),
    );
    expect(localRow?.recovery_verifier_key).toBeInstanceOf(Uint8Array);
    expect(localRow?.recovery_verifier_key.length).toBe(32);

    // linked_account row was written with issuer label.
    const linkedRow = await getLinkedAccount(db);
    expect(linkedRow).not.toBeNull();
    expect(linkedRow?.server_user_id).toBe('srv-uuid-recovered');
    expect(linkedRow?.base_url).toBe(BASE_URL);
    expect(linkedRow?.role).toBe('user');
    expect(linkedRow?.issuer_label).toBe('My Chatsundere');
    expect(linkedRow?.wrapped_mk_opaque_ciphertext).toBeInstanceOf(Uint8Array);
    expect(linkedRow?.wrapped_mk_opaque_integrity).toBeInstanceOf(Uint8Array);
    expect(linkedRow?.wrapped_mk_opaque_aad).toEqual(
      new TextEncoder().encode(`${USERNAME}::opaque::v1`),
    );

    result.session.close();
    db.close();
  });

  it('happy path without issuerLabel persists null in linked_account', async () => {
    const db = await openLocalDb(DB);
    const serverSetup = opaqueServer.createSetup();

    const originalMk = getRandomBytes(32);
    const recoveryKeyBytes = getRandomBytes(32);
    const rk = asRecoveryKey(recoveryKeyBytes);
    const recoveryKeyString = encodeRecoveryKey(rk);
    const recoveryWrapFields = await buildServerRecoveryWrap(
      recoveryKeyBytes,
      originalMk,
      USERNAME,
    );

    const client = makeServerClient({ serverSetup, recoveryWrapFields });

    const result = await recoverFromScratch({
      db,
      serverClient: client,
      baseUrl: BASE_URL,
      username: USERNAME,
      recoveryKeyString,
      newPassphrase: NEW_PASSPHRASE,
      // no issuerLabel
    });

    const linkedRow = await getLinkedAccount(db);
    expect(linkedRow?.issuer_label).toBeNull();

    result.session.close();
    db.close();
  });

  it('throws CryptoError("conflict") when a local_account already exists', async () => {
    const db = await openLocalDb(DB);
    const serverSetup = opaqueServer.createSetup();

    // Pre-populate a local account to simulate a non-fresh PWA.
    const { createLocalAccount } = await import('../../src/flows/create-local-account.js');
    await createLocalAccount({ db, username: USERNAME, passphrase: PASSPHRASE });

    const recoveryKeyBytes = getRandomBytes(32);
    const rk = asRecoveryKey(recoveryKeyBytes);
    const recoveryKeyString = encodeRecoveryKey(rk);

    const client = makeServerClient({ serverSetup });

    await expect(
      recoverFromScratch({
        db,
        serverClient: client,
        baseUrl: BASE_URL,
        username: USERNAME,
        recoveryKeyString,
        newPassphrase: NEW_PASSPHRASE,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });

    db.close();
  });

  it('throws CryptoError("wrong_recovery_key") when the recovery key bytes are wrong', async () => {
    const db = await openLocalDb(DB);
    const serverSetup = opaqueServer.createSetup();

    const originalMk = getRandomBytes(32);
    const recoveryKeyBytes = getRandomBytes(32);
    const rk = asRecoveryKey(recoveryKeyBytes);
    const recoveryWrapFields = await buildServerRecoveryWrap(
      recoveryKeyBytes,
      originalMk,
      USERNAME,
    );

    // Use a different recovery key string so the unwrap will fail.
    const wrongRk = asRecoveryKey(getRandomBytes(32));
    const wrongKeyString = encodeRecoveryKey(wrongRk);

    const client = makeServerClient({ serverSetup, recoveryWrapFields });

    await expect(
      recoverFromScratch({
        db,
        serverClient: client,
        baseUrl: BASE_URL,
        username: USERNAME,
        recoveryKeyString: wrongKeyString,
        newPassphrase: NEW_PASSPHRASE,
      }),
    ).rejects.toMatchObject({ code: 'wrong_recovery_key' });

    db.close();
  });

  it('throws CryptoError("not_found") when the server returns 404', async () => {
    const db = await openLocalDb(DB);
    const serverSetup = opaqueServer.createSetup();

    const notFoundError = Object.assign(new Error('user not found'), { status: 404 });
    const client = makeServerClient({ serverSetup, rejectStartWith: notFoundError });

    const recoveryKeyBytes = getRandomBytes(32);
    const rk = asRecoveryKey(recoveryKeyBytes);
    const recoveryKeyString = encodeRecoveryKey(rk);

    await expect(
      recoverFromScratch({
        db,
        serverClient: client,
        baseUrl: BASE_URL,
        username: 'unknown-user',
        recoveryKeyString,
        newPassphrase: NEW_PASSPHRASE,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });

    db.close();
  });

  it('propagates non-404 server errors from recoveryStart unchanged', async () => {
    const db = await openLocalDb(DB);
    const serverSetup = opaqueServer.createSetup();

    const networkError = Object.assign(new Error('Network error'), { status: 503 });
    const client = makeServerClient({ serverSetup, rejectStartWith: networkError });

    const recoveryKeyBytes = getRandomBytes(32);
    const rk = asRecoveryKey(recoveryKeyBytes);
    const recoveryKeyString = encodeRecoveryKey(rk);

    await expect(
      recoverFromScratch({
        db,
        serverClient: client,
        baseUrl: BASE_URL,
        username: USERNAME,
        recoveryKeyString,
        newPassphrase: NEW_PASSPHRASE,
      }),
    ).rejects.toMatchObject({ message: 'Network error' });

    db.close();
  });

  it('propagates errors from recoveryFinish unchanged', async () => {
    const db = await openLocalDb(DB);
    const serverSetup = opaqueServer.createSetup();

    const originalMk = getRandomBytes(32);
    const recoveryKeyBytes = getRandomBytes(32);
    const rk = asRecoveryKey(recoveryKeyBytes);
    const recoveryKeyString = encodeRecoveryKey(rk);
    const recoveryWrapFields = await buildServerRecoveryWrap(
      recoveryKeyBytes,
      originalMk,
      USERNAME,
    );

    const serverError = Object.assign(new Error('Internal server error'), { status: 500 });
    const client = makeServerClient({
      serverSetup,
      recoveryWrapFields,
      rejectFinishWith: serverError,
    });

    await expect(
      recoverFromScratch({
        db,
        serverClient: client,
        baseUrl: BASE_URL,
        username: USERNAME,
        recoveryKeyString,
        newPassphrase: NEW_PASSPHRASE,
      }),
    ).rejects.toMatchObject({ message: 'Internal server error' });

    db.close();
  });
});
