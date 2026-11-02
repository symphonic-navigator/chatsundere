// SPDX-License-Identifier: AGPL-3.0-only
import { s256Challenge } from '../../../src/mcp/oauth/pkce.js';

/**
 * In-memory MCP server plus OAuth authorisation server, served through a fake `fetch`.
 *
 * Direct versus proxy: a request whose URL starts with `state.urls.proxyBase` is a
 * proxied one. Like the real proxy it names its real target in the
 * `x-cors-proxy-target` header (an origin), and the path is appended to the proxy base.
 * Every other request is direct. CORS only applies to direct requests, which is why
 * `createOAuthFetch` and this fixture have to agree on that URL shape.
 *
 * With `cors: false` a direct request fails with a TypeError, as a browser's CORS
 * rejection does. A request carrying `MCP-Protocol-Version` stands for one that
 * needs a preflight: it fails WITHOUT being processed. A direct POST without it is a
 * "simple" request: the server processes it, then the client still sees a TypeError.
 * A direct GET fails unprocessed (it would spend nothing anyway).
 *
 * Refresh rotation, checked in this order (spec §5, Kumbu²-style):
 * 1. A token that belongs to an EARLIER family while a newer family is live revokes the
 *    live family, whether or not the earlier family is itself already revoked.
 * 2. An unknown token, or one of a revoked family, is `invalid_grant`.
 * 3. A used token inside `graceSeconds` (strictly less) replays its successor; at or
 *    after the grace, including `graceSeconds: 0`, it revokes the family.
 * 4. With `rotate: false` the presented token is never marked used.
 * Access tokens of a revoked family are rejected at the MCP endpoint.
 */
export type FakeAuthOptions = {
  cimd?: boolean;
  dcr?: boolean;
  dcrDemandsSecret?: boolean;
  pkce?: boolean;
  graceSeconds?: number;
  issueRefresh?: boolean;
  rotate?: boolean;
  advertiseIss?: boolean;
  wrongIssuer?: boolean;
  wrongPrmResource?: boolean;
  insecureEndpoints?: boolean;
  authorisationEndpoint?: string;
  cors?: boolean;
  expiresIn?: number | null;
  codeLifetimeSeconds?: number;
  /** Where the protected resource metadata lives; `open-200` makes the probe answer 200. */
  metadata?: 'header' | 'well-known-path' | 'well-known-root' | 'none' | 'open-200';
  asMetadata?: 'rfc8414' | 'oidc';
  /** Raw body served for the authorisation server metadata documents (hostile-input tests). */
  metadataBody?: string;
  loseNextTokenResponse?: boolean;
  /** Scope named in the 401 challenge. */
  challengeScope?: string;
  /** `scopes_supported` of the protected resource metadata. */
  prmScopes?: string[];
  /** `scopes_supported` of the authorisation server metadata. */
  asScopes?: string[];
  /** Injectable clock in milliseconds; defaults to `Date.now`. */
  now?: () => number;
};

export type RefreshAttempt = {
  /** The refresh token presented. Fake values only. */
  token: string;
  route: 'direct' | 'proxy';
  outcome: 'ok' | 'replayed' | 'invalid_grant' | 'reuse-revoked' | 'stale-family-revoked';
  at: number;
};

type Family = { id: number; revoked: boolean };
type RefreshRecord = {
  family: Family;
  used: boolean;
  usedAt: number;
  /** Response handed out when the token was spent, replayed inside the grace window. */
  successor: Record<string, unknown> | null;
};
type CodeRecord = {
  challenge: string;
  redirectUri: string;
  clientId: string | null;
  state: string;
  expiresAt: number;
  used: boolean;
  scope: string | null;
};

export type AuthoriseParams = {
  redirectUri: string;
  state: string;
  /** PKCE S256 challenge the code is bound to. */
  codeChallenge: string;
  clientId?: string;
  scope?: string;
};

export type FakeAuthState = {
  urls: {
    mcp: string;
    issuer: string;
    proxyBase: string;
    authorisation: string;
    token: string;
    registration: string;
    revocation: string;
  };
  /** Every refresh attempt, in order. */
  refreshAttempts: RefreshAttempt[];
  /** True once any family was revoked by reuse detection or `/revoke`. */
  familyRevoked: boolean;
  /** Number of family revocations so far. */
  revocations: number;
  /** Tokens revoked through `/revoke`. */
  revoked: string[];
  registrations: { clientId: string; body: unknown }[];
  /** Requests by route that the server actually processed. */
  processed: { direct: number; proxy: number };
  /** Direct requests rejected as a browser would without ever reaching the server. */
  blockedPreflights: number;
  /** Next N proxied requests are answered with the proxy's own `unauthorized` 401. */
  proxyUnauthorizedNext: number;
  loseNextTokenResponse: boolean;
  /** Paths requested, `METHOD route path`, for assertions about ordering. */
  log: string[];
  /** Mint an authorisation code as the (absent) browser sign-in would. */
  authorise(params: AuthoriseParams): Promise<{ code: string; state: string; iss: string | null }>;
  /** Make every access token expire now. */
  expireAccessTokens(): void;
};

const MCP_HOST = 'mcp.example';
const AS_HOST = 'auth.example';
const PROXY_HOST = 'proxy.example';
const MCP_PATH = '/mcp';

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Builds the fake. `fetch` stands in for both browser `fetch` and the proxy in front of it. */
export function createFakeAuthServer(options: FakeAuthOptions = {}): {
  fetch: typeof fetch;
  state: FakeAuthState;
} {
  const o = {
    cimd: false,
    dcr: true,
    dcrDemandsSecret: false,
    pkce: true,
    graceSeconds: 30,
    issueRefresh: true,
    rotate: true,
    advertiseIss: false,
    wrongIssuer: false,
    wrongPrmResource: false,
    insecureEndpoints: false,
    cors: true,
    expiresIn: 3600 as number | null,
    codeLifetimeSeconds: 60,
    metadata: 'header' as NonNullable<FakeAuthOptions['metadata']>,
    asMetadata: 'rfc8414' as NonNullable<FakeAuthOptions['asMetadata']>,
    ...options,
  };
  const now = options.now ?? Date.now;
  const nowSeconds = (): number => now() / 1000;

  const scheme = o.insecureEndpoints ? 'http' : 'https';
  const asBase = `${scheme}://${AS_HOST}`;
  const urls = {
    mcp: `https://${MCP_HOST}${MCP_PATH}`,
    issuer: `https://${AS_HOST}`,
    proxyBase: `https://${PROXY_HOST}`,
    authorisation: o.authorisationEndpoint ?? `${asBase}/authorize`,
    token: `${asBase}/token`,
    registration: `${asBase}/register`,
    revocation: `${asBase}/revoke`,
  };

  const families: Family[] = [];
  const refreshTokens = new Map<string, RefreshRecord>();
  const accessTokens = new Map<string, { expiresAt: number; family: Family }>();
  const codes = new Map<string, CodeRecord>();
  let counter = 0;
  const next = (prefix: string): string => `${prefix}-${++counter}`;

  const state: FakeAuthState = {
    urls,
    refreshAttempts: [],
    familyRevoked: false,
    revocations: 0,
    revoked: [],
    registrations: [],
    processed: { direct: 0, proxy: 0 },
    blockedPreflights: 0,
    proxyUnauthorizedNext: 0,
    loseNextTokenResponse: o.loseNextTokenResponse ?? false,
    log: [],
    async authorise(params) {
      const code = next('code');
      codes.set(code, {
        challenge: params.codeChallenge,
        redirectUri: params.redirectUri,
        clientId: params.clientId ?? null,
        state: params.state,
        expiresAt: nowSeconds() + o.codeLifetimeSeconds,
        used: false,
        scope: params.scope ?? null,
      });
      return { code, state: params.state, iss: o.advertiseIss ? urls.issuer : null };
    },
    expireAccessTokens() {
      for (const t of accessTokens.values()) t.expiresAt = nowSeconds() - 1;
    },
  };

  const revokeFamily = (family: Family): void => {
    if (!family.revoked) {
      family.revoked = true;
      state.familyRevoked = true;
      state.revocations++;
    }
  };

  const issuePair = (
    family: Family,
    scope: string | null,
    previousRefresh: string | null,
  ): Record<string, unknown> => {
    const access = next('at');
    const body: Record<string, unknown> = { access_token: access, token_type: 'Bearer' };
    if (o.expiresIn !== null) {
      body.expires_in = o.expiresIn;
      accessTokens.set(access, { expiresAt: nowSeconds() + o.expiresIn, family });
    } else {
      accessTokens.set(access, { expiresAt: Number.POSITIVE_INFINITY, family });
    }
    if (scope) body.scope = scope;
    if (o.issueRefresh && (previousRefresh === null || o.rotate)) {
      const refresh = next('rt');
      refreshTokens.set(refresh, { family, used: false, usedAt: 0, successor: null });
      body.refresh_token = refresh;
    }
    return body;
  };

  const prmUrl = `https://${MCP_HOST}/prm.json`;
  const prmBody = (): unknown => ({
    resource: o.wrongPrmResource ? 'https://other.example/mcp' : urls.mcp,
    authorization_servers: [urls.issuer],
    ...(o.prmScopes ? { scopes_supported: o.prmScopes } : {}),
    resource_name: 'Fake MCP',
  });
  const asMetadataBody = (): unknown => ({
    issuer: o.wrongIssuer ? 'https://evil.example' : urls.issuer,
    authorization_endpoint: urls.authorisation,
    token_endpoint: urls.token,
    ...(o.dcr ? { registration_endpoint: urls.registration } : {}),
    revocation_endpoint: urls.revocation,
    ...(o.pkce ? { code_challenge_methods_supported: ['S256'] } : {}),
    ...(o.cimd ? { client_id_metadata_document_supported: true } : {}),
    ...(o.advertiseIss ? { authorization_response_iss_parameter_supported: true } : {}),
    ...(o.asScopes ? { scopes_supported: o.asScopes } : {}),
  });

  const challenge = (): Response => {
    const parts = ['Bearer realm="fake"'];
    if (o.metadata === 'header') parts.push(`resource_metadata="${prmUrl}"`);
    if (options.challengeScope !== undefined) parts.push(`scope="${options.challengeScope}"`);
    return new Response('', { status: 401, headers: { 'www-authenticate': parts.join(', ') } });
  };

  const handleMcp = (req: { method: string; path: string; headers: Headers }): Response => {
    const wk = '/.well-known/oauth-protected-resource';
    if (req.method === 'GET') {
      const served =
        (o.metadata === 'header' && req.path === '/prm.json') ||
        (o.metadata === 'well-known-path' && req.path === `${wk}${MCP_PATH}`) ||
        (o.metadata === 'well-known-root' && req.path === wk);
      return served ? json(prmBody()) : new Response('not found', { status: 404 });
    }
    if (req.path !== MCP_PATH) return new Response('not found', { status: 404 });
    if (o.metadata === 'open-200') {
      return json({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'Invalid Request' } });
    }
    const auth = req.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const rec = accessTokens.get(token);
    if (!rec || rec.family.revoked || rec.expiresAt <= nowSeconds()) return challenge();
    return json({ jsonrpc: '2.0', id: 1, result: {} });
  };

  const oauthError = (error: string, status = 400): Response => json({ error }, status);

  const handleToken = async (
    form: URLSearchParams,
    route: 'direct' | 'proxy',
  ): Promise<Response> => {
    const grant = form.get('grant_type');
    if (grant === 'authorization_code') {
      const rec = codes.get(form.get('code') ?? '');
      if (!rec || rec.used || rec.expiresAt <= nowSeconds()) return oauthError('invalid_grant');
      rec.used = true;
      if (form.get('redirect_uri') !== rec.redirectUri) return oauthError('invalid_grant');
      if (rec.clientId !== null && form.get('client_id') !== rec.clientId) {
        return oauthError('invalid_client', 401);
      }
      const verifier = form.get('code_verifier') ?? '';
      if (o.pkce && (await s256Challenge(verifier)) !== rec.challenge) {
        return oauthError('invalid_grant');
      }
      const family: Family = { id: families.length + 1, revoked: false };
      families.push(family);
      return json(issuePair(family, rec.scope, null), 200, { 'cache-control': 'no-store' });
    }
    if (grant === 'refresh_token') {
      const presented = form.get('refresh_token') ?? '';
      const attempt = (outcome: RefreshAttempt['outcome']): void => {
        state.refreshAttempts.push({ token: presented, route, outcome, at: now() });
      };
      const rec = refreshTokens.get(presented);
      const live = families[families.length - 1];
      if (rec && live && rec.family !== live) {
        // An earlier sign-in's token arriving while a newer family is live.
        revokeFamily(live);
        attempt('stale-family-revoked');
        return oauthError('invalid_grant');
      }
      if (!rec || rec.family.revoked) {
        attempt('invalid_grant');
        return oauthError('invalid_grant');
      }
      if (rec.used) {
        if (nowSeconds() - rec.usedAt < o.graceSeconds && rec.successor) {
          attempt('replayed');
          return json(rec.successor, 200, { 'cache-control': 'no-store' });
        }
        revokeFamily(rec.family);
        attempt('reuse-revoked');
        return oauthError('invalid_grant');
      }
      if (o.rotate) {
        rec.used = true;
        rec.usedAt = nowSeconds();
      }
      const successor = issuePair(rec.family, null, presented);
      if (o.rotate) rec.successor = successor;
      attempt('ok');
      return json(successor, 200, { 'cache-control': 'no-store' });
    }
    return oauthError('unsupported_grant_type');
  };

  const handleAs = async (
    req: { method: string; path: string; body: string },
    route: 'direct' | 'proxy',
  ): Promise<Response> => {
    if (req.method === 'GET') {
      const rfc = req.path === '/.well-known/oauth-authorization-server';
      const oidc = req.path === '/.well-known/openid-configuration';
      if ((rfc && o.asMetadata === 'rfc8414') || (oidc && o.asMetadata === 'oidc')) {
        if (options.metadataBody !== undefined) {
          return new Response(options.metadataBody, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return json(asMetadataBody());
      }
      return new Response('not found', { status: 404 });
    }
    if (req.path === '/register') {
      if (!o.dcr) return new Response('not found', { status: 404 });
      const body: unknown = JSON.parse(req.body || '{}');
      const clientId = next('client');
      state.registrations.push({ clientId, body });
      return json(
        { client_id: clientId, ...(o.dcrDemandsSecret ? { client_secret: 'fake-secret' } : {}) },
        201,
      );
    }
    if (req.path === '/token') {
      const response = await handleToken(new URLSearchParams(req.body), route);
      if (state.loseNextTokenResponse) {
        state.loseNextTokenResponse = false;
        throw new TypeError('Failed to fetch');
      }
      return response;
    }
    if (req.path === '/revoke') {
      const token = new URLSearchParams(req.body).get('token') ?? '';
      state.revoked.push(token);
      const rec = refreshTokens.get(token);
      if (rec) revokeFamily(rec.family);
      return new Response('', { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };

  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = input instanceof Request ? input : null;
    const url = new URL(raw ? raw.url : String(input));
    const method = (init?.method ?? raw?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers ?? raw?.headers);
    const body =
      typeof init?.body === 'string'
        ? init.body
        : init?.body
          ? String(init.body)
          : raw
            ? await raw.clone().text()
            : '';

    let route: 'direct' | 'proxy' = 'direct';
    let host = url.hostname;
    const path = url.pathname;
    if (host === PROXY_HOST) {
      route = 'proxy';
      if (state.proxyUnauthorizedNext > 0) {
        state.proxyUnauthorizedNext--;
        state.log.push(`${method} proxy-401 ${path}`);
        return json({ error: { code: 'unauthorized', message: 'Request refused' } }, 401);
      }
      const target = headers.get('x-cors-proxy-target');
      if (!target) return json({ error: { code: 'bad_request' } }, 400);
      host = new URL(target).hostname;
    } else if (!o.cors) {
      state.log.push(`${method} direct-blocked ${path}`);
      if (headers.has('mcp-protocol-version') || method === 'GET' || method === 'HEAD') {
        state.blockedPreflights++;
        throw new TypeError('Failed to fetch');
      }
    }

    state.log.push(`${method} ${route} ${host}${path}`);
    state.processed[route]++;
    let response: Response;
    if (host === MCP_HOST) response = handleMcp({ method, path, headers });
    else if (host === AS_HOST) response = await handleAs({ method, path, body }, route);
    else response = new Response('not found', { status: 404 });

    if (route === 'direct' && !o.cors) throw new TypeError('Failed to fetch');
    return response;
  }) as typeof fetch;

  return { fetch: fakeFetch, state };
}
