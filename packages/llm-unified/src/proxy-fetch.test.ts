// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, describe, expect, test } from 'bun:test';
import { getProxyAuthSource, setProxyAuthSource } from './proxy-auth.js';
import { ProxyRedirectError, fetchWithProxyAuth } from './proxy-fetch.js';

afterEach(() => setProxyAuthSource(null));

describe('fetchWithProxyAuth', () => {
  test('proxied 401 refreshes once and retries with a rebuilt request', async () => {
    let refreshed = false;
    setProxyAuthSource({
      getUrl: () => 'https://proxy.example',
      getToken: () => (refreshed ? 'new-tok' : 'old-tok'),
      refreshToken: async () => {
        refreshed = true;
        return 'new-tok';
      },
    });
    const seen: string[] = [];
    const doFetch = (async (req: Request) => {
      seen.push(req.headers.get('x-chatsundere-authorization') ?? '');
      return seen.length === 1 ? new Response('', { status: 401 }) : new Response('ok');
    }) as unknown as typeof fetch;
    const build = () =>
      new Request('https://proxy.example/p', {
        headers: {
          'x-chatsundere-authorization': `Bearer ${getProxyAuthSource()?.getToken() ?? ''}`,
        },
      });
    const res = await fetchWithProxyAuth(build, { proxied: true, doFetch });
    expect(res.status).toBe(200);
    expect(seen).toEqual(['Bearer old-tok', 'Bearer new-tok']);
  });

  test('failed refresh surfaces the original 401', async () => {
    setProxyAuthSource({
      getUrl: () => 'https://proxy.example',
      getToken: () => 'tok',
      refreshToken: async () => null,
    });
    let calls = 0;
    const doFetch = (async () => {
      calls += 1;
      return new Response('', { status: 401 });
    }) as unknown as typeof fetch;
    const res = await fetchWithProxyAuth(() => new Request('https://proxy.example/p'), {
      proxied: true,
      doFetch,
    });
    expect(res.status).toBe(401);
    // Refresh returned null → no second fetch.
    expect(calls).toBe(1);
  });

  test('direct requests never refresh on 401', async () => {
    let refreshCalled = false;
    setProxyAuthSource({
      getUrl: () => 'https://proxy.example',
      getToken: () => 'tok',
      refreshToken: async () => {
        refreshCalled = true;
        return 'new';
      },
    });
    const doFetch = (async () => new Response('', { status: 401 })) as unknown as typeof fetch;
    const res = await fetchWithProxyAuth(() => new Request('https://upstream.example/p'), {
      proxied: false,
      doFetch,
    });
    expect(res.status).toBe(401);
    expect(refreshCalled).toBe(false);
  });

  test('opaque redirect throws ProxyRedirectError', async () => {
    const opaque = { type: 'opaqueredirect', status: 0 } as unknown as Response;
    const doFetchOpaque = (async () => opaque) as unknown as typeof fetch;
    await expect(
      fetchWithProxyAuth(() => new Request('https://proxy.example/p'), {
        proxied: true,
        doFetch: doFetchOpaque,
      }),
    ).rejects.toBeInstanceOf(ProxyRedirectError);
  });
});
