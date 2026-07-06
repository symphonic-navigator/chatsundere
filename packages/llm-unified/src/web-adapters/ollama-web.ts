// SPDX-License-Identifier: LGPL-3.0-only
import type {
  WebContext,
  WebFetchResult,
  WebInterfacingProvider,
  WebSearchOpts,
  WebSearchResult,
} from '../integrations/web-interfacing.js';
import { fetchWithProxyAuth } from '../proxy-fetch.js';
import { buildRequest } from '../transport.js';
import type { ProviderConfig } from '../types.js';

/** Ollama Cloud web endpoints share the `/api` host with `/api/chat`. */
const WEB_BASE_URL = 'https://ollama.com/api';
const SNIPPET_CAP = 600;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** cors-proxy in the browser (ollama.com sends no CORS headers); direct in the
 *  Bun live-suite, where CORS does not apply. */
function routeFor(ctx: WebContext): ProviderConfig {
  return {
    baseUrl: WEB_BASE_URL,
    routing: ctx.useProxy ? { kind: 'cors-proxy' } : { kind: 'direct' },
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
  const res = await fetchWithProxyAuth(
    () =>
      buildRequest({
        provider: routeFor(ctx),
        apiKey: key,
        path,
        method: 'POST',
        body,
      }),
    { proxied: ctx.useProxy, signal, doFetch: fetchImpl },
  );
  if (!res.ok) {
    throw new Error(`ollama web ${path} failed: HTTP ${res.status}`);
  }
  return res.json();
}

interface OllamaSearchPayload {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    snippet?: string;
    description?: string;
  }>;
}

/** Search adapter for Ollama Cloud `/api/web_search`. `fetchImpl` is injectable
 *  for tests. The tier param `numResults` is translated to Ollama's `max_results`
 *  (1–10). */
export function ollamaWebSearchAdapter(fetchImpl: typeof fetch = fetch): WebInterfacingProvider {
  return {
    async search(
      query: string,
      ctx: WebContext,
      key: string,
      opts: WebSearchOpts,
      signal?: AbortSignal,
    ): Promise<WebSearchResult> {
      const max_results = clamp(Math.round(opts.numResults ?? 5), 1, 10);
      const payload = (await postWeb(
        ctx,
        key,
        '/web_search',
        { query, max_results },
        fetchImpl,
        signal,
      )) as OllamaSearchPayload;
      const hits = (payload.results ?? []).map((r) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        snippet: (r.content ?? r.snippet ?? r.description ?? '').slice(0, SNIPPET_CAP),
      }));
      return { query, hits };
    },
  };
}

interface OllamaFetchPayload {
  content?: string;
  title?: string;
}

/** Fetch adapter for Ollama Cloud `/api/web_fetch`. */
export function ollamaWebFetchAdapter(fetchImpl: typeof fetch = fetch): WebInterfacingProvider {
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
        '/web_fetch',
        { url },
        fetchImpl,
        signal,
      )) as OllamaFetchPayload;
      const content = payload.content ?? '';
      if (!content) {
        throw new Error(`Could not fetch ${url}.`);
      }
      return { url, content };
    },
  };
}
