// SPDX-License-Identifier: LGPL-3.0-only

import { client as opaqueClient } from '@serenity-kit/opaque';
import { fromBase64Url } from '../encoding/base64url.js';
import { CryptoError } from '../errors.js';

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export interface RegistrationStartResult {
  /** Opaque blob — pass unchanged into `opaqueRegistrationFinish`. */
  clientRegistrationState: string;
  /** Base64url-encoded request to send to the server. */
  registrationRequest: string;
}

/**
 * Begin OPAQUE registration on the client. The returned `clientRegistrationState`
 * is an opaque blob that must be passed back into `opaqueRegistrationFinish` unchanged.
 */
export async function opaqueRegistrationStart(
  passphrase: string,
): Promise<RegistrationStartResult> {
  try {
    return opaqueClient.startRegistration({ password: passphrase });
  } catch (err) {
    throw new CryptoError('opaque_protocol_error', `OPAQUE registration start failed: ${err}`);
  }
}

export interface RegistrationFinishArgs {
  clientRegistrationState: string;
  registrationResponse: string;
  passphrase: string;
  username: string;
  serverIdentity: string;
}

export interface RegistrationFinishResult {
  /** Raw registration record bytes; send this to the server (base64url-encode for the wire). */
  registrationRecord: Uint8Array;
  /**
   * OPAQUE export key (64 bytes). Feed into `deriveOpaqueAmk` to obtain the
   * auth-method key that wraps the master key.
   */
  exportKey: Uint8Array;
}

/**
 * Finish OPAQUE registration. Returns the registration record (to send to the server)
 * and the export key (64 bytes; use `deriveOpaqueAmk` to derive the AMK from it).
 */
export async function opaqueRegistrationFinish(
  args: RegistrationFinishArgs,
): Promise<RegistrationFinishResult> {
  try {
    const { registrationRecord, exportKey } = opaqueClient.finishRegistration({
      password: args.passphrase,
      registrationResponse: args.registrationResponse,
      clientRegistrationState: args.clientRegistrationState,
      identifiers: {
        client: args.username,
        server: args.serverIdentity,
      },
    });
    return {
      registrationRecord: fromBase64Url(registrationRecord),
      exportKey: fromBase64Url(exportKey),
    };
  } catch (err) {
    throw new CryptoError('opaque_protocol_error', `OPAQUE registration finish failed: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export interface LoginStartResult {
  /** Opaque blob — pass unchanged into `opaqueLoginFinish`. */
  clientLoginState: string;
  /** Base64url-encoded KE1 message to send to the server. */
  startLoginRequest: string;
}

/**
 * Begin OPAQUE login on the client. The returned `startLoginRequest` is the KE1
 * message to send to the server.
 */
export async function opaqueLoginStart(passphrase: string): Promise<LoginStartResult> {
  try {
    return opaqueClient.startLogin({ password: passphrase });
  } catch (err) {
    throw new CryptoError('opaque_protocol_error', `OPAQUE login start failed: ${err}`);
  }
}

export interface LoginFinishArgs {
  clientLoginState: string;
  /** Server's KE2 message (base64url string from the server). */
  loginResponse: string;
  passphrase: string;
  username: string;
  serverIdentity: string;
}

export interface LoginFinishResult {
  /** KE3 message bytes to send to the server to complete mutual authentication. */
  finishLoginRequest: Uint8Array;
  /**
   * OPAQUE export key (64 bytes). Must match the export key from registration.
   * Feed into `deriveOpaqueAmk` to obtain the AMK.
   */
  exportKey: Uint8Array;
  /** Session key (64 bytes); shared with the server for this session. */
  sessionKey: Uint8Array;
}

/**
 * Finish OPAQUE login. Returns `undefined` via thrown `CryptoError('wrong_passphrase', ...)`
 * when the passphrase is wrong — never returns a falsy result to callers.
 */
export async function opaqueLoginFinish(args: LoginFinishArgs): Promise<LoginFinishResult> {
  try {
    const result = opaqueClient.finishLogin({
      clientLoginState: args.clientLoginState,
      loginResponse: args.loginResponse,
      password: args.passphrase,
      identifiers: {
        client: args.username,
        server: args.serverIdentity,
      },
    });

    if (!result) {
      throw new CryptoError('wrong_passphrase', 'OPAQUE login finish: passphrase is incorrect');
    }

    return {
      finishLoginRequest: fromBase64Url(result.finishLoginRequest),
      exportKey: fromBase64Url(result.exportKey),
      sessionKey: fromBase64Url(result.sessionKey),
    };
  } catch (err) {
    if (err instanceof CryptoError) throw err;
    throw new CryptoError('opaque_protocol_error', `OPAQUE login finish failed: ${err}`);
  }
}
