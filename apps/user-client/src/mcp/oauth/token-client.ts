// SPDX-License-Identifier: AGPL-3.0-only
import type { OAuthDiscovery } from './discovery.js';
import type { OAuthFetch } from './oauth-fetch.js';
import { OAuthError, type OAuthErrorKind, assertSecureEndpoint } from './url.js';

/** Tokens as the authorisation server issued them. */
export type TokenSet = {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch milliseconds, or null when the server stated no lifetime. */
  accessExpiresAt: number | null;
  scope: string | null;
};

/** Collaborators of every call here; `now` exists so tests can fix the clock. */
export type TokenDeps = {
  oauthFetch: OAuthFetch;
  hasProxy: boolean;
  now?: (() => number) | undefined;
};

type Route = 'direct' | 'proxy';

/** Per-request timeout; a refresh that times out is a lost response (spec §5). */
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const FORM_HEADERS = {
  'content-type': 'application/x-www-form-urlencoded',
  accept: 'application/json',
};

type Answer = { status: number; ok: boolean; body: string | null };

/** Reads a body up to the cap; null when it is larger. Content-Length is not trusted. */
async function readCapped(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      void reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(bytes);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/**
 * One request under the internal timeout. Rejects with whatever the fetch raised
 * (TypeError, AbortError); the timer is always cleared. The caller's `signal` only
 * exists for tests of the timeout and is merged into the internal controller.
 */
async function send(
  deps: TokenDeps,
  url: string,
  init: RequestInit,
  route: Route,
  signal?: AbortSignal,
): Promise<Answer> {
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await deps.oauthFetch(url, { ...init, signal: controller.signal }, { route });
    const status = response.status;
    const ok = response.ok;
    let body: string | null;
    try {
      body = await readCapped(response);
    } catch {
      // Distinct from a failure before any response: the server has already answered, so
      // the exchange must not be retried on another route.
      throw new OAuthError('network', 'The response from the server was cut off.');
    }
    return { status, ok, body };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

function parseJson(body: string | null): Record<string, unknown> | null {
  if (body === null) return null;
  try {
    const v: unknown = JSON.parse(body);
    return typeof v === 'object' && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Strict token response parsing; null when it is not a usable Bearer token response. */
function parseTokens(
  body: string | null,
  now: number,
  keepRefresh: string | null,
): TokenSet | null {
  const j = parseJson(body);
  if (!j) return null;
  const access = j.access_token;
  const type = j.token_type;
  if (typeof access !== 'string' || access === '') return null;
  if (typeof type !== 'string' || type.toLowerCase() !== 'bearer') return null;
  const refresh =
    typeof j.refresh_token === 'string' && j.refresh_token !== '' ? j.refresh_token : null;
  const life = j.expires_in;
  const expires =
    typeof life === 'number' && Number.isFinite(life) && life >= 0 ? now + life * 1000 : null;
  return {
    accessToken: access,
    refreshToken: refresh ?? keepRefresh,
    accessExpiresAt: expires,
    scope: typeof j.scope === 'string' && j.scope !== '' ? j.scope : null,
  };
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/** Maps a transport failure to a `network` error; anything unexpected is rethrown. */
function asNetworkError(err: unknown, what: string): OAuthError {
  if (err instanceof OAuthError) return err;
  if (err instanceof TypeError || isAbort(err)) {
    return new OAuthError('network', `The ${what} request did not complete.`);
  }
  throw err;
}

/** Registers Chatsundere as a public client (RFC 7591); never accepts a client secret. */
export async function registerClient(
  d: OAuthDiscovery,
  redirectUri: string,
  deps: TokenDeps,
): Promise<{ clientId: string }> {
  if (d.registrationEndpoint === null) {
    throw new OAuthError('registration-refused', 'This server only accepts approved apps.');
  }
  const endpoint = d.registrationEndpoint;
  assertSecureEndpoint(endpoint, 'registration');
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'Chatsundere',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  };
  const attempt = (route: Route): Promise<Answer> => send(deps, endpoint, init, route);
  let answer: Answer;
  try {
    answer = await attempt('direct');
  } catch (err) {
    // Registration spends nothing, so a refused direct attempt may simply go via the proxy.
    if (!(err instanceof TypeError) || !deps.hasProxy) throw asNetworkError(err, 'registration');
    try {
      answer = await attempt('proxy');
    } catch (err2) {
      throw asNetworkError(err2, 'registration');
    }
  }
  const j = parseJson(answer.body);
  const clientId = j?.client_id;
  if (!answer.ok || !j || typeof clientId !== 'string' || clientId === '') {
    throw new OAuthError('registration-refused', 'This server refused to register the app.');
  }
  const method = j.token_endpoint_auth_method;
  if (j.client_secret !== undefined || (method !== undefined && method !== 'none')) {
    throw new OAuthError(
      'registration-refused',
      'This server only accepts approved apps (it requires a client secret).',
    );
  }
  return { clientId };
}

/**
 * Exchanges an authorisation code. Only a TypeError on the direct attempt (a refused
 * preflight, so nothing was sent) falls through to the proxy; an answered error never does.
 */
export async function exchangeCode(
  args: {
    tokenEndpoint: string;
    code: string;
    verifier: string;
    clientId: string;
    redirectUri: string;
    resource: string;
  },
  deps: TokenDeps,
): Promise<{ tokens: TokenSet; tokenRoute: Route }> {
  assertSecureEndpoint(args.tokenEndpoint, 'token');
  const init: RequestInit = {
    method: 'POST',
    headers: FORM_HEADERS,
    body: formBody({
      grant_type: 'authorization_code',
      code: args.code,
      code_verifier: args.verifier,
      client_id: args.clientId,
      redirect_uri: args.redirectUri,
      resource: args.resource,
    }),
  };
  let route: Route = 'direct';
  let answer: Answer;
  try {
    answer = await send(deps, args.tokenEndpoint, init, 'direct');
  } catch (err) {
    if (!(err instanceof TypeError) || !deps.hasProxy) throw asNetworkError(err, 'sign-in');
    route = 'proxy';
    try {
      answer = await send(deps, args.tokenEndpoint, init, 'proxy');
    } catch (err2) {
      throw asNetworkError(err2, 'sign-in');
    }
  }
  const now = (deps.now ?? Date.now)();
  const tokens = answer.ok ? parseTokens(answer.body, now, null) : null;
  if (!tokens) {
    throw new OAuthError(
      'exchange-failed',
      `The server did not accept the sign-in (HTTP ${answer.status}).`,
    );
  }
  return { tokens, tokenRoute: route };
}

/**
 * Rotates a refresh token on the given route and never switches it: a refresh that may
 * have reached the server must not be repeated elsewhere. `invalid-grant` means the grant
 * is dead, `network` a lost response, `refresh-failed` any other answered error.
 */
export async function refreshTokens(
  args: {
    tokenEndpoint: string;
    refreshToken: string;
    clientId: string;
    resource: string;
    route: Route;
    signal?: AbortSignal | undefined;
  },
  deps: TokenDeps,
): Promise<TokenSet> {
  assertSecureEndpoint(args.tokenEndpoint, 'token');
  const init: RequestInit = {
    method: 'POST',
    headers: FORM_HEADERS,
    body: formBody({
      grant_type: 'refresh_token',
      refresh_token: args.refreshToken,
      client_id: args.clientId,
      resource: args.resource,
    }),
  };
  let answer: Answer;
  try {
    answer = await send(deps, args.tokenEndpoint, init, args.route, args.signal);
  } catch (err) {
    // The request may have reached the server, so whatever went wrong is a lost response.
    if (err instanceof OAuthError) throw err;
    throw new OAuthError('network', 'The refresh request did not complete.');
  }
  if (answer.ok) {
    const tokens = parseTokens(answer.body, (deps.now ?? Date.now)(), args.refreshToken);
    if (!tokens) {
      // A 200 means the server accepted the token and may have rotated it: treat as lost.
      throw new OAuthError('network', 'The refresh response could not be read.');
    }
    return tokens;
  }
  const kind: OAuthErrorKind =
    parseJson(answer.body)?.error === 'invalid_grant' ? 'invalid-grant' : 'refresh-failed';
  throw new OAuthError(
    kind,
    kind === 'invalid-grant'
      ? 'The server no longer accepts this sign-in.'
      : `The server could not refresh the sign-in (HTTP ${answer.status}).`,
  );
}

/** Best-effort RFC 7009 revocation of a refresh token; true only on a 200, never throws. */
export async function revokeToken(
  args: { revocationEndpoint: string; token: string; clientId: string; route: Route },
  deps: TokenDeps,
): Promise<boolean> {
  try {
    assertSecureEndpoint(args.revocationEndpoint, 'revocation');
    const answer = await send(
      deps,
      args.revocationEndpoint,
      {
        method: 'POST',
        headers: FORM_HEADERS,
        body: formBody({
          token: args.token,
          token_type_hint: 'refresh_token',
          client_id: args.clientId,
        }),
      },
      args.route,
    );
    return answer.status === 200;
  } catch {
    return false;
  }
}
