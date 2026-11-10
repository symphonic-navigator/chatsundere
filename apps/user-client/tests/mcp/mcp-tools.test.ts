// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mcpToolsCall } from '../../src/mcp/mcp-client.js';
import {
  type McpActiveServer,
  type McpToolContext,
  contributeMcpTools,
} from '../../src/mcp/mcp-tools.js';

vi.mock('../../src/mcp/mcp-client.js', () => ({
  mcpToolsCall: vi.fn(async (_e: unknown, name: string) => ({
    stdout: `ran ${name}`,
    error: null,
  })),
}));

function ctx(over: Partial<McpToolContext> = {}): McpToolContext {
  return {
    servers: [
      {
        id: 's1',
        name: 'GitHub',
        prefix: 'github',
        url: 'https://gh/mcp',
        hasConsent: true,
        routing: 'direct',
        resolvedEndpoint: 'https://gh/mcp',
        auth: { scheme: 'bearer' },
        autoRun: true,
        tools: [
          { name: 'search', description: 'd', inputSchema: { type: 'object' } },
          { name: 'secret', description: 'd', inputSchema: {} },
        ],
        hiddenTools: ['secret'],
      },
    ],
    getServerKey: async () => 'tok',
    getOAuthToken: async () => ({ ok: false, reason: 'no-grant' }),
    requestApproval: async () => true,
    requestFirstUse: async () => true,
    recordConsent: async () => undefined,
    resolveRoute: async () => ({ ok: false, error: 'not expected' }),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(mcpToolsCall).mockImplementation(async (_e, name) => ({
    stdout: `ran ${name}`,
    error: null,
  }));
});

describe('contributeMcpTools', () => {
  it('builds prefixed tools, excluding hidden ones', () => {
    const tools = contributeMcpTools(ctx());
    expect(tools.map((t) => t.name)).toEqual(['github_search']);
  });

  it('executes via mcpToolsCall when autoRun is on', async () => {
    const tools = contributeMcpTools(ctx());
    const r = await tools[0]?.execute({ q: 'x' });
    expect(r).toEqual({ ok: true, output: 'ran search', error: null });
  });

  it('returns a constructive error when the user denies', async () => {
    const getServerKey = vi.fn(async () => null);
    const tools = contributeMcpTools(
      ctx({
        servers: [
          {
            id: 's1',
            name: 'GitHub',
            prefix: 'github',
            url: 'https://gh/mcp',
            hasConsent: true,
            routing: 'direct',
            resolvedEndpoint: 'https://gh/mcp',
            auth: null,
            autoRun: false,
            tools: [{ name: 'search', description: 'd', inputSchema: {} }],
            hiddenTools: [],
          },
        ],
        getServerKey,
        requestApproval: async () => false,
      }),
    );
    const r = await tools[0]?.execute({});
    expect(r?.ok).toBe(false);
    expect(r?.error).toMatch(/declined/i);
    // Deny must abort before decrypt — getServerKey must never be called.
    expect(getServerKey).not.toHaveBeenCalled();
    expect(vi.mocked(mcpToolsCall)).not.toHaveBeenCalled();
  });
});

describe('contributeMcpTools on a device without a route', () => {
  const unrouted = (over: Partial<McpToolContext> = {}): McpToolContext =>
    ctx({
      servers: [
        {
          id: 's1',
          name: 'GitHub',
          prefix: 'github',
          url: 'https://gh/mcp',
          hasConsent: true,
          routing: null,
          resolvedEndpoint: null,
          auth: { scheme: 'bearer' },
          autoRun: true,
          tools: [{ name: 'search', description: 'd', inputSchema: {} }],
          hiddenTools: [],
        },
      ],
      ...over,
    });

  it('resolves the route with the opened key, then calls through it', async () => {
    const resolveRoute = vi.fn(async () => ({
      ok: true as const,
      routing: 'proxy' as const,
      resolvedEndpoint: 'https://gh/mcp',
    }));
    const [tool] = contributeMcpTools(unrouted({ resolveRoute }));
    const r = await tool?.execute({});
    expect(resolveRoute).toHaveBeenCalledWith(
      's1',
      { header: 'Authorization', value: 'Bearer tok' },
      undefined,
    );
    expect(mcpToolsCall).toHaveBeenCalledWith(
      { url: 'https://gh/mcp', routing: 'proxy', auth: expect.anything() },
      'search',
      {},
      expect.any(Number),
      undefined,
    );
    expect(r?.ok).toBe(true);
  });

  it('resolves only once across calls in the same send', async () => {
    const resolveRoute = vi.fn(async () => ({
      ok: true as const,
      routing: 'direct' as const,
      resolvedEndpoint: 'https://gh/mcp',
    }));
    const [tool] = contributeMcpTools(unrouted({ resolveRoute }));
    await tool?.execute({});
    await tool?.execute({});
    expect(resolveRoute).toHaveBeenCalledTimes(1);
  });

  it('passes the Stop signal to the probe', async () => {
    const resolveRoute = vi.fn(async () => ({ ok: false as const, error: 'stopped' }));
    const [tool] = contributeMcpTools(unrouted({ resolveRoute }));
    const stop = new AbortController();
    await tool?.execute({}, stop.signal);
    expect(resolveRoute).toHaveBeenCalledWith('s1', expect.anything(), stop.signal);
  });

  it('retries the probe after it threw', async () => {
    const resolveRoute = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValue({ ok: true, routing: 'proxy', resolvedEndpoint: 'https://gh/mcp' });
    const [tool] = contributeMcpTools(unrouted({ resolveRoute }));
    expect((await tool?.execute({}))?.ok).toBe(false);
    expect((await tool?.execute({}))?.ok).toBe(true);
  });

  it('reports an unreachable server without calling it', async () => {
    const resolveRoute = vi.fn(async () => ({ ok: false as const, error: 'HTTP 503' }));
    const [tool] = contributeMcpTools(unrouted({ resolveRoute }));
    const r = await tool?.execute({});
    expect(r?.ok).toBe(false);
    expect(r?.error).toContain('HTTP 503');
    expect(mcpToolsCall).not.toHaveBeenCalled();
  });

  it('sends nothing to the server, not even a probe, when the user declines', async () => {
    const resolveRoute = vi.fn();
    const getServerKey = vi.fn(async () => 'tok');
    const context = unrouted({ resolveRoute, getServerKey, requestApproval: async () => false });
    const server = context.servers[0];
    if (server) server.autoRun = false;
    const [tool] = contributeMcpTools(context);
    await tool?.execute({});
    expect(getServerKey).not.toHaveBeenCalled();
    expect(resolveRoute).not.toHaveBeenCalled();
  });
});

const keyServer = (over: Partial<McpActiveServer> = {}): McpActiveServer => ({
  id: 'k',
  name: 'Keyed',
  prefix: 'keyed',
  url: 'https://keyed.example/mcp',
  routing: 'proxy',
  resolvedEndpoint: 'https://keyed.example/mcp',
  auth: { scheme: 'bearer' },
  autoRun: true,
  hasConsent: false,
  tools: [{ name: 'go', description: 'd', inputSchema: {} }],
  hiddenTools: [],
  ...over,
});
const oauthServer = (over: Partial<McpActiveServer> = {}): McpActiveServer =>
  keyServer({
    id: 'o',
    name: 'Kumbu',
    prefix: 'kumbu',
    url: 'https://kumbu.example/mcp',
    resolvedEndpoint: 'https://kumbu.example/mcp',
    auth: { scheme: 'oauth' },
    hasConsent: true,
    ...over,
  });
const one = (server: McpActiveServer, over: Partial<McpToolContext> = {}) =>
  contributeMcpTools(ctx({ servers: [server], ...over }))[0];

describe('first-use consent', () => {
  it('asks once on a key server under autoRun without consent, before opening the key', async () => {
    const order: string[] = [];
    const requestFirstUse = vi.fn(async () => {
      order.push('consent');
      return true;
    });
    const getServerKey = vi.fn(async () => {
      order.push('key');
      return 'tok';
    });
    const recordConsent = vi.fn(async () => undefined);
    const tool = one(keyServer(), { requestFirstUse, getServerKey, recordConsent });
    const r = await tool?.execute({});
    expect(r?.ok).toBe(true);
    expect(requestFirstUse).toHaveBeenCalledTimes(1);
    expect(requestFirstUse).toHaveBeenCalledWith({
      serverId: 'k',
      serverName: 'Keyed',
      host: 'keyed.example',
    });
    expect(recordConsent).toHaveBeenCalledWith('k', 'https://keyed.example/mcp');
    expect(order).toEqual(['consent', 'key']);
    await tool?.execute({});
    expect(requestFirstUse).toHaveBeenCalledTimes(1);
  });

  it('does not ask when this device already has consent', async () => {
    const requestFirstUse = vi.fn(async () => true);
    const tool = one(keyServer({ hasConsent: true }), { requestFirstUse });
    expect((await tool?.execute({}))?.ok).toBe(true);
    expect(requestFirstUse).not.toHaveBeenCalled();
  });

  it('a denied first use stores nothing and opens nothing', async () => {
    const recordConsent = vi.fn(async () => undefined);
    const getServerKey = vi.fn(async () => 'tok');
    const getOAuthToken = vi.fn(async () => ({ ok: true as const, accessToken: 'at' }));
    const resolveRoute = vi.fn();
    for (const server of [keyServer(), oauthServer({ hasConsent: false })]) {
      const tool = one(server, {
        requestFirstUse: async () => false,
        recordConsent,
        getServerKey,
        getOAuthToken,
        resolveRoute,
      });
      const r = await tool?.execute({});
      expect(r).toMatchObject({ ok: false, error: 'Tool call declined by the user.' });
    }
    expect(recordConsent).not.toHaveBeenCalled();
    expect(getServerKey).not.toHaveBeenCalled();
    expect(getOAuthToken).not.toHaveBeenCalled();
    expect(resolveRoute).not.toHaveBeenCalled();
    expect(mcpToolsCall).not.toHaveBeenCalled();
  });

  it('asks one prompt on a server without autoRun, carrying the first-use wording, and approving records consent', async () => {
    const requestFirstUse = vi.fn(async () => true);
    const requestApproval = vi.fn(async () => true);
    const recordConsent = vi.fn(async () => undefined);
    const tool = one(keyServer({ autoRun: false }), {
      requestFirstUse,
      requestApproval,
      recordConsent,
    });
    expect((await tool?.execute({ q: 1 }))?.ok).toBe(true);
    expect(requestFirstUse).not.toHaveBeenCalled();
    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(requestApproval).toHaveBeenCalledWith({
      serverId: 'k',
      serverName: 'Keyed',
      toolName: 'go',
      args: { q: 1 },
      host: 'keyed.example',
      firstUse: true,
    });
    expect(recordConsent).toHaveBeenCalledWith('k', 'https://keyed.example/mcp');
  });

  it('a denied approval stores no consent', async () => {
    const recordConsent = vi.fn(async () => undefined);
    const tool = one(keyServer({ autoRun: false }), {
      requestApproval: async () => false,
      recordConsent,
    });
    expect((await tool?.execute({}))?.ok).toBe(false);
    expect(recordConsent).not.toHaveBeenCalled();
  });

  it('an approval with consent already in place says so', async () => {
    const requestApproval = vi.fn(async () => true);
    const tool = one(keyServer({ autoRun: false, hasConsent: true }), { requestApproval });
    await tool?.execute({});
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({ firstUse: false }));
  });
});

describe('OAuth tool calls', () => {
  it('sends the access token as a bearer header to the resolved endpoint', async () => {
    const tool = one(oauthServer(), {
      getOAuthToken: async () => ({ ok: true, accessToken: 'at-1' }),
    });
    const r = await tool?.execute({});
    expect(r?.ok).toBe(true);
    expect(mcpToolsCall).toHaveBeenCalledWith(
      {
        url: 'https://kumbu.example/mcp',
        routing: 'proxy',
        auth: { header: 'Authorization', value: 'Bearer at-1' },
      },
      'go',
      {},
      expect.any(Number),
      undefined,
    );
  });

  it('never attaches the token to an endpoint other than the server URL', async () => {
    const tool = one(oauthServer({ resolvedEndpoint: 'https://kumbu.example/other' }), {
      getOAuthToken: async () => ({ ok: true, accessToken: 'at-1' }),
    });
    const r = await tool?.execute({});
    expect(r?.ok).toBe(false);
    expect(mcpToolsCall).not.toHaveBeenCalled();
  });

  it('reports renewing through onProgress while waiting for a token', async () => {
    const onProgress = vi.fn();
    const tool = one(oauthServer(), {
      getOAuthToken: async (_id, opts) => {
        opts?.onWaiting?.();
        return { ok: true, accessToken: 'at' };
      },
    });
    await tool?.execute({}, undefined, onProgress);
    expect(onProgress).toHaveBeenCalledWith({ charCount: 0, phase: 'renewing' });
  });

  it.each([
    ['dead', 'dead'],
    ['held', 'held'],
    ['waiting', 'waiting'],
    ['in-doubt', 'waiting'],
    ['no-grant', 'waiting'],
    ['no-proxy', 'waiting'],
  ] as const)(
    'maps a %s token result to the %s notice without calling',
    async (reason, variant) => {
      const tool = one(oauthServer(), { getOAuthToken: async () => ({ ok: false, reason }) });
      const r = await tool?.execute({});
      expect(r?.ok).toBe(false);
      expect(r?.meta).toEqual({ mcpAuth: { serverId: 'o', serverName: 'Kumbu', variant } });
      expect(r?.error).toMatch(/Kumbu/);
      expect(r?.error).toMatch(/do not retry/i);
      expect(mcpToolsCall).not.toHaveBeenCalled();
    },
  );

  it('tells the model a held sign-in is paused, never that it ended', async () => {
    const tool = one(oauthServer(), {
      getOAuthToken: async () => ({ ok: false, reason: 'held' }),
    });
    const r = await tool?.execute({});
    expect(r?.ok).toBe(false);
    expect(r?.error).toBe(
      'Kumbu is unavailable: its sign-in is paused on this device, and the user can sign in again. Tell the user, and do not retry this tool in this turn.',
    );
    expect(r?.error).not.toMatch(/has ended/);
    expect(r?.meta).toEqual({ mcpAuth: { serverId: 'o', serverName: 'Kumbu', variant: 'held' } });
    expect(mcpToolsCall).not.toHaveBeenCalled();
  });

  it('asks the user to unlock when locked, with no notice', async () => {
    const tool = one(oauthServer(), {
      getOAuthToken: async () => ({ ok: false, reason: 'locked' }),
    });
    const r = await tool?.execute({});
    expect(r?.ok).toBe(false);
    expect(r?.meta).toBeUndefined();
    expect(r?.error).toMatch(/unlock/i);
  });

  it('retries a 401 once with the rejected token, and reports dead on a second 401', async () => {
    vi.mocked(mcpToolsCall).mockResolvedValue({
      stdout: '',
      error: 'MCP server returned HTTP 401',
      auth: 'required',
    });
    const getOAuthToken = vi
      .fn<McpToolContext['getOAuthToken']>()
      .mockResolvedValueOnce({ ok: true, accessToken: 'at-1' })
      .mockResolvedValueOnce({ ok: true, accessToken: 'at-2' })
      .mockResolvedValue({ ok: true, accessToken: 'at-3' });
    const tool = one(oauthServer(), { getOAuthToken });
    const r = await tool?.execute({});
    expect(mcpToolsCall).toHaveBeenCalledTimes(2);
    expect(getOAuthToken).toHaveBeenCalledTimes(2);
    expect(getOAuthToken).toHaveBeenNthCalledWith(
      2,
      'o',
      expect.objectContaining({ rejectedToken: 'at-1' }),
    );
    expect(r?.meta).toEqual({ mcpAuth: { serverId: 'o', serverName: 'Kumbu', variant: 'dead' } });
  });

  it('succeeds after one 401 when the renewed token is accepted', async () => {
    vi.mocked(mcpToolsCall)
      .mockResolvedValueOnce({ stdout: '', error: 'HTTP 401', auth: 'required' })
      .mockResolvedValueOnce({ stdout: 'done', error: null });
    const getOAuthToken = vi
      .fn<McpToolContext['getOAuthToken']>()
      .mockResolvedValueOnce({ ok: true, accessToken: 'at-1' })
      .mockResolvedValueOnce({ ok: true, accessToken: 'at-2' });
    const r = await one(oauthServer(), { getOAuthToken })?.execute({});
    expect(r).toEqual({ ok: true, output: 'done', error: null });
  });

  it('never retries a 500', async () => {
    vi.mocked(mcpToolsCall).mockResolvedValue({
      stdout: '',
      error: 'MCP server returned HTTP 500',
    });
    const getOAuthToken = vi.fn(async () => ({ ok: true as const, accessToken: 'at' }));
    const r = await one(oauthServer(), { getOAuthToken })?.execute({});
    expect(r?.ok).toBe(false);
    expect(mcpToolsCall).toHaveBeenCalledTimes(1);
    expect(getOAuthToken).toHaveBeenCalledTimes(1);
    expect(r?.meta).toBeUndefined();
  });

  it('a 403 with insufficient_scope gives the scope notice', async () => {
    vi.mocked(mcpToolsCall).mockResolvedValue({
      stdout: '',
      error: 'MCP server returned HTTP 403',
      auth: 'insufficient-scope',
      scope: 'write',
    });
    const r = await one(oauthServer(), {
      getOAuthToken: async () => ({ ok: true, accessToken: 'at' }),
    })?.execute({});
    expect(r?.meta).toEqual({
      mcpAuth: { serverId: 'o', serverName: 'Kumbu', variant: 'scope', scope: 'write' },
    });
    expect(mcpToolsCall).toHaveBeenCalledTimes(1);
  });

  it('a 401 on a key server stays an ordinary error, sent once', async () => {
    vi.mocked(mcpToolsCall).mockResolvedValue({
      stdout: '',
      error: 'MCP server returned HTTP 401',
      auth: 'required',
    });
    const r = await one(keyServer({ hasConsent: true }))?.execute({});
    expect(r).toEqual({ ok: false, output: '', error: 'MCP server returned HTTP 401' });
    expect(mcpToolsCall).toHaveBeenCalledTimes(1);
  });

  it('a 401 during the first-use probe renews the token and probes again once', async () => {
    const resolveRoute = vi
      .fn<McpToolContext['resolveRoute']>()
      .mockResolvedValueOnce({ ok: false, error: 'HTTP 401', auth: 'required' })
      .mockResolvedValueOnce({
        ok: true,
        routing: 'proxy',
        resolvedEndpoint: 'https://kumbu.example/mcp',
      });
    const getOAuthToken = vi
      .fn<McpToolContext['getOAuthToken']>()
      .mockResolvedValueOnce({ ok: true, accessToken: 'at-1' })
      .mockResolvedValueOnce({ ok: true, accessToken: 'at-2' });
    const r = await one(oauthServer({ routing: null, resolvedEndpoint: null }), {
      resolveRoute,
      getOAuthToken,
    })?.execute({});
    expect(r?.ok).toBe(true);
    expect(resolveRoute).toHaveBeenCalledTimes(2);
    expect(resolveRoute).toHaveBeenLastCalledWith(
      'o',
      { header: 'Authorization', value: 'Bearer at-2' },
      undefined,
    );
  });

  it('gives one notice per server per send; later calls fail at once without meta', async () => {
    const getOAuthToken = vi.fn(async () => ({ ok: false as const, reason: 'dead' as const }));
    const context = ctx({
      servers: [
        oauthServer({
          tools: [
            { name: 'a', description: 'd', inputSchema: {} },
            { name: 'b', description: 'd', inputSchema: {} },
          ],
        }),
      ],
      getOAuthToken,
    });
    const [a, b] = contributeMcpTools(context);
    const first = await a?.execute({});
    const second = await b?.execute({});
    const third = await a?.execute({});
    expect(first?.meta).toBeDefined();
    expect(second?.meta).toBeUndefined();
    expect(third?.meta).toBeUndefined();
    expect(second?.error).toBe(first?.error);
    expect(getOAuthToken).toHaveBeenCalledTimes(1);
  });

  it('never lets a bearer value reach ToolResult.error', async () => {
    vi.mocked(mcpToolsCall).mockResolvedValue({
      stdout: '',
      error: 'upstream said: Authorization: Bearer at-secret-1 was bad; raw at-secret-1',
    });
    const r = await one(oauthServer(), {
      getOAuthToken: async () => ({ ok: true, accessToken: 'at-secret-1' }),
    })?.execute({});
    expect(r?.ok).toBe(false);
    expect(r?.error).not.toContain('at-secret-1');
  });

  it('scrubs a bearer value from a thrown error too', async () => {
    vi.mocked(mcpToolsCall).mockRejectedValue(new Error('boom Bearer zzz-key-9'));
    const r = await one(keyServer({ hasConsent: true }), {
      getServerKey: async () => 'zzz-key-9',
    })?.execute({});
    expect(r?.error).not.toContain('zzz-key-9');
  });
});

describe('fix round 1: parallel calls and non-OAuth rows', () => {
  it('two parallel calls to one server ask one first-use question', async () => {
    let answer: (ok: boolean) => void = () => undefined;
    const requestFirstUse = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    );
    const recordConsent = vi.fn(async () => undefined);
    const tool = one(keyServer(), { requestFirstUse, recordConsent });
    const a = tool?.execute({});
    const b = tool?.execute({});
    await Promise.resolve();
    answer(true);
    const [ra, rb] = await Promise.all([a, b]);
    expect(requestFirstUse).toHaveBeenCalledTimes(1);
    expect(recordConsent).toHaveBeenCalledTimes(1);
    expect(ra?.ok).toBe(true);
    expect(rb?.ok).toBe(true);
  });

  it('a "Not now" answers only the waiting calls; the next call asks again', async () => {
    const requestFirstUse = vi.fn(async () => false);
    const tool = one(keyServer(), { requestFirstUse });
    await Promise.all([tool?.execute({}), tool?.execute({})]);
    expect(requestFirstUse).toHaveBeenCalledTimes(1);
    await tool?.execute({});
    expect(requestFirstUse).toHaveBeenCalledTimes(2);
  });

  it('two parallel calls that both fail on the token give one notice', async () => {
    const getOAuthToken = vi.fn(async () => ({ ok: false as const, reason: 'dead' as const }));
    const tool = one(oauthServer(), { getOAuthToken });
    const [a, b] = await Promise.all([tool?.execute({}), tool?.execute({})]);
    const metas = [a, b].filter((r) => r?.meta !== undefined);
    expect(metas).toHaveLength(1);
    expect(a?.error).toBe(b?.error);
  });

  it('a non-OAuth row gives a plain error, not a notice', async () => {
    const r = await one(oauthServer(), {
      getOAuthToken: async () => ({ ok: false, reason: 'not-oauth' }),
    })?.execute({});
    expect(r?.ok).toBe(false);
    expect(r?.meta).toBeUndefined();
  });
});
