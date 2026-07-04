// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, describe, expect, it } from 'bun:test';
import type { WebContext } from '../integrations/web-interfacing.js';
import { setProxyAuthSource } from '../proxy-auth.js';
import { nanoGptWebScrapeAdapter, nanoGptWebSearchAdapter } from './nano-gpt-web.js';

const directCtx: WebContext = {
  nsfwAllowed: false,
  location: null,
  useProxy: false,
};

afterEach(() => setProxyAuthSource(null));

describe('nanoGptWebSearchAdapter', () => {
  it('maps /api/web data[] to ranked hits and sends provider + opts (direct)', async () => {
    let captured: Request | null = null;
    const fakeFetch = async (req: Request): Promise<Response> => {
      captured = req;
      return new Response(
        JSON.stringify({
          data: [
            { type: 'text', title: 'Bun', url: 'https://bun.com', content: 'fast runtime' },
            {
              type: 'text',
              title: 'GitHub',
              url: 'https://github.com/oven-sh/bun',
              content: 'repo',
            },
          ],
          metadata: { cost: 0.005 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const adapter = nanoGptWebSearchAdapter('exa', fakeFetch as typeof fetch);
    const search = adapter.search;
    expect(search).toBeDefined();
    const result = await search?.('latest bun', directCtx, 'KEY', {
      depth: 'neural',
      numResults: 8,
    });

    expect(result?.query).toBe('latest bun');
    expect(result?.hits).toHaveLength(2);
    expect(result?.hits[0]).toEqual({
      title: 'Bun',
      url: 'https://bun.com',
      snippet: 'fast runtime',
    });

    expect(captured).not.toBeNull();
    const req = captured as unknown as Request;
    expect(req.url).toBe('https://nano-gpt.com/api/web');
    expect(req.headers.get('authorization')).toBe('Bearer KEY');
    const body = JSON.parse(await req.text());
    expect(body).toMatchObject({
      query: 'latest bun',
      provider: 'exa',
      depth: 'neural',
      numResults: 8,
      outputType: 'searchResults',
    });
  });

  it('routes through the cors-proxy when configured', async () => {
    let captured: Request | null = null;
    const fakeFetch = async (req: Request): Promise<Response> => {
      captured = req;
      return new Response(JSON.stringify({ data: [], metadata: {} }), { status: 200 });
    };
    setProxyAuthSource({
      getUrl: () => 'https://proxy.example',
      getToken: () => 'jwt-P',
      refreshToken: async () => null,
    });
    const adapter = nanoGptWebSearchAdapter('linkup', fakeFetch as typeof fetch);
    await adapter.search?.('q', { ...directCtx, useProxy: true }, 'KEY', {});

    expect(captured).not.toBeNull();
    const req = captured as unknown as Request;
    // Bare-origin proxy target (parseTarget refuses a path); `/api` rides on the
    // request line so the forward rebuilds `https://nano-gpt.com/api/web`.
    expect(req.url).toBe('https://proxy.example/api/web');
    expect(req.headers.get('x-chatsundere-authorization')).toBe('Bearer jwt-P');
    expect(req.headers.get('x-cors-proxy-target')).toBe('https://nano-gpt.com');
  });

  it('caps each snippet to bound tool output', async () => {
    const long = 'x'.repeat(2000);
    const fakeFetch = async (_req: Request): Promise<Response> =>
      new Response(
        JSON.stringify({ data: [{ type: 'text', title: 't', url: 'u', content: long }] }),
        {
          status: 200,
        },
      );
    const adapter = nanoGptWebSearchAdapter('brave', fakeFetch as typeof fetch);
    const r = await adapter.search?.('q', directCtx, 'K', {});
    const firstHit = r?.hits[0];
    expect(firstHit).toBeDefined();
    expect((firstHit?.snippet ?? '').length).toBeLessThanOrEqual(600);
  });
});

describe('nanoGptWebScrapeAdapter', () => {
  it('prefers markdown and posts {urls:[url]} to /scrape-urls', async () => {
    let captured: Request | null = null;
    const fakeFetch = async (req: Request): Promise<Response> => {
      captured = req;
      return new Response(
        JSON.stringify({
          results: [{ url: 'u', success: true, markdown: '# md', content: 'plain' }],
        }),
        { status: 200 },
      );
    };
    const adapter = nanoGptWebScrapeAdapter(fakeFetch as typeof fetch);
    const fetch_ = adapter.fetch;
    expect(fetch_).toBeDefined();
    const r = await fetch_?.('https://x', directCtx, 'K');
    expect(r).toEqual({ url: 'https://x', content: '# md' });

    expect(captured).not.toBeNull();
    const req = captured as unknown as Request;
    expect(req.url).toBe('https://nano-gpt.com/api/scrape-urls');
    const body = JSON.parse(await req.text());
    expect(body).toEqual({ urls: ['https://x'] });
  });

  it('throws a constructive error on failed scrape', async () => {
    const fakeFetch = async (_req: Request): Promise<Response> =>
      new Response(JSON.stringify({ results: [{ url: 'u', success: false }] }), { status: 200 });
    const adapter = nanoGptWebScrapeAdapter(fakeFetch as typeof fetch);
    await expect(adapter.fetch?.('https://x', directCtx, 'K')).rejects.toThrow(/Could not fetch/);
  });
});
