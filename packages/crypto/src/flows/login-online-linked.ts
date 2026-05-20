// SPDX-License-Identifier: LGPL-3.0-only

import { getLinkedAccount } from '../db/linked-account.js';
import { getLocalAccount, requireLocalAccount } from '../db/local-account.js';
import { toBase64Url } from '../encoding/base64url.js';
import { opaqueLoginFinish, opaqueLoginStart } from '../opaque/client.js';
import type { ServerClient } from '../server-client.js';
import { type MasterKeySession, createMasterKeySession } from '../session.js';
import type { MasterKey } from '../types.js';
import { loginLocalWithPassphrase } from './login-local.js';

export interface LoginOnlineLinkedArgs {
  db: IDBDatabase;
  serverClient: ServerClient;
  passphrase: string;
}

/**
 * Discriminated outcome for the server leg of a double-auth login.
 *
 * - `ok`          — OPAQUE round-trip completed and produced an access token.
 * - `unreachable` — 5xx, network error, or timeout; degrade to offline.
 * - `auth_failed` — server returned 401; the passphrase may have been changed
 *                   elsewhere; degrade to offline with a specific banner.
 * - `skipped`     — no linked account exists; server was never contacted.
 */
export type ServerOutcome =
  | { kind: 'ok' }
  | { kind: 'unreachable' }
  | { kind: 'auth_failed' }
  | { kind: 'skipped' };

export interface LoginOnlineLinkedResult {
  session: MasterKeySession;
  /**
   * The raw master key unwrapped from the local passphrase. Returned so that
   * callers can pass it to operations that require the raw key bytes (e.g.
   * `regenerateRecoveryKey`). Never persisted; lives in memory only.
   */
  mk: MasterKey;
  /**
   * Discriminated outcome describing what happened on the server leg.
   * Use this to drive user-facing banners with the correct message.
   */
  serverOutcome: ServerOutcome;
  /**
   * @deprecated Use `serverOutcome.kind === 'ok' || serverOutcome.kind === 'unreachable'`
   * instead. Kept for backward compatibility; computed from `serverOutcome`.
   */
  serverReachable: boolean;
  /**
   * @deprecated Use `serverOutcome.kind === 'ok'` instead. Kept for backward
   * compatibility; computed from `serverOutcome`.
   */
  serverAuthOk: boolean;
}

/**
 * Transparent double-auth login. Always runs the OPAQUE round-trip when a
 * linked account exists, regardless of local outcome — this closes the
 * local-first oracle (audit finding H2). Commit gate: local must succeed
 * for the session to be opened. Server failure degrades to `online: false`
 * rather than aborting the local session.
 *
 * Local session mode mapping:
 * - local OK + server OK → `mode: 'linked', online: true` with access token
 * - local OK + server unreachable/failed → `mode: 'linked', online: false`
 * - local OK + no linked account → `mode: 'local', online: false`
 * - local fails → throws the local error; server result is discarded
 */
export async function loginOnlineLinked(
  args: LoginOnlineLinkedArgs,
): Promise<LoginOnlineLinkedResult> {
  const local = requireLocalAccount(await getLocalAccount(args.db));
  const linked = await getLinkedAccount(args.db);

  // Start both halves simultaneously. The server leg is a no-op when there
  // is no linked account. Both promises are immediately wrapped in reflect()
  // so that any rejection is captured before the microtask queue has a chance
  // to surface it as an unhandled rejection.
  const localOutcome = reflect(
    loginLocalWithPassphrase({ db: args.db, passphrase: args.passphrase }),
  );
  const serverReflect = reflect(
    linked ? runServerLogin(args, local.username, linked.base_url) : Promise.resolve(null),
  );

  const [resolvedLocal, resolvedServer] = await Promise.all([localOutcome, serverReflect]);

  if (!resolvedLocal.ok) {
    // Discard the server result and propagate the local error. This is the
    // H2 closure: server is always called when online, but the commit gate
    // is local.
    throw resolvedLocal.error;
  }

  const { session: localSession, mk } = resolvedLocal.value;

  // Classify the server leg into a discriminated outcome.
  const serverOutcome: ServerOutcome = classifyServerOutcome(linked, resolvedServer);

  if (!linked || serverOutcome.kind !== 'ok' || !resolvedServer.ok || !resolvedServer.value) {
    // Degrade: keep the local session open, mark offline.
    return {
      session: createMasterKeySession({
        mk,
        userId: localSession.userId,
        username: localSession.username,
        mode: linked ? 'linked' : 'local',
        online: false,
        role: linked?.role,
      }),
      mk,
      serverOutcome,
      serverReachable: serverOutcome.kind !== 'unreachable' && serverOutcome.kind !== 'auth_failed',
      serverAuthOk: serverOutcome.kind === 'ok',
    };
  }

  // Both succeeded. Close the temporary local session and open the
  // upgraded linked+online session using the same MK from local auth.
  // The MK unwrapped by the server via opaque_amk is discarded — we
  // already have it authoritatively from the local unwrap.
  localSession.close();

  const { accessToken, role } = resolvedServer.value;
  return {
    session: createMasterKeySession({
      mk,
      userId: linked.server_user_id,
      username: local.username,
      mode: 'linked',
      online: true,
      role,
      accessToken,
    }),
    mk,
    serverOutcome: { kind: 'ok' },
    serverReachable: true,
    serverAuthOk: true,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ReflectOk<T> {
  ok: true;
  value: T;
}

interface ReflectErr {
  ok: false;
  error: unknown;
}

async function reflect<T>(p: Promise<T>): Promise<ReflectOk<T> | ReflectErr> {
  try {
    return { ok: true, value: await p };
  } catch (error) {
    return { ok: false, error };
  }
}

/** Returns true if the error looks like a 401 HTTP response. */
function isAuthFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status: unknown }).status === 401
  );
}

function classifyServerOutcome(
  linked: Awaited<ReturnType<typeof getLinkedAccount>>,
  result: ReflectOk<unknown> | ReflectErr,
): ServerOutcome {
  if (!linked) return { kind: 'skipped' };
  if (result.ok) return { kind: 'ok' };
  if (isAuthFailure(result.error)) return { kind: 'auth_failed' };
  return { kind: 'unreachable' };
}

async function runServerLogin(
  args: LoginOnlineLinkedArgs,
  username: string,
  baseUrl: string,
): Promise<{ accessToken: string; role: 'primary_admin' | 'admin' | 'user' } | null> {
  const serverId = `${baseUrl}/auth/v1`;

  const { clientLoginState, startLoginRequest } = await opaqueLoginStart(args.passphrase);

  const startResp = await args.serverClient.loginOpaqueStart(
    { username, start_login_request: startLoginRequest },
    baseUrl,
  );

  const finishResult = await opaqueLoginFinish({
    clientLoginState,
    loginResponse: startResp.login_response,
    passphrase: args.passphrase,
    username,
    serverIdentity: serverId,
  });

  const finishResp = await args.serverClient.loginOpaqueFinish(
    {
      session_id: startResp.session_id,
      finish_login_request: toBase64Url(finishResult.finishLoginRequest),
    },
    baseUrl,
  );

  return { accessToken: finishResp.access_token, role: finishResp.role };
}
