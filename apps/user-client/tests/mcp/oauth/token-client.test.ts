// SPDX-License-Identifier: AGPL-3.0-only
import { setProxyAuthSource } from '@chatsundere/llm-unified';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverOAuth } from '../../../src/mcp/oauth/discovery.js';
import { createOAuthFetch } from '../../../src/mcp/oauth/oauth-fetch.js';
import { createPkce } from '../../../src/mcp/oauth/pkce.js';
import {
  exchangeCode,
  refreshTokens,
  registerClient,
  revokeToken,
} from '../../../src/mcp/oauth/token-client.js';
import { OAuthError, type OAuthErrorKind } from '../../../src/mcp/oauth/url.js';
import { type FakeAuthOptions, createFakeAuthServer } from './fake-auth-server.js';

const REDIRECT = 'https://app.example/oauth/callback';

function setup(
  options: FakeAuthOptions = {},
  hasProxy = true,
  fetchMode: {
    wrapFetch?: (inner: typeof fetch) => typeof fetch;
    replaceFetch?: typeof fetch;
  } = {},
) {
  const fake = createFakeAuthServer(options);
  setProxyAuthSource({
    getUrl: () => fake.state.urls.proxyBase,
    getToken: () => 'account-token',
    refreshToken: async () => 'account-token-2',
  });
  const oauthFetch = createOAuthFetch({
    fetch: fetchMode.replaceFetch ?? fetchMode.wrapFetch?.(fake.fetch) ?? fake.fetch,
  });
  const deps = { oauthFetch, hasProxy, now: options.now };
  return { fake, deps, resource: fake.state.urls.mcp };
}

async function signIn(
  ctx: ReturnType<typeof setup>,
  clientId = 'client-x',
): Promise<{ code: string; verifier: string; clientId: string }> {
  const { verifier, challenge } = await createPkce();
  const { code } = await ctx.fake.state.authorise({
    redirectUri: REDIRECT,
    state: 's',
    codeChallenge: challenge,
    clientId,
  });
  return { code, verifier, clientId };
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

async function exchange(ctx: ReturnType<typeof setup>) {
  const s = await signIn(ctx);
  const result = await exchangeCode(
    {
      tokenEndpoint: ctx.fake.state.urls.token,
      code: s.code,
      verifier: s.verifier,
      clientId: s.clientId,
      redirectUri: REDIRECT,
      resource: ctx.resource,
    },
    ctx.deps,
  );
  return result;
}

function refresh(
  ctx: ReturnType<typeof setup>,
  refreshToken: string,
  route: 'direct' | 'proxy' = 'direct',
  signal?: AbortSignal,
) {
  return refreshTokens(
    {
      tokenEndpoint: ctx.fake.state.urls.token,
      refreshToken,
      clientId: 'client-x',
      resource: ctx.resource,
      route,
      signal,
    },
    ctx.deps,
  );
}

afterEach(() => {
  setProxyAuthSource(null);
  vi.useRealTimers();
});

describe('registerClient', () => {
  it('registers a public client', async () => {
    const ctx = setup();
    const d = await discoverOAuth(ctx.resource, { ...ctx.deps, route: 'direct' });
    if (d.kind !== 'oauth') throw new Error('expected oauth');
    const { clientId } = await registerClient(d, REDIRECT, ctx.deps);
    expect(clientId).toBe(ctx.fake.state.registrations[0]?.clientId);
    expect(ctx.fake.state.registrations[0]?.body).toMatchObject({
      token_endpoint_auth_method: 'none',
      redirect_uris: [REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      client_name: 'Chatsundere',
    });
  });

  it('refuses a server that returns a client secret', async () => {
    const ctx = setup({ dcrDemandsSecret: true });
    const d = await discoverOAuth(ctx.resource, { ...ctx.deps, route: 'direct' });
    if (d.kind !== 'oauth') throw new Error('expected oauth');
    expect(await kindOf(registerClient(d, REDIRECT, ctx.deps))).toBe('registration-refused');
  });

  it('refuses when the response names another auth method', async () => {
    const ctx = setup();
    const inner = ctx.fake.fetch;
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await inner(input, init);
      if (String(input).endsWith('/register')) {
        return new Response(
          JSON.stringify({ client_id: 'c', token_endpoint_auth_method: 'client_secret_basic' }),
          { status: 201 },
        );
      }
      return res;
    }) as typeof fetch;
    const c2 = setup({}, true, { replaceFetch: fetcher });
    const d = await discoverOAuth(c2.resource, { ...c2.deps, route: 'direct' });
    if (d.kind !== 'oauth') throw new Error('expected oauth');
    expect(await kindOf(registerClient(d, REDIRECT, c2.deps))).toBe('registration-refused');
  });

  it('refuses when there is no registration endpoint', async () => {
    const ctx = setup({ dcr: false });
    const d = await discoverOAuth(ctx.resource, { ...ctx.deps, route: 'direct' });
    if (d.kind !== 'oauth') throw new Error('expected oauth');
    expect(await kindOf(registerClient(d, REDIRECT, ctx.deps))).toBe('registration-refused');
  });

  it('falls back to the proxy when CORS blocks the direct attempt', async () => {
    const ctx = setup({ cors: false });
    const d = await discoverOAuth(ctx.resource, { ...ctx.deps, route: 'proxy' });
    if (d.kind !== 'oauth') throw new Error('expected oauth');
    await registerClient(d, REDIRECT, ctx.deps);
    expect(ctx.fake.state.processed.direct).toBe(0);
    expect(ctx.fake.state.registrations).toHaveLength(1);
  });
});

describe('exchangeCode', () => {
  it('sends the full form and reports the direct route', async () => {
    const seen: string[] = [];
    const c = setup({}, true, {
      wrapFetch: (inner: typeof fetch) =>
        ((input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input).endsWith('/token')) seen.push(String(init?.body));
          return inner(input, init);
        }) as typeof fetch,
    });
    const { tokens, tokenRoute } = await exchange(c);
    expect(tokenRoute).toBe('direct');
    expect(tokens.accessToken.startsWith('at-')).toBe(true);
    expect(tokens.refreshToken?.startsWith('rt-')).toBe(true);
    const form = new URLSearchParams(seen[0]);
    expect([...form.keys()].sort()).toEqual(
      ['client_id', 'code', 'code_verifier', 'grant_type', 'redirect_uri', 'resource'].sort(),
    );
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('resource')).toBe(c.resource);
    expect(form.get('redirect_uri')).toBe(REDIRECT);
  });

  it('uses the proxy when CORS refuses the preflight', async () => {
    const ctx = setup({ cors: false });
    const { tokenRoute } = await exchange(ctx);
    expect(tokenRoute).toBe('proxy');
    expect(ctx.fake.state.blockedPreflights).toBe(1);
  });

  it('fails with network and no proxy when CORS blocks and there is none', async () => {
    const ctx = setup({ cors: false }, false);
    expect(await kindOf(exchange(ctx))).toBe('network');
    expect(ctx.fake.state.processed.proxy).toBe(0);
  });

  it('never falls through to the proxy after an answered error', async () => {
    const ctx = setup();
    const s = await signIn(ctx);
    const kind = await kindOf(
      exchangeCode(
        {
          tokenEndpoint: ctx.fake.state.urls.token,
          code: s.code,
          verifier: 'wrong-verifier-wrong-verifier-wrong-verifier-0000',
          clientId: s.clientId,
          redirectUri: REDIRECT,
          resource: ctx.resource,
        },
        ctx.deps,
      ),
    );
    expect(kind).toBe('exchange-failed');
    expect(ctx.fake.state.processed.proxy).toBe(0);
  });

  it('does not fall through to the proxy when the direct attempt is aborted', async () => {
    const ctx = setup({}, true, {
      wrapFetch: (inner: typeof fetch) =>
        ((input: RequestInfo | URL, init?: RequestInit) =>
          String(input).startsWith('https://proxy.example')
            ? inner(input, init)
            : Promise.reject(new DOMException('aborted', 'AbortError'))) as typeof fetch,
    });
    expect(await kindOf(exchange(ctx))).toBe('network');
    expect(ctx.fake.state.processed.proxy).toBe(0);
  });

  it('does not fall through to the proxy when reading the direct response body fails', async () => {
    const ctx = setup({}, true, {
      wrapFetch: (inner: typeof fetch) =>
        ((input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input).startsWith('https://proxy.example')) return inner(input, init);
          return Promise.resolve(
            new Response(
              new ReadableStream({
                pull() {
                  throw new TypeError('terminated');
                },
              }),
              { status: 200 },
            ),
          );
        }) as typeof fetch,
    });
    expect(await kindOf(exchange(ctx))).toBe('network');
    expect(ctx.fake.state.processed.proxy).toBe(0);
  });

  it('gives a null refresh token when the server issues none', async () => {
    const { tokens } = await exchange(setup({ issueRefresh: false }));
    expect(tokens.refreshToken).toBeNull();
  });

  it('gives a null expiry without expires_in, and now + expires_in otherwise', async () => {
    expect((await exchange(setup({ expiresIn: null }))).tokens.accessExpiresAt).toBeNull();
    const now = () => 1_000_000;
    const { tokens } = await exchange(setup({ expiresIn: 3600, now }));
    expect(tokens.accessExpiresAt).toBe(1_000_000 + 3_600_000);
  });

  it('refuses an insecure token endpoint before sending', async () => {
    const ctx = setup();
    const s = await signIn(ctx);
    const kind = await kindOf(
      exchangeCode(
        {
          tokenEndpoint: 'http://auth.example/token',
          code: s.code,
          verifier: s.verifier,
          clientId: s.clientId,
          redirectUri: REDIRECT,
          resource: ctx.resource,
        },
        ctx.deps,
      ),
    );
    expect(kind).toBe('not-secure');
    expect(ctx.fake.state.log).toEqual([]);
  });

  it('rejects malformed token responses', async () => {
    const bodies = [
      'not json',
      JSON.stringify({ token_type: 'Bearer' }),
      JSON.stringify({ access_token: 'a', token_type: 'mac' }),
      JSON.stringify({ access_token: 5, token_type: 'Bearer' }),
    ];
    for (const body of bodies) {
      const fetcher = (async () => new Response(body, { status: 200 })) as typeof fetch;
      const ctx = setup({}, true, { replaceFetch: fetcher });
      expect(await kindOf(exchange(ctx))).toBe('exchange-failed');
    }
  });

  it('accepts a lower-case bearer type and ignores a bad expires_in', async () => {
    const fetcher = (async () =>
      new Response(JSON.stringify({ access_token: 'a', token_type: 'bearer', expires_in: -5 }), {
        status: 200,
      })) as typeof fetch;
    const { tokens } = await exchange(setup({}, true, { replaceFetch: fetcher }));
    expect(tokens.accessToken === 'a').toBe(true);
    expect(tokens.accessExpiresAt).toBeNull();
  });

  it('rejects an oversized response', async () => {
    const fetcher = (async () =>
      new Response(JSON.stringify({ access_token: 'a'.repeat(300 * 1024), token_type: 'Bearer' }), {
        status: 200,
      })) as typeof fetch;
    expect(await kindOf(exchange(setup({}, true, { replaceFetch: fetcher })))).toBe(
      'exchange-failed',
    );
  });

  it('keeps code, verifier and tokens out of error messages', async () => {
    const messages: string[] = [];
    const secrets: string[] = [];
    const collect = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        messages.push(err instanceof Error ? err.message : '');
      }
    };
    // Answered error, replayed code.
    const a = setup();
    const s = await signIn(a);
    secrets.push(s.code, s.verifier);
    const args = {
      tokenEndpoint: a.fake.state.urls.token,
      code: s.code,
      verifier: s.verifier,
      clientId: s.clientId,
      redirectUri: REDIRECT,
      resource: a.resource,
    };
    await exchangeCode(args, a.deps);
    await collect(() => exchangeCode(args, a.deps));
    // Network failure.
    const b = setup({ cors: false }, false);
    const s2 = await signIn(b);
    secrets.push(s2.code, s2.verifier);
    await collect(() =>
      exchangeCode(
        { ...args, tokenEndpoint: b.fake.state.urls.token, code: s2.code, verifier: s2.verifier },
        b.deps,
      ),
    );
    // Refresh failures with a spent token.
    const r = setup({ graceSeconds: 0 });
    const first = await exchange(r);
    const old = first.tokens.refreshToken ?? '';
    const second = await refresh(r, old);
    secrets.push(old, first.tokens.accessToken, second.accessToken);
    await collect(() => refresh(r, old));
    const r503 = setup({}, true, {
      replaceFetch: (async () => new Response('x', { status: 503 })) as typeof fetch,
    });
    await collect(() => refresh(r503, old));
    expect(messages.length).toBeGreaterThanOrEqual(4);
    const leaked = messages.some((m) => secrets.some((x) => x !== '' && m.includes(x)));
    expect(leaked).toBe(false);
  });
});

describe('refreshTokens', () => {
  it('rotates and returns a new pair', async () => {
    const ctx = setup();
    const { tokens } = await exchange(ctx);
    const next = await refresh(ctx, tokens.refreshToken ?? '');
    expect(next.accessToken !== tokens.accessToken).toBe(true);
    expect(next.refreshToken !== tokens.refreshToken).toBe(true);
  });

  it('keeps the old refresh token when none is returned (rotate: false)', async () => {
    const ctx = setup({ rotate: false });
    const { tokens } = await exchange(ctx);
    const next = await refresh(ctx, tokens.refreshToken ?? '');
    expect(next.refreshToken === tokens.refreshToken).toBe(true);
  });

  it('sends resource, client_id and grant_type', async () => {
    const seen: string[] = [];
    const base = createFakeAuthServer();
    const spy = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/token')) seen.push(String(init?.body));
      return base.fetch(input, init);
    }) as typeof fetch;
    const ctx = setup({}, true, { replaceFetch: spy });
    // Use the same fake for minting: reuse ctx.fake only for urls; mint through base.
    const { verifier, challenge } = await createPkce();
    const { code } = await base.state.authorise({
      redirectUri: REDIRECT,
      state: 's',
      codeChallenge: challenge,
    });
    const { tokens } = await exchangeCode(
      {
        tokenEndpoint: base.state.urls.token,
        code,
        verifier,
        clientId: 'client-x',
        redirectUri: REDIRECT,
        resource: base.state.urls.mcp,
      },
      ctx.deps,
    );
    await refreshTokens(
      {
        tokenEndpoint: base.state.urls.token,
        refreshToken: tokens.refreshToken ?? '',
        clientId: 'client-x',
        resource: base.state.urls.mcp,
        route: 'direct',
      },
      ctx.deps,
    );
    const form = new URLSearchParams(seen[1]);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('resource')).toBe(base.state.urls.mcp);
    expect(form.get('client_id')).toBe('client-x');
  });

  it('throws invalid-grant on invalid_grant', async () => {
    const ctx = setup();
    expect(await kindOf(refresh(ctx, 'rt-unknown'))).toBe('invalid-grant');
  });

  it('throws network on a TypeError and makes no proxy attempt', async () => {
    const ctx = setup({ cors: false });
    expect(await kindOf(refresh(ctx, 'rt-1', 'direct'))).toBe('network');
    expect(ctx.fake.state.processed.proxy).toBe(0);
    expect(ctx.fake.state.refreshAttempts).toEqual([]);
  });

  it('throws network for a lost response, which the server did process', async () => {
    const ctx = setup();
    const { tokens } = await exchange(ctx);
    ctx.fake.state.loseNextTokenResponse = true;
    expect(await kindOf(refresh(ctx, tokens.refreshToken ?? ''))).toBe('network');
    expect(ctx.fake.state.refreshAttempts).toHaveLength(1);
  });

  it('throws network when the caller signal aborts', async () => {
    const base = createFakeAuthServer();
    const honouring = ((input: RequestInfo | URL, init?: RequestInit) => {
      init?.signal?.throwIfAborted();
      return base.fetch(input, init);
    }) as typeof fetch;
    const ctx = setup({}, true, { replaceFetch: honouring });
    const c = new AbortController();
    c.abort();
    expect(await kindOf(refresh(ctx, 'rt-1', 'direct', c.signal))).toBe('network');
    expect(base.state.refreshAttempts).toEqual([]);
  });

  it('aborts its own request after 20 s and reports network', async () => {
    vi.useFakeTimers();
    let aborted = false;
    const hang = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('aborted', 'AbortError'));
        });
      })) as typeof fetch;
    const ctx = setup({}, true, { replaceFetch: hang });
    const pending = kindOf(refresh(ctx, 'rt-1'));
    await vi.advanceTimersByTimeAsync(19_999);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(aborted).toBe(true);
    expect(await pending).toBe('network');
  });

  it('throws refresh-failed on 503, 429, invalid_client and non-JSON', async () => {
    const answers: [number, string][] = [
      [503, 'down'],
      [429, '{"error":"slow_down"}'],
      [401, '{"error":"invalid_client"}'],
      [502, 'not json'],
    ];
    for (const [status, body] of answers) {
      const fetcher = (async () => new Response(body, { status })) as typeof fetch;
      const ctx = setup({}, true, { replaceFetch: fetcher });
      expect(await kindOf(refresh(ctx, 'rt-1'))).toBe('refresh-failed');
    }
  });

  it('treats an unusable 200 as a lost response', async () => {
    const bodies = [
      'not json',
      JSON.stringify({ token_type: 'Bearer' }),
      JSON.stringify({ access_token: 'a'.repeat(300 * 1024), token_type: 'Bearer' }),
    ];
    for (const body of bodies) {
      const replaceFetch = (async () => new Response(body, { status: 200 })) as typeof fetch;
      const ctx = setup({}, true, { replaceFetch });
      expect(await kindOf(refresh(ctx, 'rt-1'))).toBe('network');
    }
  });

  it('caps the size of an error body without failing differently', async () => {
    const replaceFetch = (async () =>
      new Response('x'.repeat(300 * 1024), { status: 503 })) as typeof fetch;
    const ctx = setup({}, true, { replaceFetch });
    expect(await kindOf(refresh(ctx, 'rt-1'))).toBe('refresh-failed');
  });

  it('reports any non-TypeError failure after sending as network', async () => {
    for (const make of [
      () => new DOMException('x', 'NetworkError'),
      () => new Error('stream broke'),
    ]) {
      const replaceFetch = (() => Promise.reject(make())) as typeof fetch;
      const ctx = setup({}, true, { replaceFetch });
      expect(await kindOf(refresh(ctx, 'rt-1'))).toBe('network');
    }
  });

  it('reports a body-read failure as network', async () => {
    const replaceFetch = (async () => {
      const body = new ReadableStream({
        pull() {
          throw new TypeError('terminated');
        },
      });
      return new Response(body, { status: 200 });
    }) as typeof fetch;
    const ctx = setup({}, true, { replaceFetch });
    expect(await kindOf(refresh(ctx, 'rt-1'))).toBe('network');
  });

  it('clears its timeout after a successful refresh', async () => {
    vi.useFakeTimers();
    const ctx = setup();
    const { tokens } = await exchange(ctx);
    expect(vi.getTimerCount()).toBe(0);
    await refresh(ctx, tokens.refreshToken ?? '');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not use the proxy for a direct route that returned an error', async () => {
    const ctx = setup();
    await kindOf(refresh(ctx, 'rt-unknown'));
    expect(ctx.fake.state.processed.proxy).toBe(0);
  });

  it('uses the proxy only when told to', async () => {
    const ctx = setup({ cors: false });
    const { tokens } = await exchange(ctx);
    const next = await refresh(ctx, tokens.refreshToken ?? '', 'proxy');
    expect(next.accessToken.startsWith('at-')).toBe(true);
    expect(ctx.fake.state.refreshAttempts.at(-1)?.route).toBe('proxy');
  });
});

describe('revokeToken', () => {
  const args = (ctx: ReturnType<typeof setup>, token: string, route: 'direct' | 'proxy') => ({
    revocationEndpoint: ctx.fake.state.urls.revocation,
    token,
    clientId: 'client-x',
    route,
  });

  it('returns true on 200 and revokes the family', async () => {
    const ctx = setup();
    const { tokens } = await exchange(ctx);
    expect(await revokeToken(args(ctx, tokens.refreshToken ?? '', 'direct'), ctx.deps)).toBe(true);
    expect(
      ctx.fake.state.revoked.length === 1 && ctx.fake.state.revoked[0] === tokens.refreshToken,
    ).toBe(true);
    expect(ctx.fake.state.familyRevoked).toBe(true);
  });

  it('returns false on failure and never throws', async () => {
    const ctx = setup({ cors: false });
    expect(await revokeToken(args(ctx, 'rt-1', 'direct'), ctx.deps)).toBe(false);
    const down = setup({}, true, {
      replaceFetch: (async () => new Response('', { status: 500 })) as typeof fetch,
    });
    expect(await revokeToken(args(down, 'rt-1', 'direct'), down.deps)).toBe(false);
    const bad = { ...args(ctx, 'rt-1', 'direct'), revocationEndpoint: 'javascript:alert(1)' };
    expect(await revokeToken(bad, ctx.deps)).toBe(false);
  });
});
