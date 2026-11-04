// SPDX-License-Identifier: AGPL-3.0-only

/** The OAuth Client ID Metadata Document this app publishes at its own origin. */
export interface ClientMetadata {
  client_id: string;
  client_name: string;
  client_uri: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: 'none';
}

/** The URL a server fetches to learn about this app; doubles as the `client_id`. */
export function clientMetadataUrl(origin: string): string {
  return `${origin}/oauth/client-metadata.json`;
}

/** Where the authorisation server sends the browser back to. */
export function redirectUri(origin: string): string {
  return `${origin}/oauth/callback`;
}

/** The metadata document for an origin; nginx generates the same shape from the request host. */
export function buildClientMetadata(origin: string): ClientMetadata {
  return {
    client_id: clientMetadataUrl(origin),
    client_name: 'Chatsundere',
    client_uri: origin,
    redirect_uris: [redirectUri(origin)],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/** Dotted form of an IPv4-mapped IPv6 tail (`::ffff:a.b.c.d` or `::ffff:hhhh:hhhh`), else null. */
function mappedIpv4(inner: string): string | null {
  const m = /^(?:0{0,4}:){2,5}ffff:(.+)$/.exec(inner);
  const tail = m?.[1];
  if (!tail) return null;
  if (tail.includes('.')) return tail;
  const h = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
  if (!h) return null;
  const hi = Number.parseInt(h[1] ?? '', 16);
  const lo = Number.parseInt(h[2] ?? '', 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

const NON_PUBLIC_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa'];

/**
 * Whether a public authorisation server could fetch our metadata document.
 * False means the app must go straight to dynamic registration instead.
 */
export function isPubliclyFetchableOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  // `localhost.` and `box.local.` are the same names with a root dot.
  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  if (host === 'localhost' || NON_PUBLIC_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return false;
  }
  if (isPrivateIpv4(host)) return false;
  if (host.startsWith('[')) {
    // IPv6 literals: loopback, unique-local and link-local are never public.
    const inner = host.slice(1, -1);
    const mapped = mappedIpv4(inner);
    if (mapped !== null) return !isPrivateIpv4(mapped);
    return !(inner === '::1' || inner === '::' || /^f[cd]/.test(inner) || /^fe[89ab]/.test(inner));
  }
  return host.includes('.');
}
