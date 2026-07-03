// SPDX-License-Identifier: LGPL-3.0-only
import { getProxyAuthSource } from './proxy-auth.js';

/** Thrown when a proxied upstream replied with a redirect the browser cannot expose (spec §5). */
export class ProxyRedirectError extends Error {
  constructor() {
    super(
      "This provider tried to redirect the request, which can't be followed safely. " +
        'If you set a custom base URL for it, double-check it — otherwise the provider may have moved.',
    );
    this.name = 'ProxyRedirectError';
  }
}

/** True for the opaque husk fetch returns when a manual-redirect request hit a 3xx. */
export function isOpaqueRedirect(response: Response): boolean {
  return response.type === 'opaqueredirect' || response.status === 0;
}

/**
 * Fetch with proxy-auth semantics: when `proxied`, a 401 triggers one token
 * refresh + rebuild (the rebuild re-reads the source, so it carries the fresh
 * token), and an opaque redirect becomes a terminal ProxyRedirectError.
 * `proxied: false` degrades to a plain fetch — a direct upstream's 401 must
 * never spend an account-token refresh.
 */
export async function fetchWithProxyAuth(
  build: () => Request,
  opts: { proxied: boolean; signal?: AbortSignal; doFetch?: typeof fetch },
): Promise<Response> {
  const doFetch = opts.doFetch ?? fetch;
  const init = opts.signal ? { signal: opts.signal } : undefined;
  let response = await doFetch(build(), init);
  if (!opts.proxied) return response;
  if (response.status === 401) {
    const token = await getProxyAuthSource()?.refreshToken();
    if (token !== null && token !== undefined) {
      await response.body?.cancel();
      response = await doFetch(build(), init);
    }
  }
  if (isOpaqueRedirect(response)) throw new ProxyRedirectError();
  return response;
}
