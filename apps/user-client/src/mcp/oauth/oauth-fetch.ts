// SPDX-License-Identifier: AGPL-3.0-only
import { getProxyAuthSource } from '@chatsundere/llm-unified';
import { MCP_PROTOCOL_VERSION } from '../protocol.js';
import { OAuthError } from './url.js';

const MAX_401_BODY_BYTES = 4 * 1024;

/** Fetch for OAuth traffic; `route` is chosen by the caller and never switched here. */
export type OAuthFetch = (
  url: string,
  init: RequestInit,
  opts: { route: 'direct' | 'proxy' },
) => Promise<Response>;

function joinUrl(base: string, path: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${b}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * True for the proxy's own `unauthorized` refusal, as opposed to an upstream 401.
 * An upstream could imitate this body shape and earn one resend; that is accepted per plan.
 * The body is read through its stream and capped, so a hostile upstream cannot make this
 * buffer a large payload; anything over the cap or unparsable is not a proxy-level 401.
 */
export async function isProxyUnauthorised(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  try {
    const reader = response.clone().body?.getReader();
    if (!reader) return false;
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_401_BODY_BYTES) {
        // Not awaited: a cancelled tee branch only settles once the original body is dropped too.
        void reader.cancel().catch(() => undefined);
        return false;
      }
      chunks.push(value);
    }
    const all = new Uint8Array(bytes);
    let offset = 0;
    for (const c of chunks) {
      all.set(c, offset);
      offset += c.byteLength;
    }
    const body = JSON.parse(new TextDecoder().decode(all)) as {
      error?: { code?: unknown };
    } | null;
    return body?.error?.code === 'unauthorized';
  } catch {
    return false;
  }
}

/**
 * Builds the OAuth fetch wrapper. It deliberately does not use `fetchWithProxyAuth`,
 * which retries any 401: an upstream 401 would resend an OAuth request that was already
 * consumed, so only the proxy's own 401 is retried here.
 */
export function createOAuthFetch(deps: { fetch?: typeof fetch } = {}): OAuthFetch {
  const doFetch = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  const direct: OAuthFetch = (url, init) => {
    const headers = new Headers(init.headers);
    if ((init.method ?? 'GET').toUpperCase() === 'POST') {
      headers.set('MCP-Protocol-Version', MCP_PROTOCOL_VERSION);
    }
    return doFetch(url, { ...init, headers, redirect: 'error' });
  };

  const buildProxied = (url: string, init: RequestInit): [string, RequestInit] => {
    const source = getProxyAuthSource();
    const proxyUrl = source?.getUrl() ?? null;
    const token = source?.getToken() ?? null;
    if (proxyUrl === null || token === null) {
      throw new OAuthError('network', 'No linked server is available to relay this request.');
    }
    const target = new URL(url);
    const headers = new Headers(init.headers);
    headers.set('x-chatsundere-authorization', `Bearer ${token}`);
    headers.set('x-cors-proxy-target', target.origin);
    headers.set('x-cors-proxy-kind', 'mcp');
    return [
      joinUrl(proxyUrl, target.pathname + target.search),
      { ...init, headers, redirect: 'manual' },
    ];
  };

  const proxied: OAuthFetch = async (url, init) => {
    let response = await doFetch(...buildProxied(url, init));
    if (await isProxyUnauthorised(response)) {
      const fresh = await getProxyAuthSource()?.refreshToken();
      if (fresh !== null && fresh !== undefined) {
        await response.body?.cancel();
        response = await doFetch(...buildProxied(url, init));
      }
    }
    return response;
  };

  return (url, init, opts) =>
    opts.route === 'direct' ? direct(url, init, opts) : proxied(url, init, opts);
}
