// SPDX-License-Identifier: LGPL-3.0-only
import type {
  WebContext,
  WebFetchResult,
  WebInterfacingProvider,
  WebSearchOpts,
  WebSearchResult,
} from '../integrations/web-interfacing.js';
import { buildRequest } from '../transport.js';
import type { ProviderConfig } from '../types.js';

/** Web endpoints live under `/api` (not `/api/v1`, which is the chat path). */
const WEB_BASE_URL = 'https://nano-gpt.com/api';
const SNIPPET_CAP = 600;

/** Build the route target: cors-proxy when a proxy is configured (the browser),
 *  direct otherwise (the Bun live-suite, where CORS is irrelevant). */
function routeFor(ctx: WebContext): ProviderConfig {
  return {
    baseUrl: WEB_BASE_URL,
    routing: ctx.corsProxyUrl ? { kind: 'cors-proxy' } : { kind: 'direct' },
  };
}

async function postWeb(
  ctx: WebContext,
  key: string,
  path: string,
  body: unknown,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<unknown> {
  const req = buildRequest({
    provider: routeFor(ctx),
    apiKey: key,
    corsProxyUrl: ctx.corsProxyUrl,
    corsProxyKey: ctx.corsProxyKey,
    path,
    method: 'POST',
    body,
  });
  const res = await fetchImpl(signal ? new Request(req, { signal }) : req);
  if (!res.ok) {
    throw new Error(`nano-gpt web ${path} failed: HTTP ${res.status}`);
  }
  return res.json();
}

interface WebSearchPayload {
  data?: Array<{ title?: string; url?: string; content?: string }>;
}

/** Search adapter bound to one nano-gpt search provider (linkup | exa | brave).
 *  `fetchImpl` is injectable for tests. */
export function nanoGptWebSearchAdapter(
  provider: 'linkup' | 'exa' | 'brave',
  fetchImpl: typeof fetch = fetch,
): WebInterfacingProvider {
  return {
    async search(
      query: string,
      ctx: WebContext,
      key: string,
      opts: WebSearchOpts,
      signal?: AbortSignal,
    ): Promise<WebSearchResult> {
      const body = { query, provider, outputType: 'searchResults', ...opts };
      const payload = (await postWeb(
        ctx,
        key,
        '/web',
        body,
        fetchImpl,
        signal,
      )) as WebSearchPayload;
      const hits = (payload.data ?? []).map((d) => ({
        title: d.title ?? '',
        url: d.url ?? '',
        snippet: (d.content ?? '').slice(0, SNIPPET_CAP),
      }));
      return { query, hits };
    },
  };
}

interface WebScrapePayload {
  results?: Array<{ url?: string; success?: boolean; markdown?: string; content?: string }>;
}

/** Fetch (scrape) adapter using nano-gpt's standalone `/scrape-urls`. */
export function nanoGptWebScrapeAdapter(fetchImpl: typeof fetch = fetch): WebInterfacingProvider {
  return {
    async fetch(
      url: string,
      ctx: WebContext,
      key: string,
      signal?: AbortSignal,
    ): Promise<WebFetchResult> {
      const payload = (await postWeb(
        ctx,
        key,
        '/scrape-urls',
        { urls: [url] },
        fetchImpl,
        signal,
      )) as WebScrapePayload;
      const first = payload.results?.[0];
      if (!first || first.success === false) {
        throw new Error(`Could not fetch ${url}.`);
      }
      return { url, content: first.markdown ?? first.content ?? '' };
    },
  };
}
