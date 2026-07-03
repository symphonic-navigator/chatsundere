// SPDX-License-Identifier: AGPL-3.0-only
import type { Offering, WebInterfacingProvider } from '@chatsundere/llm-unified';
import { describe, expect, it, vi } from 'vitest';
import type { IntegrationContext, OfferingRef } from '../../../src/integrations/types.js';
import { createWebIntegration } from '../../../src/integrations/web/web-integration.js';

const REF: OfferingRef = { providerId: 'nano-gpt', upstreamSlug: 'brave' };

function webOffering(meta: Offering['web']): Offering {
  return {
    canonicalRef: null,
    providerId: 'nano-gpt',
    upstreamSlug: 'brave',
    adapter: { kind: 'catalogue', adapterId: 'nano-gpt-brave' },
    // biome-ignore lint/suspicious/noExplicitAny: profile is irrelevant to web gating in this unit test
    profile: {} as any,
    context: { recommended: 0, max: 0 },
    trust: { tee: false, zdr: false },
    freedomOrientedDeployment: null,
    source: 'curated',
    confidence: 'verified',
    serviceKind: 'web',
    web: meta,
  };
}

function ctx(over: Partial<IntegrationContext>): IntegrationContext {
  return {
    nsfwAllowed: false,
    location: null,
    webSearch: null,
    webFetch: null,
    useProxy: false,
    webSearchTierId: null,
    getKey: async () => 'secret-key',
    chatId: '',
    personaId: '',
    personaOffering: { providerId: '', upstreamSlug: '' },
    ...over,
  };
}

describe('web-integration', () => {
  it('contributes nothing when no offerings are selected', () => {
    const integ = createWebIntegration({
      getOffering: () => undefined,
      resolveWebAdapter: () => null,
    });
    expect(integ.contributesTools(ctx({}))).toEqual([]);
  });

  it('contributes nothing when no adapter resolves (dormant — today)', () => {
    const integ = createWebIntegration({
      getOffering: () =>
        webOffering({ canSearch: true, canFetch: true, requiresProxy: false, traits: ['privacy'] }),
      resolveWebAdapter: () => null, // registry empty
    });
    expect(integ.contributesTools(ctx({ webSearch: REF, webFetch: REF }))).toEqual([]);
  });

  it('contributes only web_search when the backend can search but not fetch', () => {
    const provider: WebInterfacingProvider = {
      search: async (q) => ({ query: q, hits: [] }),
    };
    const integ = createWebIntegration({
      getOffering: () =>
        webOffering({ canSearch: true, canFetch: false, requiresProxy: false, traits: ['ai'] }),
      resolveWebAdapter: () => provider,
    });
    const tools = integ.contributesTools(ctx({ webSearch: REF, webFetch: REF }));
    expect(tools.map((t) => t.name)).toEqual(['web_search']);
  });

  it('web_search.execute pulls the key, resolves the tier, and serialises hits', async () => {
    const search = vi.fn(async (q: string) => ({
      query: q,
      hits: [{ title: 'T', url: 'https://e.x', snippet: 'S' }],
    }));
    const getKey = vi.fn(async () => 'secret-key');
    const integ = createWebIntegration({
      getOffering: () =>
        webOffering({
          canSearch: true,
          canFetch: false,
          requiresProxy: false,
          traits: ['privacy'],
        }),
      resolveWebAdapter: () => ({ search }),
    });
    const [tool] = integ.contributesTools(ctx({ webSearch: REF, getKey }));
    if (!tool) throw new Error('expected web_search to be contributed');
    const result = await tool.execute({ query: 'cats' });
    expect(getKey).toHaveBeenCalledWith('nano-gpt');
    // No tiers on the offering → opts defaults to {}; no tier id selected
    expect(search).toHaveBeenCalledWith(
      'cats',
      { nsfwAllowed: false, location: null, useProxy: false },
      'secret-key',
      {},
      undefined,
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain('https://e.x');
  });

  it('web_search.execute resolves the selected tier and passes its params', async () => {
    const search = vi.fn(async (q: string) => ({ query: q, hits: [] }));
    const offering = webOffering({
      canSearch: true,
      canFetch: false,
      requiresProxy: false,
      traits: ['ai'],
      searchTiers: [
        { id: 'basic', label: 'Basic', params: { depth: 'basic', numResults: 5 } },
        { id: 'advanced', label: 'Advanced', params: { depth: 'advanced', numResults: 20 } },
      ],
    });
    const integ = createWebIntegration({
      getOffering: () => offering,
      resolveWebAdapter: () => ({ search }),
    });
    const [tool] = integ.contributesTools(ctx({ webSearch: REF, webSearchTierId: 'advanced' }));
    if (!tool) throw new Error('expected web_search to be contributed');
    await tool.execute({ query: 'dogs' });
    expect(search).toHaveBeenCalledWith(
      'dogs',
      { nsfwAllowed: false, location: null, useProxy: false },
      'secret-key',
      { depth: 'advanced', numResults: 20 },
      undefined,
    );
  });

  it('web_search.execute fails gracefully when no key is available', async () => {
    const integ = createWebIntegration({
      getOffering: () =>
        webOffering({
          canSearch: true,
          canFetch: false,
          requiresProxy: false,
          traits: ['privacy'],
        }),
      resolveWebAdapter: () => ({ search: async (q) => ({ query: q, hits: [] }) }),
    });
    const [tool] = integ.contributesTools(ctx({ webSearch: REF, getKey: async () => null }));
    if (!tool) throw new Error('expected web_search to be contributed');
    const result = await tool.execute({ query: 'cats' });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('web_fetch.execute pulls the key and serialises the page', async () => {
    const fetch = vi.fn(async (url: string) => ({ url, content: 'Page body.' }));
    const getKey = vi.fn(async () => 'secret-key');
    const integ = createWebIntegration({
      getOffering: () =>
        webOffering({ canSearch: false, canFetch: true, requiresProxy: false, traits: ['ai'] }),
      resolveWebAdapter: () => ({ fetch }),
    });
    const [tool] = integ.contributesTools(ctx({ webFetch: REF, getKey }));
    if (!tool) throw new Error('expected web_fetch to be contributed');
    expect(tool.name).toBe('web_fetch');
    const result = await tool.execute({ url: 'https://e.x/page' });
    expect(getKey).toHaveBeenCalledWith('nano-gpt');
    expect(fetch).toHaveBeenCalledWith(
      'https://e.x/page',
      { nsfwAllowed: false, location: null, useProxy: false },
      'secret-key',
      undefined,
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain('Page body.');
    expect(result.output).toContain('https://e.x/page');
  });

  it('web_fetch.execute fails gracefully when no key is available', async () => {
    const integ = createWebIntegration({
      getOffering: () =>
        webOffering({ canSearch: false, canFetch: true, requiresProxy: false, traits: ['ai'] }),
      resolveWebAdapter: () => ({ fetch: async (url) => ({ url, content: '' }) }),
    });
    const [tool] = integ.contributesTools(ctx({ webFetch: REF, getKey: async () => null }));
    if (!tool) throw new Error('expected web_fetch to be contributed');
    const result = await tool.execute({ url: 'https://e.x/page' });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  describe('proxy gate', () => {
    it('does NOT contribute web_search when offering requiresProxy but proxy is unavailable', () => {
      const provider: WebInterfacingProvider = {
        search: async (q) => ({ query: q, hits: [] }),
      };
      const integ = createWebIntegration({
        getOffering: () =>
          webOffering({
            canSearch: true,
            canFetch: false,
            requiresProxy: true,
            traits: ['ai'],
          }),
        resolveWebAdapter: () => provider,
      });
      // useProxy defaults to false in ctx()
      const tools = integ.contributesTools(ctx({ webSearch: REF }));
      expect(tools).toEqual([]);
    });

    it('DOES contribute web_search when offering requiresProxy and the proxy is available', () => {
      const provider: WebInterfacingProvider = {
        search: async (q) => ({ query: q, hits: [] }),
      };
      const integ = createWebIntegration({
        getOffering: () =>
          webOffering({
            canSearch: true,
            canFetch: false,
            requiresProxy: true,
            traits: ['ai'],
          }),
        resolveWebAdapter: () => provider,
      });
      const tools = integ.contributesTools(ctx({ webSearch: REF, useProxy: true }));
      expect(tools.map((t) => t.name)).toEqual(['web_search']);
    });

    it('does NOT contribute web_fetch when offering requiresProxy but proxy is unavailable', () => {
      const provider: WebInterfacingProvider = {
        fetch: async (url) => ({ url, content: '' }),
      };
      const integ = createWebIntegration({
        getOffering: () =>
          webOffering({
            canSearch: false,
            canFetch: true,
            requiresProxy: true,
            traits: ['ai'],
          }),
        resolveWebAdapter: () => provider,
      });
      const tools = integ.contributesTools(ctx({ webFetch: REF }));
      expect(tools).toEqual([]);
    });

    it('DOES contribute web_fetch when offering requiresProxy and the proxy is available', () => {
      const provider: WebInterfacingProvider = {
        fetch: async (url) => ({ url, content: '' }),
      };
      const integ = createWebIntegration({
        getOffering: () =>
          webOffering({
            canSearch: false,
            canFetch: true,
            requiresProxy: true,
            traits: ['ai'],
          }),
        resolveWebAdapter: () => provider,
      });
      const tools = integ.contributesTools(ctx({ webFetch: REF, useProxy: true }));
      expect(tools.map((t) => t.name)).toEqual(['web_fetch']);
    });

    it('threads useProxy through the WebContext on execution', async () => {
      const search = vi.fn(async (q: string) => ({ query: q, hits: [] }));
      const integ = createWebIntegration({
        getOffering: () =>
          webOffering({
            canSearch: true,
            canFetch: false,
            requiresProxy: true,
            traits: ['ai'],
          }),
        resolveWebAdapter: () => ({ search }),
      });
      const [tool] = integ.contributesTools(ctx({ webSearch: REF, useProxy: true }));
      if (!tool) throw new Error('expected web_search to be contributed');
      await tool.execute({ query: 'test' });
      expect(search).toHaveBeenCalledWith(
        'test',
        { nsfwAllowed: false, location: null, useProxy: true },
        'secret-key',
        {},
        undefined,
      );
    });
  });
});
