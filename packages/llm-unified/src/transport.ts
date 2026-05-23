// SPDX-License-Identifier: LGPL-3.0-only
import type { ProviderConfig } from './types.js';

export interface BuildRequestArgs {
  provider: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  path: string;
  method: 'GET' | 'POST';
  body?: unknown;
}

/**
 * Build a fetch-ready Request for the given provider. The Request's URL
 * and headers reflect the routing choice — direct fetch hits the upstream
 * with a Bearer Authorization header; via-cors-proxy routes through
 * Chris's generic CORS forwarder (`../cors-proxy/README.md` § Client
 * usage) with the proxy headers in place.
 */
export function buildRequest(args: BuildRequestArgs): Request {
  const { provider, apiKey, corsProxyUrl, corsProxyKey, path, method, body } = args;
  const headers = new Headers({ Authorization: `Bearer ${apiKey}` });
  if (method === 'POST') headers.set('Content-Type', 'application/json');

  let url: string;
  if (provider.routing.kind === 'direct') {
    url = joinUrl(provider.baseUrl, path);
  } else {
    if (!corsProxyUrl) {
      throw new Error('transport: cors-proxy routing selected but cors-proxy URL is missing');
    }
    if (!corsProxyKey) {
      throw new Error('transport: cors-proxy routing selected but cors-proxy key is missing');
    }
    url = joinUrl(corsProxyUrl, path);
    headers.set('x-cors-proxy-api-key', corsProxyKey);
    headers.set('x-cors-proxy-target', provider.baseUrl);
  }

  return new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}
