// SPDX-License-Identifier: LGPL-3.0-only

import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
  StepUpStartResponse,
  StepUpTier,
} from '@chatsundere/shared-types';
import { opaqueServerIdentity } from '@chatsundere/shared-types';
import { getLinkedAccount, putLinkedAccount } from '../db/linked-account.js';
import { getLocalAccount } from '../db/local-account.js';
import { toBase64Url } from '../encoding/base64url.js';
import { CryptoError } from '../errors.js';
import { opaqueLoginFinish, opaqueLoginStart } from '../opaque/client.js';
import type { ServerClient } from '../server-client.js';

export type PasskeyStepUpOutcome = 'confirmed' | 'no_passkey' | 'uv_required' | 'failed';
export type PassphraseStepUpOutcome = 'confirmed' | 'wrong_passphrase' | 'failed';

export interface StepUpWithPasskeyArgs {
  db: IDBDatabase;
  serverClient: ServerClient;
  accessToken: string;
  tier: StepUpTier;
  /** Drives navigator.credentials.get() — injected so this flow stays DOM-free. */
  getAssertion(options: PublicKeyCredentialRequestOptionsJSON): Promise<AuthenticationResponseJSON>;
}

/**
 * Step-up Mechanism A (ADR 0027): fresh WebAuthn assertion with UV required.
 * Returns a discriminated outcome instead of throwing — the modal maps
 * 'no_passkey' and 'uv_required' onto the silent fall-through to Mechanism B.
 */
export async function stepUpWithPasskey(
  args: StepUpWithPasskeyArgs,
): Promise<PasskeyStepUpOutcome> {
  const linked = await getLinkedAccount(args.db);
  if (!linked) return 'failed';

  let start: StepUpStartResponse;
  try {
    start = await args.serverClient.stepUpStart(
      { mechanism: 'webauthn', tier_requested: args.tier },
      linked.base_url,
      args.accessToken,
    );
  } catch (err) {
    return codeOf(err) === 'no_passkey' ? 'no_passkey' : 'failed';
  }
  if (start.mechanism !== 'webauthn') return 'failed';

  let assertion: AuthenticationResponseJSON;
  try {
    assertion = await args.getAssertion(start.options);
  } catch {
    // User abort or authenticator error — the caller decides what to show.
    return 'failed';
  }

  try {
    await args.serverClient.stepUpFinish(
      { mechanism: 'webauthn', session_id: start.session_id, assertion },
      linked.base_url,
    );
    return 'confirmed';
  } catch (err) {
    return codeOf(err) === 'webauthn_uv_required' ? 'uv_required' : 'failed';
  }
}

export interface StepUpWithPassphraseArgs {
  db: IDBDatabase;
  serverClient: ServerClient;
  accessToken: string;
  tier: StepUpTier;
  passphrase: string;
}

/**
 * Step-up Mechanism B (ADR 0027): a fresh OPAQUE round on the existing
 * session. No username crosses the wire — the server binds the round to the
 * bearer. The client identifier mirrors what the server reads server-side
 * (auth-service `auth_methods.opaque_client_identifier`, frozen at
 * registration/link time): `linked.opaque_client_identifier`, falling back to
 * the live `local_account.username` only for legacy rows linked before this
 * field existed (self-healed below on success).
 */
export async function stepUpWithPassphrase(
  args: StepUpWithPassphraseArgs,
): Promise<PassphraseStepUpOutcome> {
  const linked = await getLinkedAccount(args.db);
  const local = await getLocalAccount(args.db);
  if (!linked || !local) return 'failed';
  const serverIdentity = opaqueServerIdentity(linked.base_url);
  const clientIdentifier = linked.opaque_client_identifier ?? local.username;

  try {
    const { clientLoginState, startLoginRequest } = await opaqueLoginStart(args.passphrase);
    const start = await args.serverClient.stepUpStart(
      { mechanism: 'opaque', tier_requested: args.tier, login_request: startLoginRequest },
      linked.base_url,
      args.accessToken,
    );
    if (start.mechanism !== 'opaque') return 'failed';

    const finish = await opaqueLoginFinish({
      clientLoginState,
      loginResponse: start.login_response,
      passphrase: args.passphrase,
      username: clientIdentifier,
      serverIdentity,
    });

    await args.serverClient.stepUpFinish(
      {
        mechanism: 'opaque',
        session_id: start.session_id,
        login_evidence: toBase64Url(finish.finishLoginRequest),
      },
      linked.base_url,
    );

    // Self-heal: this round just proved `clientIdentifier` authenticates, so
    // persist it on legacy rows that predate this field.
    if (!linked.opaque_client_identifier) {
      await putLinkedAccount(args.db, { ...linked, opaque_client_identifier: clientIdentifier });
    }

    return 'confirmed';
  } catch (err) {
    if (err instanceof CryptoError && err.code === 'wrong_passphrase') return 'wrong_passphrase';
    if (codeOf(err) === 'opaque_authentication_failed') return 'wrong_passphrase';
    return 'failed';
  }
}

/**
 * Reads the wire error code from an injected server-client error. Duck-typed
 * — the crypto package must not know the apps' HttpError class.
 */
function codeOf(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}
