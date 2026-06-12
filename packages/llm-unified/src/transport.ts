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
  /**
   * Adapter-supplied extra headers, merged on top of the base
   * Authorisation/Content-Type (and any cors-proxy headers). The adapter owns
   * these — e.g. wafer's `Wafer-ZDR: required`.
   */
  extraHeaders?: Record<string, string>;
}

/**
 * Build a fetch-ready Request for the given provider. The Request's URL
 * and headers reflect the routing choice — direct fetch hits the upstream
 * with a Bearer Authorization header; via-cors-proxy routes through
 * Chris's generic CORS forwarder (`../cors-proxy/README.md` § Client
 * usage) with the proxy headers in place.
 */
export function buildRequest(args: BuildRequestArgs): Request {
  const { provider, apiKey, corsProxyUrl, corsProxyKey, path, method, body, extraHeaders } = args;
  const headers = new Headers({ Authorization: `Bearer ${apiKey}` });
  // FormData carries its own multipart boundary — setting Content-Type here
  // would destroy it. Only JSON bodies get the explicit header.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (method === 'POST' && !isForm) headers.set('Content-Type', 'application/json');

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

  // Adapter-supplied headers sit on top of the base/cors-proxy headers.
  if (extraHeaders) {
    for (const [k, value] of Object.entries(extraHeaders)) headers.set(k, value);
  }

  return new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}
