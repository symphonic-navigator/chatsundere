// SPDX-License-Identifier: LGPL-3.0-only
import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { opaqueServerIdentity } from '@chatsundere/shared-types';
import {
  client as opaqueClient,
  ready as opaqueReady,
  server as opaqueServer,
} from '@serenity-kit/opaque';
import { deriveOpaqueAmk, deriveRecoveryAmk } from '../../src/amk.js';
import { putLocalAndLinkedAccount } from '../../src/db/account-pair.js';
import { getLinkedAccount } from '../../src/db/linked-account.js';
import { getLocalAccount } from '../../src/db/local-account.js';
import { openLocalDb } from '../../src/db/open.js';
import type { LinkedAccountRow, LocalAccountRow } from '../../src/db/schema.js';
import { fromBase64Url, toBase64Url } from '../../src/encoding/base64url.js';
import { encodeRecoveryKey } from '../../src/encoding/recovery-key.js';
import { recoveryOnline } from '../../src/flows/recovery-online.js';
import { makeLocalAccountAad } from '../../src/primitives/aad.js';
import { aeadEncrypt } from '../../src/primitives/aead.js';
import { addIntegrityHmac, deriveIntegrityKey } from '../../src/primitives/integrity.js';
import { getRandomBytes } from '../../src/primitives/random.js';
import { deriveVerifierKey } from '../../src/recovery.js';
import type { ServerClient } from '../../src/server-client.js';
import { asRecoveryKey } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB = 'chatsundere-test-recovery-online';
const BASE_URL = 'https://example.com/api';
const PASSPHRASE = 'correct horse battery staple';
const NEW_PASSPHRASE = 'new passphrase after server recovery';
const USERNAME = 'alice';
const SERVER_ID = opaqueServerIdentity(BASE_URL);

// ---------------------------------------------------------------------------
// OPAQUE server-side simulation + fixture helpers
// ---------------------------------------------------------------------------

/**
 * Registers a user on an in-memory OPAQUE server and produces the wrapped-MK
 * fixtures for local_account/linked_account rows, mirroring what a real
 * onboarding would have written before this recovery flow runs.
 */
async function seedExistingAccount(
  db: IDBDatabase,
  serverSetup: string,
  originalMk: Uint8Array,
  recoveryKeyBytes: Uint8Array,
): Promise<void> {
  const { clientRegistrationState, registrationRequest } = opaqueClient.startRegistration({
    password: PASSPHRASE,
  });
  const { registrationResponse } = opaqueServer.createRegistrationResponse({
    serverSetup,
    userIdentifier: USERNAME,
    registrationRequest,
  });
  const { exportKey } = opaqueClient.finishRegistration({
    password: PASSPHRASE,
    registrationResponse,
    clientRegistrationState,
    identifiers: { client: USERNAME, server: SERVER_ID },
  });
  const opaqueAmk = await deriveOpaqueAmk(fromBase64Url(exportKey));

  const opaqueAad = makeLocalAccountAad(USERNAME, 'opaque');
  const opaqueWrap = await aeadEncrypt(opaqueAmk, originalMk, opaqueAad);
  const opaqueIk = await deriveIntegrityKey(opaqueAmk);
  const opaqueTagged = await addIntegrityHmac(opaqueWrap, opaqueIk);

  const rk = asRecoveryKey(recoveryKeyBytes);
  const recoveryAmk = await deriveRecoveryAmk(rk);
  const recoveryAad = makeLocalAccountAad(USERNAME, 'recovery');
  const recoveryWrap = await aeadEncrypt(recoveryAmk, originalMk, recoveryAad);
  const recoveryIk = await deriveIntegrityKey(recoveryAmk);
  const recoveryTagged = await addIntegrityHmac(recoveryWrap, recoveryIk);
  const verifierKey = await deriveVerifierKey(rk);

  const localRow: LocalAccountRow = {
    schema_version: 1,
    username: USERNAME,
    local_salt: getRandomBytes(16),
    wrapped_mk_local_ciphertext: new Uint8Array([9, 9]),
    wrapped_mk_local_nonce: new Uint8Array([9, 9]),
    wrapped_mk_local_aad: new Uint8Array([9, 9]),
    wrapped_mk_local_integrity: new Uint8Array([9, 9]),
    wrapped_mk_recovery_ciphertext: recoveryTagged.ciphertext,
    wrapped_mk_recovery_nonce: recoveryTagged.nonce,
    wrapped_mk_recovery_aad: recoveryTagged.aad,
    wrapped_mk_recovery_integrity: recoveryTagged.integrity_hmac,
    recovery_verifier_key: verifierKey,
    created_at: new Date(),
  };

  const linkedRow: LinkedAccountRow = {
    server_user_id: 'srv-uuid-original',
    base_url: BASE_URL,
    issuer_label: 'My Chatsundere',
    role: 'user',
    wrapped_mk_opaque_ciphertext: opaqueTagged.ciphertext,
    wrapped_mk_opaque_nonce: opaqueTagged.nonce,
    wrapped_mk_opaque_aad: opaqueTagged.aad,
    wrapped_mk_opaque_integrity: opaqueTagged.integrity_hmac,
    linked_at: new Date(),
    opaque_client_identifier: USERNAME,
  };

  await putLocalAndLinkedAccount(db, localRow, linkedRow);
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
  recoveryWrapFields: {
    wrapped_mk_recovery: string;
    wrap_nonce_recovery: string;
    wrap_aad_recovery: string;
  };
  nonce?: string;
}

function makeServerClient(opts: MockOpts): ServerClient {
  const nonce = opts.nonce ?? toBase64Url(getRandomBytes(32));

  return {
    async recoveryStart(req, _baseUrl) {
      const { registrationResponse } = opaqueServer.createRegistrationResponse({
        serverSetup: opts.serverSetup,
        userIdentifier: req.username,
        registrationRequest: req.registration_request,
      });

      return {
        nonce,
        registration_response: registrationResponse,
        ...opts.recoveryWrapFields,
      };
    },

    async recoveryFinish(_req, _baseUrl) {
      return {
        user_id: 'srv-uuid-recovered',
        role: 'admin',
        access_token: 'access-jwt-online-recovery',
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

describe('recoveryOnline', () => {
  it('returns a linked, online session carrying the server-issued access token', async () => {
    const db = await openLocalDb(DB);
    const serverSetup = opaqueServer.createSetup();

    const originalMk = getRandomBytes(32);
    const recoveryKeyBytes = getRandomBytes(32);
    const rk = asRecoveryKey(recoveryKeyBytes);
    const recoveryKeyString = encodeRecoveryKey(rk);

    await seedExistingAccount(db, serverSetup, originalMk, recoveryKeyBytes);

    const recoveryWrapFields = await buildServerRecoveryWrap(
      recoveryKeyBytes,
      originalMk,
      USERNAME,
    );
    const client = makeServerClient({ serverSetup, recoveryWrapFields });

    const result = await recoveryOnline({
      db,
      serverClient: client,
      baseUrl: BASE_URL,
      username: USERNAME,
      recoveryKeyString,
      newPassphrase: NEW_PASSPHRASE,
    });

    // The returned session must be linked + online, carrying the
    // server-issued access token — the caller must not fall back to an
    // offline local session after a server-assisted recovery.
    expect(result.session.mode).toBe('linked');
    expect(result.session.online).toBe(true);
    expect(result.session.accessToken).toBeTruthy();
    expect(result.session.accessToken).toBe('access-jwt-online-recovery');
    expect(result.session.userId).toBe('srv-uuid-recovered');
    expect(result.session.role).toBe('admin');
    expect(result.session.username).toBe(USERNAME);

    // The recovered MK must match the original.
    expect(new Uint8Array(result.mk)).toEqual(new Uint8Array(originalMk));

    // linked_account row keeps the frozen OPAQUE client identifier (Task C1).
    const linkedRow = await getLinkedAccount(db);
    expect(linkedRow?.opaque_client_identifier).toBe(USERNAME);
    expect(linkedRow?.server_user_id).toBe('srv-uuid-recovered');
    expect(linkedRow?.role).toBe('admin');

    // local_account recovery wraps were re-written to match the server copy.
    const localRow = await getLocalAccount(db);
    expect(localRow?.wrapped_mk_recovery_ciphertext).toBeInstanceOf(Uint8Array);

    result.session.close();
    db.close();
  });
});
