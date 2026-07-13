// SPDX-License-Identifier: LGPL-3.0-only

import { opaqueServerIdentity } from '@chatsundere/shared-types';
import { getLinkedAccount, putLinkedAccount } from '../db/linked-account.js';
import { getLocalAccount, requireLocalAccount } from '../db/local-account.js';
import type { LinkedAccountRow } from '../db/schema.js';
import { toBase64Url } from '../encoding/base64url.js';
import { opaqueLoginFinish, opaqueLoginStart } from '../opaque/client.js';
import type { ServerClient } from '../server-client.js';
import { type MasterKeySession, createMasterKeySession } from '../session.js';
import { type MasterKey, asMasterKey } from '../types.js';
import { loginLocalWithPassphrase } from './login-local.js';

export interface LoginOnlineLinkedArgs {
  db: IDBDatabase;
  serverClient: ServerClient;
  passphrase: string;
}

/**
 * Discriminated outcome for the server leg of a double-auth login.
 *
 * - `ok`           — OPAQUE round-trip completed and produced an access token.
 * - `rate_limited` — server answered 429; it is reachable but throttling us.
 *                    Degrade to offline, but surface an honest "too many
 *                    attempts, try again shortly" signal — never "unreachable".
 * - `unreachable`  — 5xx, network error, or timeout; degrade to offline.
 * - `auth_failed`  — server returned 401; the passphrase may have been changed
 *                    elsewhere; degrade to offline with a specific banner.
 * - `skipped`      — no linked account exists; server was never contacted.
 */
export type ServerOutcome =
  | { kind: 'ok' }
  | { kind: 'rate_limited'; retryAfterSeconds?: number }
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
    linked ? runServerLogin(args, local.username, linked) : Promise.resolve(null),
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
  //
  // `mk` and `localSession` share one underlying buffer (login-local returns
  // both from a single unwrap). `close()` zeroes that buffer, so copy the key
  // into a fresh buffer BEFORE closing — otherwise the online session and the
  // returned key would both be all-zero, and the downstream identity check
  // would treat the store as a foreign identity and wipe the local data.
  const onlineMk = asMasterKey(mk.slice());
  localSession.close();

  const { accessToken, role } = resolvedServer.value;
  return {
    session: createMasterKeySession({
      mk: onlineMk,
      userId: linked.server_user_id,
      username: local.username,
      mode: 'linked',
      online: true,
      role,
      accessToken,
    }),
    mk: onlineMk,
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

/**
 * Returns true for a genuine authentication failure: a server 401, or a
 * client-side OPAQUE credential rejection (`wrong_passphrase`). The latter
 * carries no HTTP status, so without the code check it would fall through to a
 * misleading `unreachable` outcome ("Could not reach the server") instead of
 * `auth_failed` ("wrong passphrase").
 */
function isAuthFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { status?: unknown; code?: unknown };
  return e.status === 401 || e.code === 'wrong_passphrase';
}

/**
 * Returns the retry-after hint (seconds) when the server answered 429, or
 * `undefined` for any other error. A 429 means the server is reachable but
 * throttling — it must NOT collapse into the misleading `unreachable` outcome,
 * which would tell the user their server is down when it is merely busy.
 */
function rateLimitHint(error: unknown): { retryAfterSeconds?: number } | null {
  if (typeof error !== 'object' || error === null) return null;
  const e = error as { status?: unknown; code?: unknown; retryAfterSeconds?: unknown };
  if (e.status !== 429 && e.code !== 'rate_limited') return null;
  return {
    retryAfterSeconds: typeof e.retryAfterSeconds === 'number' ? e.retryAfterSeconds : undefined,
  };
}

function classifyServerOutcome(
  linked: Awaited<ReturnType<typeof getLinkedAccount>>,
  result: ReflectOk<unknown> | ReflectErr,
): ServerOutcome {
  if (!linked) return { kind: 'skipped' };
  if (result.ok) return { kind: 'ok' };
  if (isAuthFailure(result.error)) return { kind: 'auth_failed' };
  const rateLimited = rateLimitHint(result.error);
  if (rateLimited) return { kind: 'rate_limited', ...rateLimited };
  return { kind: 'unreachable' };
}

async function runServerLogin(
  args: LoginOnlineLinkedArgs,
  liveUsername: string,
  linked: LinkedAccountRow,
): Promise<{ accessToken: string; role: 'primary_admin' | 'admin' | 'user' } | null> {
  const serverId = opaqueServerIdentity(linked.base_url);

  // OPAQUE binds the client identifier baked in at registration/link time
  // (auth-service `auth_methods.opaque_client_identifier`); a later username
  // change must not desynchronise this. Fall back to the live username only
  // for legacy rows linked before this field existed — self-healed below.
  const clientIdentifier = linked.opaque_client_identifier ?? liveUsername;

  const { clientLoginState, startLoginRequest } = await opaqueLoginStart(args.passphrase);

  // /opaque/login/start looks the account up by the LIVE username; only the
  // OPAQUE ceremony itself needs the frozen identifier.
  const startResp = await args.serverClient.loginOpaqueStart(
    { username: liveUsername, start_login_request: startLoginRequest },
    linked.base_url,
  );

  const finishResult = await opaqueLoginFinish({
    clientLoginState,
    loginResponse: startResp.login_response,
    passphrase: args.passphrase,
    username: clientIdentifier,
    serverIdentity: serverId,
  });

  const finishResp = await args.serverClient.loginOpaqueFinish(
    {
      session_id: startResp.session_id,
      finish_login_request: toBase64Url(finishResult.finishLoginRequest),
    },
    linked.base_url,
  );

  // Self-heal: a legacy row has no frozen identifier yet. This round just
  // proved `clientIdentifier` authenticates, so persist it now — otherwise
  // this account would stay one step from bricking at the next rename.
  if (!linked.opaque_client_identifier) {
    await putLinkedAccount(args.db, { ...linked, opaque_client_identifier: clientIdentifier });
  }

  return { accessToken: finishResp.access_token, role: finishResp.role };
}
