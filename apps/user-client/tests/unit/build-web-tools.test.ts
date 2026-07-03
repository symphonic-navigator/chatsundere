import type {
  WebContext,
  WebFetchResult,
  WebInterfacingProvider,
  WebSearchResult,
} from '@chatsundere/llm-unified';
import { describe, expect, it } from 'vitest';
import { buildWebTools } from '../../src/integrations/web/build-web-tools.js';

const ctx: WebContext = {
  nsfwAllowed: true,
  location: null,
  useProxy: true,
};

const searchProvider: WebInterfacingProvider = {
  async search(query): Promise<WebSearchResult> {
    return { query, hits: [{ title: 'T', url: 'https://x', snippet: 'S' }] };
  },
};
const fetchProvider: WebInterfacingProvider = {
  async fetch(url): Promise<WebFetchResult> {
    return { url, content: 'BODY' };
  },
};

describe('buildWebTools', () => {
  it('builds a web_search tool that runs the provider and formats hits', async () => {
    const tools = buildWebTools({
      search: { provider: searchProvider, providerId: 'nano-gpt', tierParams: { numResults: 8 } },
      fetch: null,
      ctx,
      getKey: async () => 'k',
    });
    const search = tools.find((t) => t.name === 'web_search');
    expect(search).toBeDefined();
    const r = await search?.execute({ query: 'hi' });
    expect(r?.ok).toBe(true);
    expect(r?.output).toContain('https://x');
  });

  it('builds a web_fetch tool and omits search when no search provider', async () => {
    const tools = buildWebTools({
      search: null,
      fetch: { provider: fetchProvider, providerId: 'nano-gpt' },
      ctx,
      getKey: async () => 'k',
    });
    expect(tools.find((t) => t.name === 'web_search')).toBeUndefined();
    const fetchTool = tools.find((t) => t.name === 'web_fetch');
    const r = await fetchTool?.execute({ url: 'https://x' });
    expect(r?.output).toContain('BODY');
  });

  it('returns an error result when the key is missing', async () => {
    const tools = buildWebTools({
      search: { provider: searchProvider, providerId: 'nano-gpt', tierParams: {} },
      fetch: null,
      ctx,
      getKey: async () => null,
    });
    const r = await tools[0]?.execute({ query: 'x' });
    expect(r?.ok).toBe(false);
  });
});
