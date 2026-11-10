// SPDX-License-Identifier: AGPL-3.0-only
import { MCP_PROTOCOL_VERSION } from '../protocol.js';
import type { OAuthFetch } from './oauth-fetch.js';
import { OAuthError, assertSecureEndpoint, canonicalResource } from './url.js';
import { parseBearerChallenge } from './www-authenticate.js';

/** Everything the sign-in needs to know about a server that speaks OAuth. */
export type OAuthDiscovery = {
  kind: 'oauth';
  resource: string;
  issuer: string;
  resourceName: string | null;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string | null;
  revocationEndpoint: string | null;
  cimdSupported: boolean;
  issParameterSupported: boolean;
  scope: string | null;
  /** True when any of the sign-in details had to be fetched through the proxy. */
  viaProxy: boolean;
};

/** Outcome of probing a server: OAuth, or a plain key server. */
export type DiscoveryResult = OAuthDiscovery | { kind: 'no-oauth' };

const MAX_METADATA_BYTES = 256 * 1024;

type Json = Record<string, unknown>;
type Read = { status: 'ok'; value: Json } | { status: 'missing' } | { status: 'invalid' };

/** Reads a body, giving up past the cap however large Content-Length claims it to be. */
async function readCapped(response: Response): Promise<string | null> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_METADATA_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

async function readJsonObject(response: Response): Promise<Read> {
  if (response.status < 200 || response.status >= 300) {
    await response.body?.cancel();
    return { status: 'missing' };
  }
  const text = await readCapped(response);
  if (text === null) return { status: 'invalid' };
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { status: 'ok', value: parsed as Json };
    }
  } catch {
    // fall through
  }
  return { status: 'invalid' };
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Adds `offline_access` only to a non-empty scope and only if the server lists it. */
function composeScope(base: string | null, asScopes: string[]): string | null {
  if (base === null || base.trim() === '') return null;
  const parts = base.split(/\s+/).filter(Boolean);
  if (asScopes.includes('offline_access') && !parts.includes('offline_access')) {
    parts.push('offline_access');
  }
  // A lone offline_access asks for nothing the user could recognise; send no scope instead.
  if (parts.length === 1 && parts[0] === 'offline_access') return null;
  return parts.join(' ');
}

/**
 * Finds out whether an MCP server wants OAuth, in the specification's order (spec §7):
 * probe, protected resource metadata, authorisation server metadata, scope.
 */
export async function discoverOAuth(
  url: string,
  deps: { oauthFetch: OAuthFetch; route: 'direct' | 'proxy'; hasProxy: boolean },
): Promise<DiscoveryResult> {
  const { oauthFetch, route, hasProxy } = deps;
  const resource = canonicalResource(url);
  // Before the probe: a token minted for a plaintext resource could never be used (spec §8).
  assertSecureEndpoint(resource, 'MCP server');
  const resourceUrl = new URL(resource);

  // 1. Probe. Only a 401 starts OAuth.
  let probe: Response;
  try {
    probe = await oauthFetch(
      resource,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: 'chatsundere', version: '0.1.0' },
          },
        }),
      },
      { route },
    );
  } catch (err) {
    if (err instanceof OAuthError) throw err;
    throw new OAuthError('network', "Couldn't reach this server.");
  }
  await probe.body?.cancel();
  if (probe.status !== 401) return { kind: 'no-oauth' };
  const challenge = parseBearerChallenge(probe.headers.get('www-authenticate') ?? '');

  // A GET spends nothing, so trying direct and then the proxy cannot lose a credential.
  // The probe's route is deliberately not reused: a probe that needed the proxy says
  // nothing about whether these documents do.
  const getDirectFirst = async (
    target: string,
  ): Promise<{ read: Read; viaProxy: boolean } | 'network'> => {
    const attempt = async (r: 'direct' | 'proxy'): Promise<Read> =>
      readJsonObject(await oauthFetch(target, { method: 'GET' }, { route: r }));
    try {
      return { read: await attempt('direct'), viaProxy: false };
    } catch (err) {
      if (!(err instanceof TypeError) || !hasProxy) return 'network';
    }
    try {
      return { read: await attempt('proxy'), viaProxy: true };
    } catch {
      return 'network';
    }
  };

  // 2. Protected resource metadata: the challenge's pointer, then the two well-known paths.
  let prm: Json | null = null;
  let viaProxy = false;
  if (challenge?.resourceMetadata !== undefined) {
    assertSecureEndpoint(challenge.resourceMetadata, 'resource metadata');
    // The server named this document itself, so a network failure is not "no OAuth".
    const got = await getDirectFirst(challenge.resourceMetadata);
    if (got === 'network') {
      throw new OAuthError('network', "Couldn't reach this server's sign-in details.");
    }
    if (got.read.status === 'invalid') {
      throw new OAuthError('bad-metadata', "This server's sign-in details could not be read.");
    }
    if (got.read.status === 'ok') {
      prm = got.read.value;
      viaProxy = got.viaProxy;
    }
  }
  if (prm === null) {
    const wk = `${resourceUrl.origin}/.well-known/oauth-protected-resource`;
    const guesses = resourceUrl.pathname === '/' ? [wk] : [`${wk}${resourceUrl.pathname}`, wk];
    for (const guess of guesses) {
      const got = await getDirectFirst(guess);
      // A guessed path that is unreachable or answers with junk is just a server without OAuth.
      if (got !== 'network' && got.read.status === 'ok') {
        prm = got.read.value;
        viaProxy = got.viaProxy;
        break;
      }
    }
  }
  if (prm === null) return { kind: 'no-oauth' };

  // 3. The resource it describes must be the one the user entered.
  const prmResource = str(prm.resource);
  let sameResource = false;
  try {
    sameResource = prmResource !== null && canonicalResource(prmResource) === resource;
  } catch {
    sameResource = false;
  }
  if (!sameResource) {
    throw new OAuthError(
      'resource-mismatch',
      'This server describes itself as a different address, so signing in was stopped.',
    );
  }

  // 4. Authorisation server: the first entry, RFC 8414 then OIDC.
  const issuer = strings(prm.authorization_servers)[0];
  if (issuer === undefined) {
    throw new OAuthError('bad-metadata', 'This server does not name an authorisation server.');
  }
  assertSecureEndpoint(issuer, 'authorisation server');
  const issuerUrl = new URL(issuer);
  const issuerPath = issuerUrl.pathname === '/' ? '' : issuerUrl.pathname.replace(/\/$/, '');
  const asWk = `${issuerUrl.origin}/.well-known`;
  const candidates =
    issuerPath === ''
      ? [`${asWk}/oauth-authorization-server`, `${asWk}/openid-configuration`]
      : [
          `${asWk}/oauth-authorization-server${issuerPath}`,
          `${asWk}/openid-configuration${issuerPath}`,
          `${issuerUrl.origin}${issuerPath}/.well-known/openid-configuration`,
        ];

  let meta: Json | null = null;
  let asViaProxy = false;
  let sawNetworkFailure = false;
  let sawInvalid = false;
  for (const candidate of candidates) {
    const got = await getDirectFirst(candidate);
    if (got === 'network') {
      sawNetworkFailure = true;
    } else if (got.read.status === 'invalid') {
      // Another candidate may still serve a proper document.
      sawInvalid = true;
    } else if (got.read.status === 'ok') {
      meta = got.read.value;
      asViaProxy = got.viaProxy;
      break;
    }
  }
  if (meta === null) {
    if (sawInvalid) {
      throw new OAuthError('bad-metadata', "This server's sign-in details could not be read.");
    }
    if (sawNetworkFailure) {
      throw new OAuthError('network', "Couldn't reach this server's sign-in service.");
    }
    throw new OAuthError('bad-metadata', "This server's sign-in details could not be found.");
  }

  if (meta.issuer !== issuer) {
    throw new OAuthError(
      'issuer-mismatch',
      'The sign-in service does not match the one this server named, so signing in was stopped.',
    );
  }
  if (!strings(meta.code_challenge_methods_supported).includes('S256')) {
    throw new OAuthError(
      'no-pkce',
      "This server's sign-in does not support the required protection (PKCE).",
    );
  }

  const authorizationEndpoint = str(meta.authorization_endpoint);
  const tokenEndpoint = str(meta.token_endpoint);
  if (authorizationEndpoint === null || tokenEndpoint === null) {
    throw new OAuthError('bad-metadata', "This server's sign-in details are incomplete.");
  }
  const registrationEndpoint = str(meta.registration_endpoint);
  const revocationEndpoint = str(meta.revocation_endpoint);
  assertSecureEndpoint(authorizationEndpoint, 'authorisation');
  assertSecureEndpoint(tokenEndpoint, 'token');
  if (registrationEndpoint !== null) assertSecureEndpoint(registrationEndpoint, 'registration');
  if (revocationEndpoint !== null) assertSecureEndpoint(revocationEndpoint, 'revocation');

  // 5. Scope: challenge, then scopes_supported, then none.
  const prmScopes = strings(prm.scopes_supported);
  const challengeScope = challenge?.scope?.trim() ? challenge.scope : null;
  const base = challengeScope ?? (prmScopes.length > 0 ? prmScopes.join(' ') : null);

  return {
    kind: 'oauth',
    resource,
    issuer,
    resourceName: str(prm.resource_name),
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint,
    revocationEndpoint,
    cimdSupported: meta.client_id_metadata_document_supported === true,
    issParameterSupported: meta.authorization_response_iss_parameter_supported === true,
    scope: composeScope(base, strings(meta.scopes_supported)),
    viaProxy: viaProxy || asViaProxy,
  };
}
