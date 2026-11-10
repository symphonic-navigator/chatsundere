// SPDX-License-Identifier: AGPL-3.0-only
import { setProxyAuthSource } from '@chatsundere/llm-unified';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverOAuth } from '../../../src/mcp/oauth/discovery.js';
import { createOAuthFetch } from '../../../src/mcp/oauth/oauth-fetch.js';
import { OAuthError, type OAuthErrorKind } from '../../../src/mcp/oauth/url.js';
import { type FakeAuthOptions, createFakeAuthServer } from './fake-auth-server.js';

function setup(options: FakeAuthOptions = {}, route: 'direct' | 'proxy' = 'direct') {
  const fake = createFakeAuthServer(options);
  setProxyAuthSource({
    getUrl: () => fake.state.urls.proxyBase,
    getToken: () => 'account-token',
    refreshToken: async () => 'account-token-2',
  });
  const oauthFetch = createOAuthFetch({ fetch: fake.fetch });
  const run = (hasProxy = true) =>
    discoverOAuth(fake.state.urls.mcp, { oauthFetch, route, hasProxy });
  return { fake, run };
}

async function kindOf(promise: Promise<unknown>): Promise<OAuthErrorKind | 'resolved'> {
  try {
    await promise;
    return 'resolved';
  } catch (err) {
    if (err instanceof OAuthError) return err.kind;
    throw err;
  }
}

afterEach(() => setProxyAuthSource(null));

describe('discoverOAuth', () => {
  it('finds metadata from the challenge header', async () => {
    const { run } = setup({ metadata: 'header' });
    const found = await run();
    expect(found.kind).toBe('oauth');
    if (found.kind !== 'oauth') return;
    expect(found.resource).toBe('https://mcp.example/mcp');
    expect(found.issuer).toBe('https://auth.example');
    expect(found.tokenEndpoint).toBe('https://auth.example/token');
    expect(found.registrationEndpoint).toBe('https://auth.example/register');
    expect(found.resourceName).toBe('Fake MCP');
  });

  it('finds metadata at the well-known path with the resource path', async () => {
    const { run } = setup({ metadata: 'well-known-path' });
    expect((await run()).kind).toBe('oauth');
  });

  it('finds metadata at the well-known root', async () => {
    const { run } = setup({ metadata: 'well-known-root' });
    expect((await run()).kind).toBe('oauth');
  });

  it('prefers the path well-known over the root', async () => {
    const { fake, run } = setup({ metadata: 'well-known-path' });
    await run();
    const path = fake.state.log.findIndex((l) => l.includes('oauth-protected-resource/mcp'));
    const root = fake.state.log.findIndex((l) => l.endsWith('oauth-protected-resource'));
    expect(path).toBeGreaterThan(-1);
    expect(root === -1 || root > path).toBe(true);
  });

  it('reads RFC 8414 metadata', async () => {
    const { run } = setup({ asMetadata: 'rfc8414', cimd: true, advertiseIss: true });
    const found = await run();
    expect(found).toMatchObject({
      kind: 'oauth',
      cimdSupported: true,
      issParameterSupported: true,
    });
  });

  it('falls back to OIDC discovery', async () => {
    const { fake, run } = setup({ asMetadata: 'oidc' });
    expect((await run()).kind).toBe('oauth');
    const rfc = fake.state.log.findIndex((l) => l.includes('oauth-authorization-server'));
    const oidc = fake.state.log.findIndex((l) => l.includes('openid-configuration'));
    expect(rfc).toBeLessThan(oidc);
  });

  it('treats a 401 with no metadata anywhere as a key server', async () => {
    const { run } = setup({ metadata: 'none' });
    expect((await run()).kind).toBe('no-oauth');
  });

  it('treats a 200 JSON-RPC error as no OAuth', async () => {
    const { run } = setup({ metadata: 'open-200' });
    expect((await run()).kind).toBe('no-oauth');
  });

  it('refuses a protected resource that names another resource', async () => {
    const { run } = setup({ wrongPrmResource: true });
    expect(await kindOf(run())).toBe('resource-mismatch');
  });

  it('refuses an issuer that differs from the one the URL was built from', async () => {
    const { run } = setup({ wrongIssuer: true });
    expect(await kindOf(run())).toBe('issuer-mismatch');
  });

  it('refuses a server without PKCE S256', async () => {
    const { run } = setup({ pkce: false });
    expect(await kindOf(run())).toBe('no-pkce');
  });

  it('refuses non-https endpoints', async () => {
    const { run } = setup({ insecureEndpoints: true });
    expect(await kindOf(run())).toBe('not-secure');
  });

  it('refuses a plaintext http resource before any request goes out', async () => {
    const oauthFetch = vi.fn();
    const err = await discoverOAuth('http://mcp.example/mcp', {
      oauthFetch,
      route: 'proxy',
      hasProxy: true,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OAuthError);
    expect((err as OAuthError).kind).toBe('not-secure');
    expect(oauthFetch).not.toHaveBeenCalled();
  });

  it('refuses a javascript: authorisation endpoint', async () => {
    const { run } = setup({ authorisationEndpoint: 'javascript:alert(1)' });
    expect(await kindOf(run())).toBe('not-secure');
  });

  it('refuses an HTML metadata body', async () => {
    const { run } = setup({ metadataBody: '<html>nope</html>' });
    expect(await kindOf(run())).toBe('bad-metadata');
  });

  it('refuses metadata over 256 KiB', async () => {
    const { run } = setup({ metadataBody: JSON.stringify({ pad: 'x'.repeat(300 * 1024) }) });
    expect(await kindOf(run())).toBe('bad-metadata');
  });

  it('caps the read by streaming, not by trusting Content-Length', async () => {
    const { fake } = setup();
    const chunk = new Uint8Array(64 * 1024).fill(120);
    let pulled = 0;
    const hostile: typeof fetch = async (input, init) => {
      const url = String(input);
      if (!url.includes('openid') && !url.includes('oauth-authorization-server')) {
        return fake.fetch(input, init);
      }
      return new Response(
        new ReadableStream({
          pull(controller) {
            pulled++;
            if (pulled > 100) controller.close();
            else controller.enqueue(chunk);
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const oauthFetch = createOAuthFetch({ fetch: hostile });
    const kind = await kindOf(
      discoverOAuth(fake.state.urls.mcp, { oauthFetch, route: 'direct', hasProxy: false }),
    );
    expect(kind).toBe('bad-metadata');
    // Two candidates are now tried, each abandoned after ~5 chunks rather than read to 100.
    expect(pulled).toBeLessThan(20);
  });

  it('retries a blocked authorisation-server read through the proxy', async () => {
    const { fake } = setup({ cors: false });
    const oauthFetch = createOAuthFetch({ fetch: fake.fetch });
    const found = await discoverOAuth(fake.state.urls.mcp, {
      oauthFetch,
      route: 'proxy',
      hasProxy: true,
    });
    expect(found.kind).toBe('oauth');
    expect(fake.state.log.some((l) => l.includes('GET direct-blocked'))).toBe(true);
  });

  it('reports a network failure when no route can read the authorisation server', async () => {
    const { fake } = setup({ cors: false });
    const oauthFetch = createOAuthFetch({ fetch: fake.fetch });
    const kind = await kindOf(
      discoverOAuth(fake.state.urls.mcp, { oauthFetch, route: 'proxy', hasProxy: false }),
    );
    expect(kind).toBe('network');
  });

  describe('hostile or flaky metadata', () => {
    const failingFor = (fake: ReturnType<typeof createFakeAuthServer>, needle: string) =>
      (async (input, init) => {
        if (String(input).includes(needle)) throw new TypeError('Failed to fetch');
        return fake.fetch(input, init);
      }) as typeof fetch;

    it('does not read a failed challenge-named document as "no OAuth"', async () => {
      const { fake } = setup({ metadata: 'header' });
      const oauthFetch = createOAuthFetch({ fetch: failingFor(fake, 'mcp.example/prm.json') });
      const kind = await kindOf(
        discoverOAuth(fake.state.urls.mcp, { oauthFetch, route: 'direct', hasProxy: false }),
      );
      expect(kind).toBe('network');
    });

    it('retries a failed challenge-named document through the proxy', async () => {
      const { fake } = setup({ metadata: 'header' });
      const oauthFetch = createOAuthFetch({ fetch: failingFor(fake, 'mcp.example/prm.json') });
      const found = await discoverOAuth(fake.state.urls.mcp, {
        oauthFetch,
        route: 'direct',
        hasProxy: true,
      });
      expect(found.kind).toBe('oauth');
    });

    it('tries the next candidate after junk at an earlier one', async () => {
      const { fake } = setup({ asMetadata: 'oidc' });
      const junk: typeof fetch = async (input, init) =>
        String(input).includes('oauth-authorization-server')
          ? new Response('<html></html>', { status: 200 })
          : fake.fetch(input, init);
      const found = await discoverOAuth(fake.state.urls.mcp, {
        oauthFetch: createOAuthFetch({ fetch: junk }),
        route: 'direct',
        hasProxy: false,
      });
      expect(found.kind).toBe('oauth');
    });
  });

  describe('direct first and viaProxy', () => {
    /** Throws `error` for direct requests whose URL contains `needle`; proxied ones pass. */
    const failingDirect = (
      fake: ReturnType<typeof createFakeAuthServer>,
      needle: string,
      error: Error,
    ) =>
      (async (input, init) => {
        const url = String(input);
        if (!url.startsWith(fake.state.urls.proxyBase) && url.includes(needle)) throw error;
        return fake.fetch(input, init);
      }) as typeof fetch;

    it('goes direct first for the pointer even when the probe used the proxy', async () => {
      const { fake, run } = setup({ metadata: 'header' }, 'proxy');
      const found = await run();
      expect(found).toMatchObject({ kind: 'oauth', viaProxy: false });
      expect(fake.state.log.some((l) => l.startsWith('GET proxy') && l.includes('/prm.json'))).toBe(
        false,
      );
      expect(
        fake.state.log.some((l) => l.startsWith('GET direct') && l.includes('/prm.json')),
      ).toBe(true);
    });

    it('falls back to the proxy for the pointer only on a TypeError', async () => {
      const { fake } = setup({ metadata: 'header' });
      const viaTypeError = await discoverOAuth(fake.state.urls.mcp, {
        oauthFetch: createOAuthFetch({
          fetch: failingDirect(fake, 'prm.json', new TypeError('Failed to fetch')),
        }),
        route: 'direct',
        hasProxy: true,
      });
      expect(viaTypeError).toMatchObject({ kind: 'oauth', viaProxy: true });

      const other = setup({ metadata: 'header' });
      const kind = await kindOf(
        discoverOAuth(other.fake.state.urls.mcp, {
          oauthFetch: createOAuthFetch({
            fetch: failingDirect(other.fake, 'prm.json', new Error('boom')),
          }),
          route: 'direct',
          hasProxy: true,
        }),
      );
      expect(kind).toBe('network');
      expect(other.fake.state.log.some((l) => l.startsWith('GET proxy'))).toBe(false);
    });

    it('applies the same rule to the well-known guesses', async () => {
      const { fake } = setup({ metadata: 'well-known-path' });
      const found = await discoverOAuth(fake.state.urls.mcp, {
        oauthFetch: createOAuthFetch({
          fetch: failingDirect(fake, 'oauth-protected-resource', new TypeError('Failed to fetch')),
        }),
        route: 'direct',
        hasProxy: true,
      });
      expect(found).toMatchObject({ kind: 'oauth', viaProxy: true });
    });

    it('reports viaProxy when only the authorisation server metadata came through the proxy', async () => {
      const { fake } = setup({ metadata: 'header' });
      const found = await discoverOAuth(fake.state.urls.mcp, {
        oauthFetch: createOAuthFetch({
          fetch: failingDirect(fake, 'auth.example', new TypeError('Failed to fetch')),
        }),
        route: 'direct',
        hasProxy: true,
      });
      expect(found).toMatchObject({ kind: 'oauth', viaProxy: true });
    });

    it('reports no viaProxy when everything was direct', async () => {
      expect(await setup({ metadata: 'header' }).run()).toMatchObject({ viaProxy: false });
    });

    it('treats an unreachable guess with no proxy as a server without OAuth', async () => {
      const { fake } = setup({ metadata: 'well-known-path' });
      const found = await discoverOAuth(fake.state.urls.mcp, {
        oauthFetch: createOAuthFetch({
          fetch: failingDirect(fake, 'oauth-protected-resource', new TypeError('Failed to fetch')),
        }),
        route: 'direct',
        hasProxy: false,
      });
      expect(found).toEqual({ kind: 'no-oauth' });
    });
  });

  describe('scope', () => {
    it('lets the challenge win over scopes_supported', async () => {
      const { run } = setup({ challengeScope: 'read', prmScopes: ['read', 'write'] });
      expect(await run()).toMatchObject({ scope: 'read' });
    });

    it('falls back to scopes_supported, then to none', async () => {
      expect(await setup({ prmScopes: ['read', 'write'] }).run()).toMatchObject({
        scope: 'read write',
      });
      expect(await setup().run()).toMatchObject({ scope: null });
    });

    it('appends offline_access only when the authorisation server lists it', async () => {
      expect(
        await setup({ challengeScope: 'read', asScopes: ['read', 'offline_access'] }).run(),
      ).toMatchObject({ scope: 'read offline_access' });
      expect(await setup({ challengeScope: 'read', asScopes: ['read'] }).run()).toMatchObject({
        scope: 'read',
      });
    });

    it('treats an empty challenge scope as absent', async () => {
      const { run } = setup({ challengeScope: '', prmScopes: ['read'] });
      expect(await run()).toMatchObject({ scope: 'read' });
    });

    it('drops offline_access when it would be the only scope', async () => {
      const { run } = setup({ challengeScope: 'offline_access', asScopes: ['offline_access'] });
      expect(await run()).toMatchObject({ scope: null });
    });

    it('never makes offline_access the only scope', async () => {
      expect(await setup({ asScopes: ['offline_access'] }).run()).toMatchObject({ scope: null });
    });
  });
});

describe('createOAuthFetch', () => {
  function recorder(respond: (call: number, req: Request) => Response) {
    const calls: Request[] = [];
    const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      calls.push(req);
      return respond(calls.length, req);
    }) as typeof fetch;
    return { calls, doFetch };
  }
  const form = { method: 'POST', body: 'grant_type=refresh_token' };

  it('sends MCP-Protocol-Version on a direct POST to force a preflight', async () => {
    const { calls, doFetch } = recorder(() => new Response('{}'));
    await createOAuthFetch({ fetch: doFetch })('https://auth.example/token', form, {
      route: 'direct',
    });
    expect(calls[0]?.headers.get('mcp-protocol-version')).toBe('2025-06-18');
    expect(calls[0]?.redirect).toBe('error');
  });

  it('sends no preflight-forcing header on a direct GET', async () => {
    const { calls, doFetch } = recorder(() => new Response('{}'));
    await createOAuthFetch({ fetch: doFetch })(
      'https://auth.example/x',
      { method: 'GET' },
      { route: 'direct' },
    );
    expect(calls[0]?.headers.has('mcp-protocol-version')).toBe(false);
  });

  it('builds proxy requests like the MCP client', async () => {
    setProxyAuthSource({
      getUrl: () => 'https://proxy.example/',
      getToken: () => 'account-token',
      refreshToken: async () => null,
    });
    const { calls, doFetch } = recorder(() => new Response('{}'));
    await createOAuthFetch({ fetch: doFetch })('https://auth.example/oauth/token?a=1', form, {
      route: 'proxy',
    });
    const req = calls[0];
    expect(req?.url).toBe('https://proxy.example/oauth/token?a=1');
    expect(req?.headers.get('x-cors-proxy-target')).toBe('https://auth.example');
    expect(req?.headers.get('x-cors-proxy-kind')).toBe('mcp');
    expect(req?.headers.get('x-chatsundere-authorization')).toBe('Bearer account-token');
    expect(req?.redirect).toBe('manual');
  });

  it('does not retry a proxied request whose upstream answered 401', async () => {
    const refresh = vi.fn(async () => 'fresh');
    setProxyAuthSource({
      getUrl: () => 'https://proxy.example',
      getToken: () => 'account-token',
      refreshToken: refresh,
    });
    const { calls, doFetch } = recorder(
      () => new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 }),
    );
    const res = await createOAuthFetch({ fetch: doFetch })('https://auth.example/token', form, {
      route: 'proxy',
    });
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('retries once on a proxy-level unauthorized, with the refreshed account token', async () => {
    let token = 'old';
    setProxyAuthSource({
      getUrl: () => 'https://proxy.example',
      getToken: () => token,
      refreshToken: async () => {
        token = 'new';
        return token;
      },
    });
    const { calls, doFetch } = recorder((call) =>
      call === 1
        ? new Response(JSON.stringify({ error: { code: 'unauthorized' } }), { status: 401 })
        : new Response('{}'),
    );
    const res = await createOAuthFetch({ fetch: doFetch })('https://auth.example/token', form, {
      route: 'proxy',
    });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.headers.get('x-chatsundere-authorization')).toBe('Bearer new');
  });

  it('does not retry a 401 whose body exceeds the cap, even if it imitates the shape', async () => {
    const refresh = vi.fn(async () => 'fresh');
    setProxyAuthSource({
      getUrl: () => 'https://proxy.example',
      getToken: () => 't',
      refreshToken: refresh,
    });
    const huge = JSON.stringify({ error: { code: 'unauthorized' }, pad: 'x'.repeat(8 * 1024) });
    const { calls, doFetch } = recorder(() => new Response(huge, { status: 401 }));
    const res = await createOAuthFetch({ fetch: doFetch })('https://auth.example/token', form, {
      route: 'proxy',
    });
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('retries a proxy-level unauthorized only once', async () => {
    setProxyAuthSource({
      getUrl: () => 'https://proxy.example',
      getToken: () => 't',
      refreshToken: async () => 't2',
    });
    const { calls, doFetch } = recorder(
      () => new Response(JSON.stringify({ error: { code: 'unauthorized' } }), { status: 401 }),
    );
    const res = await createOAuthFetch({ fetch: doFetch })('https://auth.example/token', form, {
      route: 'proxy',
    });
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(2);
  });

  it('throws a network error when the proxy is unavailable', async () => {
    setProxyAuthSource(null);
    const { doFetch } = recorder(() => new Response('{}'));
    const kind = await kindOf(
      createOAuthFetch({ fetch: doFetch })('https://auth.example/token', form, { route: 'proxy' }),
    );
    expect(kind).toBe('network');
  });
});
