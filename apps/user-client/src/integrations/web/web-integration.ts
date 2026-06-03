// SPDX-License-Identifier: AGPL-3.0-only
import {
  type Offering,
  type WebContext,
  type WebFetchResult,
  type WebInterfacingProvider,
  type WebSearchResult,
  getOffering as realGetOffering,
  resolveWebAdapter as realResolveWebAdapter,
} from '@chatsundere/llm-unified';
import type { Tool, ToolResult } from '../../tools/types.js';
import type { Integration, IntegrationContext, OfferingRef } from '../types.js';

/** Injectable resolvers so the integration is unit-testable without the live
 *  catalogue/registry. */
export interface WebIntegrationDeps {
  getOffering: (providerId: string, upstreamSlug: string) => Offering | undefined;
  resolveWebAdapter: (adapterId: string) => WebInterfacingProvider | null;
}

interface Resolved {
  offering: Offering;
  provider: WebInterfacingProvider;
}

function toWebContext(ctx: IntegrationContext): WebContext {
  return {
    nsfwAllowed: ctx.nsfwAllowed,
    location: ctx.location,
    corsProxyUrl: ctx.corsProxyUrl,
    corsProxyKey: ctx.corsProxyKey,
  };
}

function formatSearch(result: WebSearchResult): string {
  if (result.hits.length === 0) return `No results for "${result.query}".`;
  return result.hits
    .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`)
    .join('\n\n');
}

function formatFetch(result: WebFetchResult): string {
  return `Source: ${result.url}\n\n${result.content}`;
}

/** Build the WebInterfacing integration over injectable resolvers. The default
 *  `webIntegration` wires the real catalogue + registry. */
export function createWebIntegration(deps: WebIntegrationDeps): Integration {
  const resolve = (ref: OfferingRef | null, ctx: IntegrationContext): Resolved | null => {
    if (!ref) return null;
    const offering = deps.getOffering(ref.providerId, ref.upstreamSlug);
    if (!offering || offering.serviceKind !== 'web' || !offering.web) return null;
    if (offering.web.requiresProxy && !ctx.corsProxyUrl) return null;
    if (offering.adapter.kind !== 'catalogue') return null;
    const provider = deps.resolveWebAdapter(offering.adapter.adapterId);
    return provider ? { offering, provider } : null;
  };

  return {
    id: 'web-interfacing',
    capability: 'web',
    contributesTools(ctx: IntegrationContext): Tool[] {
      const tools: Tool[] = [];

      const searchR = resolve(ctx.webSearch, ctx);
      if (searchR?.offering.web?.canSearch && searchR.provider.search) {
        const { offering, provider } = searchR;
        tools.push({
          name: 'web_search',
          description:
            'Search the web for current, up-to-date information. Use it when the user asks you to look something up, or when answering accurately needs facts newer or more specific than your training.',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: 'The search query.' } },
            required: ['query'],
          },
          systemPromptInstruction:
            'You can search the web with web_search when you need current or external information.',
          async execute(args, signal): Promise<ToolResult> {
            try {
              const key = await ctx.getKey(offering.providerId);
              if (!key)
                return { ok: false, output: '', error: 'No API key for the web search backend.' };
              const query = typeof args.query === 'string' ? args.query : '';
              const tiers = offering.web?.searchTiers ?? [];
              const tier = tiers.find((t) => t.id === ctx.webSearchTierId) ?? tiers[0];
              const opts = tier?.params ?? {};
              // biome-ignore lint/style/noNonNullAssertion: gated above — provider.search is defined
              const result = await provider.search!(query, toWebContext(ctx), key, opts, signal);
              return { ok: true, output: formatSearch(result), error: null };
            } catch (e) {
              return {
                ok: false,
                output: '',
                error: e instanceof Error ? e.message : 'Web search failed.',
              };
            }
          },
        });
      }

      const fetchR = resolve(ctx.webFetch, ctx);
      if (fetchR?.offering.web?.canFetch && fetchR.provider.fetch) {
        const { offering, provider } = fetchR;
        tools.push({
          name: 'web_fetch',
          description:
            'Fetch and read the contents of a specific web page by its URL — use it when the user refers to a page, link, or article you should read.',
          parameters: {
            type: 'object',
            properties: { url: { type: 'string', description: 'The absolute URL to fetch.' } },
            required: ['url'],
          },
          systemPromptInstruction:
            'You can read a specific page with web_fetch when you have a URL to inspect.',
          async execute(args, signal): Promise<ToolResult> {
            try {
              const key = await ctx.getKey(offering.providerId);
              if (!key)
                return { ok: false, output: '', error: 'No API key for the web fetch backend.' };
              const url = typeof args.url === 'string' ? args.url : '';
              // biome-ignore lint/style/noNonNullAssertion: gated above — provider.fetch is defined
              const result = await provider.fetch!(url, toWebContext(ctx), key, signal);
              return { ok: true, output: formatFetch(result), error: null };
            } catch (e) {
              return {
                ok: false,
                output: '',
                error: e instanceof Error ? e.message : 'Web fetch failed.',
              };
            }
          },
        });
      }

      return tools;
    },
  };
}

/** The application's WebInterfacing integration, wired to the live catalogue and
 *  the (currently empty) web-adapter-registry. Dormant until a backend is
 *  curated and its adapter registered. The real resolvers are referenced lazily
 *  (only when a backend is actually resolved) rather than at module load, so a
 *  partially-mocked `@chatsundere/llm-unified` in unrelated tests that merely
 *  import this chain does not trip on missing exports. */
export const webIntegration = createWebIntegration({
  getOffering: (providerId, upstreamSlug) => realGetOffering(providerId, upstreamSlug),
  resolveWebAdapter: (adapterId) => realResolveWebAdapter(adapterId),
});
