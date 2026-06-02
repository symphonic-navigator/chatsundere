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
    getKey: async () => 'secret-key',
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
      getOffering: () => webOffering({ canSearch: true, canFetch: true, qualityClass: 'classic' }),
      resolveWebAdapter: () => null, // registry empty
    });
    expect(integ.contributesTools(ctx({ webSearch: REF, webFetch: REF }))).toEqual([]);
  });

  it('contributes only web_search when the backend can search but not fetch', () => {
    const provider: WebInterfacingProvider = { search: async (q) => ({ query: q, hits: [] }) };
    const integ = createWebIntegration({
      getOffering: () =>
        webOffering({ canSearch: true, canFetch: false, qualityClass: 'ai-friendly' }),
      resolveWebAdapter: () => provider,
    });
    const tools = integ.contributesTools(ctx({ webSearch: REF, webFetch: REF }));
    expect(tools.map((t) => t.name)).toEqual(['web_search']);
  });

  it('web_search.execute pulls the key and serialises hits', async () => {
    const search = vi.fn(async (q: string) => ({
      query: q,
      hits: [{ title: 'T', url: 'https://e.x', snippet: 'S' }],
    }));
    const getKey = vi.fn(async () => 'secret-key');
    const integ = createWebIntegration({
      getOffering: () => webOffering({ canSearch: true, canFetch: false, qualityClass: 'classic' }),
      resolveWebAdapter: () => ({ search }),
    });
    const [tool] = integ.contributesTools(ctx({ webSearch: REF, getKey }));
    if (!tool) throw new Error('expected web_search to be contributed');
    const result = await tool.execute({ query: 'cats' });
    expect(getKey).toHaveBeenCalledWith('nano-gpt');
    expect(search).toHaveBeenCalledWith(
      'cats',
      { nsfwAllowed: false, location: null },
      'secret-key',
      undefined,
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain('https://e.x');
  });

  it('web_search.execute fails gracefully when no key is available', async () => {
    const integ = createWebIntegration({
      getOffering: () => webOffering({ canSearch: true, canFetch: false, qualityClass: 'classic' }),
      resolveWebAdapter: () => ({ search: async (q) => ({ query: q, hits: [] }) }),
    });
    const [tool] = integ.contributesTools(ctx({ webSearch: REF, getKey: async () => null }));
    if (!tool) throw new Error('expected web_search to be contributed');
    const result = await tool.execute({ query: 'cats' });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
