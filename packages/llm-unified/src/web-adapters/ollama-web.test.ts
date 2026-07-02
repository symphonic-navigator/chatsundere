// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, describe, expect, it } from 'bun:test';
import type { WebContext } from '../integrations/web-interfacing.js';
import { setProxyAuthSource } from '../proxy-auth.js';
import { ollamaWebFetchAdapter, ollamaWebSearchAdapter } from './ollama-web.js';

const directCtx: WebContext = {
  nsfwAllowed: false,
  location: null,
  useProxy: false,
};

afterEach(() => setProxyAuthSource(null));

describe('ollamaWebSearchAdapter', () => {
  it('maps results[] to hits and sends {query, max_results} with Bearer auth (direct)', async () => {
    let captured: Request | null = null;
    const fakeFetch = async (req: Request): Promise<Response> => {
      captured = req;
      return new Response(
        JSON.stringify({
          results: [
            { title: 'Ollama', url: 'https://ollama.com', content: 'local models' },
            { title: 'Docs', url: 'https://docs.ollama.com', snippet: 'guide' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const adapter = ollamaWebSearchAdapter(fakeFetch as typeof fetch);
    const result = await adapter.search?.('ollama web', directCtx, 'KEY', { numResults: 5 });

    expect(result?.query).toBe('ollama web');
    expect(result?.hits).toHaveLength(2);
    expect(result?.hits[0]).toEqual({
      title: 'Ollama',
      url: 'https://ollama.com',
      snippet: 'local models',
    });
    expect(result?.hits[1]?.snippet).toBe('guide');

    const req = captured as unknown as Request;
    expect(req.url).toBe('https://ollama.com/api/web_search');
    expect(req.headers.get('authorization')).toBe('Bearer KEY');
    expect(JSON.parse(await req.text())).toEqual({ query: 'ollama web', max_results: 5 });
  });

  it('clamps max_results into 1..10 and defaults to 5', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fakeFetch = async (req: Request): Promise<Response> => {
      bodies.push(JSON.parse(await req.text()));
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    };
    const adapter = ollamaWebSearchAdapter(fakeFetch as typeof fetch);
    await adapter.search?.('q', directCtx, 'K', { numResults: 99 });
    await adapter.search?.('q', directCtx, 'K', { numResults: 0 });
    await adapter.search?.('q', directCtx, 'K', {});
    expect(bodies.map((b) => b.max_results)).toEqual([10, 1, 5]);
  });

  it('routes through the cors-proxy when configured', async () => {
    let captured: Request | null = null;
    const fakeFetch = async (req: Request): Promise<Response> => {
      captured = req;
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    };
    setProxyAuthSource({
      getUrl: () => 'https://proxy.example',
      getToken: () => 'jwt-P',
      refreshToken: async () => null,
    });
    const adapter = ollamaWebSearchAdapter(fakeFetch as typeof fetch);
    await adapter.search?.('q', { ...directCtx, useProxy: true }, 'KEY', {});
    const req = captured as unknown as Request;
    expect(req.url).toBe('https://proxy.example/web_search');
    expect(req.headers.get('x-chatsundere-authorization')).toBe('Bearer jwt-P');
    expect(req.headers.get('x-cors-proxy-target')).toBe('https://ollama.com/api');
  });

  it('caps each snippet to bound tool output', async () => {
    const long = 'x'.repeat(2000);
    const fakeFetch = async (_req: Request): Promise<Response> =>
      new Response(JSON.stringify({ results: [{ title: 't', url: 'u', content: long }] }), {
        status: 200,
      });
    const adapter = ollamaWebSearchAdapter(fakeFetch as typeof fetch);
    const r = await adapter.search?.('q', directCtx, 'K', {});
    expect((r?.hits[0]?.snippet ?? '').length).toBeLessThanOrEqual(600);
  });

  it('throws on a non-2xx response', async () => {
    const fakeFetch = async (_req: Request): Promise<Response> =>
      new Response('nope', { status: 500 });
    const adapter = ollamaWebSearchAdapter(fakeFetch as typeof fetch);
    await expect(adapter.search?.('q', directCtx, 'K', {})).rejects.toThrow(/HTTP 500/);
  });
});

describe('ollamaWebFetchAdapter', () => {
  it('posts {url} to /web_fetch and returns content', async () => {
    let captured: Request | null = null;
    const fakeFetch = async (req: Request): Promise<Response> => {
      captured = req;
      return new Response(JSON.stringify({ content: '# page', title: 'Page' }), { status: 200 });
    };
    const adapter = ollamaWebFetchAdapter(fakeFetch as typeof fetch);
    const r = await adapter.fetch?.('https://x', directCtx, 'K');
    expect(r).toEqual({ url: 'https://x', content: '# page' });

    const req = captured as unknown as Request;
    expect(req.url).toBe('https://ollama.com/api/web_fetch');
    expect(JSON.parse(await req.text())).toEqual({ url: 'https://x' });
  });

  it('throws a constructive error when content is empty', async () => {
    const fakeFetch = async (_req: Request): Promise<Response> =>
      new Response(JSON.stringify({ content: '' }), { status: 200 });
    const adapter = ollamaWebFetchAdapter(fakeFetch as typeof fetch);
    await expect(adapter.fetch?.('https://x', directCtx, 'K')).rejects.toThrow(/Could not fetch/);
  });
});
