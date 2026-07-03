// SPDX-License-Identifier: LGPL-3.0-only
import { beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { ready as opaqueReady, server as opaqueServer } from '@serenity-kit/opaque';
import { getLinkedAccount } from '../../src/db/linked-account.js';
import { getLocalAccount } from '../../src/db/local-account.js';
import { openLocalDb } from '../../src/db/open.js';
import { decodeRecoveryKey } from '../../src/encoding/recovery-key.js';
import { CryptoError } from '../../src/errors.js';
import {
  finishJoinByInvitation,
  startJoinByInvitation,
} from '../../src/flows/join-by-invitation.js';
import type { ServerClient } from '../../src/server-client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DB = 'chatsundere-test-join-by-invitation';
const BASE_URL = 'https://example.com/api';
const CODE = 'AB7K3-MN9PX';
const PASSPHRASE = 'correct horse battery staple';
const USERNAME = 'alice';

/** Minimal ServerClient that only implements joinStart / joinFinish. */
function makeServerClient(opts: {
  suggestedUsername?: string | null;
  rejectFinishWith?: Error;
  serverSetup: string;
}): ServerClient {
  return {
    async joinStart(req, _baseUrl) {
      if (req.kind !== 'invitation') throw new Error('expected invitation kind');
      const { registrationResponse } = opaqueServer.createRegistrationResponse({
        serverSetup: opts.serverSetup,
        userIdentifier: USERNAME,
        registrationRequest: req.registration_request,
      });
      return {
        kind: 'invitation',
        session_id: 'test-session-123',
        registration_response: registrationResponse,
        suggested_username: opts.suggestedUsername ?? null,
      };
    },
    async joinFinish(req, _baseUrl) {
      if (opts.rejectFinishWith) throw opts.rejectFinishWith;
      if (req.kind !== 'invitation') throw new Error('expected invitation kind');
      return {
        kind: 'invitation',
        user_id: 'srv-uuid-abc',
        username: req.username,
        role: 'user',
        access_token: 'access-jwt',
        expires_in: 900,
        is_new_account: true,
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
// startJoinByInvitation
// ---------------------------------------------------------------------------

describe('startJoinByInvitation', () => {
  it('returns the session_id and suggested_username from the server response', async () => {
    const serverSetup = opaqueServer.createSetup();
    const client = makeServerClient({ suggestedUsername: 'chris.tidesson', serverSetup });

    const state = await startJoinByInvitation({
      serverClient: client,
      baseUrl: BASE_URL,
      code: CODE,
      passphrase: PASSPHRASE,
    });

    expect(state.sessionId).toBe('test-session-123');
    expect(state.suggestedUsername).toBe('chris.tidesson');
    // The registration response and client state are present (opaque blobs).
    expect(typeof state.registrationResponse).toBe('string');
    expect(state.registrationResponse.length).toBeGreaterThan(0);
    expect(state.clientRegistrationState).toBeTruthy();
  });

  it('returns null for suggested_username when the server omits it', async () => {
    const serverSetup = opaqueServer.createSetup();
    const client = makeServerClient({ suggestedUsername: null, serverSetup });

    const state = await startJoinByInvitation({
      serverClient: client,
      baseUrl: BASE_URL,
      code: CODE,
      passphrase: PASSPHRASE,
    });

    expect(state.suggestedUsername).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// finishJoinByInvitation
// ---------------------------------------------------------------------------

describe('finishJoinByInvitation', () => {
  it('persists local_account and linked_account rows, returns session + recovery key', async () => {
    const db = await openLocalDb(DB);
    const serverSetup = opaqueServer.createSetup();
    const client = makeServerClient({ serverSetup });

    const joinState = await startJoinByInvitation({
      serverClient: client,
      baseUrl: BASE_URL,
      code: CODE,
      passphrase: PASSPHRASE,
    });

    const result = await finishJoinByInvitation({
      db,
      serverClient: client,
      baseUrl: BASE_URL,
      joinState,
      username: USERNAME,
      passphrase: PASSPHRASE,
    });

    // Session shape.
    expect(result.session.mode).toBe('linked');
    expect(result.session.online).toBe(true);
    expect(result.session.userId).toBe('srv-uuid-abc');
    expect(result.session.username).toBe(USERNAME);
    expect(result.session.accessToken).toBe('access-jwt');
    expect(result.session.role).toBe('user');

    // MK is a 32-byte buffer.
    expect(result.mk).toBeInstanceOf(Uint8Array);
    expect(result.mk.length).toBe(32);

    // Recovery key string decodes to 32 bytes.
    const decodedRk = decodeRecoveryKey(result.recoveryKeyString);
    expect(decodedRk.length).toBe(32);

    // local_account row was written.
    const localRow = await getLocalAccount(db);
    expect(localRow).not.toBeNull();
    expect(localRow?.username).toBe(USERNAME);
    expect(localRow?.wrapped_mk_local_ciphertext).toBeInstanceOf(Uint8Array);
    expect(localRow?.wrapped_mk_recovery_ciphertext).toBeInstanceOf(Uint8Array);
    expect(localRow?.recovery_verifier_key).toBeInstanceOf(Uint8Array);
    expect(localRow?.recovery_verifier_key.length).toBe(32);
    // AAD encodes the expected pattern.
    expect(localRow?.wrapped_mk_local_aad).toEqual(
      new TextEncoder().encode(`${USERNAME}::local::v1`),
    );
    expect(localRow?.wrapped_mk_recovery_aad).toEqual(
      new TextEncoder().encode(`${USERNAME}::recovery::v1`),
    );

    // linked_account row was written.
    const linkedRow = await getLinkedAccount(db);
    expect(linkedRow).not.toBeNull();
    expect(linkedRow?.server_user_id).toBe('srv-uuid-abc');
    expect(linkedRow?.base_url).toBe(BASE_URL);
    expect(linkedRow?.role).toBe('user');
    expect(linkedRow?.wrapped_mk_opaque_ciphertext).toBeInstanceOf(Uint8Array);
    expect(linkedRow?.wrapped_mk_opaque_integrity).toBeInstanceOf(Uint8Array);

    result.session.close();
    db.close();
  });

  it('persists the issuerLabel when provided', async () => {
    const db = await openLocalDb(DB);
    const serverSetup = opaqueServer.createSetup();
    const client = makeServerClient({ serverSetup });

    const joinState = await startJoinByInvitation({
      serverClient: client,
      baseUrl: BASE_URL,
      code: CODE,
      passphrase: PASSPHRASE,
    });

    const result = await finishJoinByInvitation({
      db,
      serverClient: client,
      baseUrl: BASE_URL,
      joinState,
      username: USERNAME,
      passphrase: PASSPHRASE,
      issuerLabel: 'My Chatsundere',
    });

    const linkedRow = await getLinkedAccount(db);
    expect(linkedRow?.issuer_label).toBe('My Chatsundere');

    result.session.close();
    db.close();
  });

  it('throws CryptoError("conflict") on 409 username_taken from the server', async () => {
    const db = await openLocalDb(DB);
    const serverSetup = opaqueServer.createSetup();
    const conflictError = Object.assign(new Error('username taken'), {
      status: 409,
      code: 'username_taken',
    });
    const client = makeServerClient({ serverSetup, rejectFinishWith: conflictError });

    const joinState = await startJoinByInvitation({
      serverClient: client,
      baseUrl: BASE_URL,
      code: CODE,
      passphrase: PASSPHRASE,
    });

    await expect(
      finishJoinByInvitation({
        db,
        serverClient: client,
        baseUrl: BASE_URL,
        joinState,
        username: USERNAME,
        passphrase: PASSPHRASE,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });

    db.close();
  });

  it('refuses to run over an existing local account — before any server call (spec §4.2)', async () => {
    const db = await openLocalDb(DB);
    const serverSetup = opaqueServer.createSetup();
    const client = makeServerClient({ serverSetup });

    // Seed a local_account row to simulate a device that already holds one.
    const { createLocalAccount } = await import('../../src/flows/create-local-account.js');
    await createLocalAccount({ db, username: USERNAME, passphrase: PASSPHRASE });

    const joinFinishSpy = spyOn(client, 'joinFinish');

    // A joinState value is required by the signature but must never be consumed:
    // the backstop refuses before any OPAQUE work or server call.
    const joinState = {
      sessionId: 'test-session-123',
      suggestedUsername: null,
      registrationResponse: 'unused',
      clientRegistrationState: 'unused',
    };

    await expect(
      finishJoinByInvitation({
        db,
        serverClient: client,
        baseUrl: BASE_URL,
        joinState,
        username: USERNAME,
        passphrase: PASSPHRASE,
      }),
    ).rejects.toMatchObject({ code: 'local_account_exists' });
    expect(joinFinishSpy).not.toHaveBeenCalled();

    db.close();
  });

  it('propagates non-conflict server errors unchanged', async () => {
    const db = await openLocalDb(DB);
    const serverSetup = opaqueServer.createSetup();
    const networkError = Object.assign(new Error('Network error'), { status: 503 });
    const client = makeServerClient({ serverSetup, rejectFinishWith: networkError });

    const joinState = await startJoinByInvitation({
      serverClient: client,
      baseUrl: BASE_URL,
      code: CODE,
      passphrase: PASSPHRASE,
    });

    await expect(
      finishJoinByInvitation({
        db,
        serverClient: client,
        baseUrl: BASE_URL,
        joinState,
        username: USERNAME,
        passphrase: PASSPHRASE,
      }),
    ).rejects.toMatchObject({ message: 'Network error' });

    db.close();
  });
});
