// SPDX-License-Identifier: LGPL-3.0-only
import { beforeAll, describe, expect, it } from 'bun:test';
import { ready as opaqueReady, server as opaqueServer } from '@serenity-kit/opaque';
import { toBase64Url } from '../../src/encoding/base64url.js';
import {
  opaqueLoginFinish,
  opaqueLoginStart,
  opaqueRegistrationFinish,
  opaqueRegistrationStart,
} from '../../src/opaque/client.js';

const SERVER_ID = 'https://chatsundere.example.com/api/auth/v1';
const USERNAME = 'alice';
const PASSPHRASE = 'correct horse battery staple';

let serverSetup: string;

describe('OPAQUE client wrapper', () => {
  beforeAll(async () => {
    await opaqueReady;
    serverSetup = opaqueServer.createSetup();
  });

  it('registration completes end-to-end and yields a 64-byte export key', async () => {
    const { clientRegistrationState, registrationRequest } =
      await opaqueRegistrationStart(PASSPHRASE);

    const { registrationResponse } = opaqueServer.createRegistrationResponse({
      serverSetup,
      userIdentifier: USERNAME,
      registrationRequest,
    });

    const { registrationRecord, exportKey } = await opaqueRegistrationFinish({
      clientRegistrationState,
      registrationResponse,
      passphrase: PASSPHRASE,
      username: USERNAME,
      serverIdentity: SERVER_ID,
    });

    // registrationRecord is returned as Uint8Array
    expect(registrationRecord).toBeInstanceOf(Uint8Array);
    expect(registrationRecord.length).toBeGreaterThan(0);

    // exportKey is 64 bytes (the library's 86-char base64url string decoded)
    expect(exportKey).toBeInstanceOf(Uint8Array);
    expect(exportKey.length).toBe(64);

    // Stash the record for the login test — re-encode as base64url for the server API
    (globalThis as Record<string, unknown>).__opaqueRecord = toBase64Url(registrationRecord);
    (globalThis as Record<string, unknown>).__opaqueExportKey = exportKey;
  });

  it('login completes end-to-end and produces a matching 64-byte export key', async () => {
    const registrationRecordB64 = (globalThis as Record<string, unknown>).__opaqueRecord as string;
    expect(registrationRecordB64).toBeDefined();

    const { clientLoginState, startLoginRequest } = await opaqueLoginStart(PASSPHRASE);

    // The server API in 0.9.0 takes the registration record as the base64url string
    // returned by the library — re-encode the Uint8Array we stored back to that form.
    // identifiers must match what was used in finishRegistration, so pass them here too.
    const { serverLoginState, loginResponse } = opaqueServer.startLogin({
      serverSetup,
      userIdentifier: USERNAME,
      registrationRecord: registrationRecordB64,
      startLoginRequest,
      identifiers: { client: USERNAME, server: SERVER_ID },
    });

    const { finishLoginRequest, exportKey, sessionKey } = await opaqueLoginFinish({
      clientLoginState,
      loginResponse,
      passphrase: PASSPHRASE,
      username: USERNAME,
      serverIdentity: SERVER_ID,
    });

    // All binary blobs are returned as Uint8Array
    expect(finishLoginRequest).toBeInstanceOf(Uint8Array);
    expect(finishLoginRequest.length).toBeGreaterThan(0);

    expect(exportKey).toBeInstanceOf(Uint8Array);
    expect(exportKey.length).toBe(64);

    expect(sessionKey).toBeInstanceOf(Uint8Array);
    expect(sessionKey.length).toBe(64);

    // Server finalises login; its session key must match the client's
    const { sessionKey: serverSessionKey } = opaqueServer.finishLogin({
      serverLoginState,
      finishLoginRequest: toBase64Url(finishLoginRequest),
    });

    expect(toBase64Url(sessionKey)).toBe(serverSessionKey);

    // Export key from login must match the one from registration (same passphrase)
    const regExportKey = (globalThis as Record<string, unknown>).__opaqueExportKey as Uint8Array;
    expect(Buffer.from(exportKey).equals(Buffer.from(regExportKey))).toBe(true);
  });

  it('login with wrong passphrase throws a CryptoError with wrong_passphrase code', async () => {
    const registrationRecordB64 = (globalThis as Record<string, unknown>).__opaqueRecord as string;
    expect(registrationRecordB64).toBeDefined();

    const { clientLoginState, startLoginRequest } = await opaqueLoginStart('wrong passphrase');

    const { serverLoginState: _serverLoginState, loginResponse } = opaqueServer.startLogin({
      serverSetup,
      userIdentifier: USERNAME,
      registrationRecord: registrationRecordB64,
      startLoginRequest,
      identifiers: { client: USERNAME, server: SERVER_ID },
    });

    await expect(
      opaqueLoginFinish({
        clientLoginState,
        loginResponse,
        passphrase: 'wrong passphrase',
        username: USERNAME,
        serverIdentity: SERVER_ID,
      }),
    ).rejects.toMatchObject({ code: 'wrong_passphrase' });
  });
});
