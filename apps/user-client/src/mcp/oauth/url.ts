// SPDX-License-Identifier: AGPL-3.0-only

/** Failure categories of the OAuth flow; the UI maps each to readable copy. */
export type OAuthErrorKind =
  | 'not-secure'
  | 'bad-metadata'
  | 'no-pkce'
  | 'resource-mismatch'
  | 'issuer-mismatch'
  | 'no-client-identity'
  | 'registration-refused'
  | 'state-mismatch'
  | 'exchange-failed'
  | 'invalid-grant'
  | 'network';

/** Error raised by the OAuth layer. Its message never contains a token, code or verifier. */
export class OAuthError extends Error {
  readonly kind: OAuthErrorKind;

  constructor(kind: OAuthErrorKind, message: string) {
    super(message);
    this.name = 'OAuthError';
    this.kind = kind;
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseUrl(url: string, label: string): URL {
  try {
    return new URL(url);
  } catch {
    // The raw input is deliberately left out of the message: it may be attacker-supplied.
    throw new OAuthError('bad-metadata', `The ${label} URL is not valid.`);
  }
}

/**
 * Canonical form of an MCP resource URL, used as the OAuth `resource` and as
 * the identity of a connection: lowercase scheme and host, no default port,
 * one trailing slash dropped, path kept exactly, no fragment.
 */
export function canonicalResource(url: string): string {
  const u = parseUrl(url, 'resource');
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new OAuthError('bad-metadata', 'The resource URL must use http or https.');
  }
  if (u.username !== '' || u.password !== '') {
    throw new OAuthError('bad-metadata', 'The resource URL must not contain credentials.');
  }
  const path = u.pathname.endsWith('/') ? u.pathname.slice(0, -1) : u.pathname;
  return `${u.protocol}//${u.host}${path}${u.search}`;
}

/** Refuses any OAuth endpoint that is not https (or loopback http in development). */
export function assertSecureEndpoint(url: string, label: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new OAuthError('not-secure', `The ${label} endpoint is not a valid URL.`);
  }
  if (u.username !== '' || u.password !== '') {
    throw new OAuthError('not-secure', `The ${label} endpoint must not contain credentials.`);
  }
  if (u.protocol === 'https:') return;
  if (u.protocol === 'http:' && import.meta.env.DEV && LOOPBACK_HOSTS.has(u.hostname)) return;
  throw new OAuthError('not-secure', `The ${label} endpoint must use https.`);
}
