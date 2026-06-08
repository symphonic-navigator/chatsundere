// SPDX-License-Identifier: AGPL-3.0-only
import type {
  WebContext,
  WebFetchResult,
  WebInterfacingProvider,
  WebSearchOpts,
  WebSearchResult,
} from '@chatsundere/llm-unified';
import type { Tool, ToolResult } from '../../tools/types.js';

/** A resolved search backend: the adapter, the provider id (for key lookup), and
 *  the chosen depth tier's params (merged into the request body). */
export interface ResolvedSearch {
  provider: WebInterfacingProvider;
  providerId: string;
  tierParams: WebSearchOpts;
}
/** A resolved fetch backend: the adapter and the provider id. */
export interface ResolvedFetch {
  provider: WebInterfacingProvider;
  providerId: string;
}

export interface BuildWebToolsInput {
  search: ResolvedSearch | null;
  fetch: ResolvedFetch | null;
  ctx: WebContext;
  getKey: (providerId: string) => Promise<string | null>;
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

/** Build the web_search / web_fetch tools over already-resolved backends. Pure:
 *  no catalogue/registry access — the caller (chat integration or expert) does
 *  the resolution and passes the providers in. Each tool reports a progress
 *  phase ('searching'/'fetching') with the query/host as `detail`. */
export function buildWebTools(input: BuildWebToolsInput): Tool[] {
  const tools: Tool[] = [];

  if (input.search?.provider.search) {
    const { provider, providerId, tierParams } = input.search;
    tools.push({
      name: 'web_search',
      description:
        'Search the web for current, up-to-date information. Lean towards using it when the user explicitly asks you to look something up, rather than searching on your own initiative. Two or three searches are plenty: once you have relevant results, answer the user directly instead of searching again.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'The search query.' } },
        required: ['query'],
      },
      systemPromptInstruction:
        'Use web_search when the user asks for current or external information — prefer searching on request rather than proactively. Keep it to a focused search or two and answer once you have results rather than searching repeatedly.',
      async execute(args, signal, onProgress): Promise<ToolResult> {
        try {
          const key = await input.getKey(providerId);
          if (!key)
            return { ok: false, output: '', error: 'No API key for the web search backend.' };
          const query = typeof args.query === 'string' ? args.query : '';
          onProgress?.({ charCount: query.length, phase: 'searching', detail: query });
          // biome-ignore lint/style/noNonNullAssertion: gated above
          const result = await provider.search!(query, input.ctx, key, tierParams, signal);
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

  if (input.fetch?.provider.fetch) {
    const { provider, providerId } = input.fetch;
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
      async execute(args, signal, onProgress): Promise<ToolResult> {
        try {
          const key = await input.getKey(providerId);
          if (!key)
            return { ok: false, output: '', error: 'No API key for the web fetch backend.' };
          const url = typeof args.url === 'string' ? args.url : '';
          let host = url;
          try {
            host = new URL(url).host;
          } catch {
            /* keep raw */
          }
          onProgress?.({ charCount: url.length, phase: 'fetching', detail: host });
          // biome-ignore lint/style/noNonNullAssertion: gated above
          const result = await provider.fetch!(url, input.ctx, key, signal);
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
}
