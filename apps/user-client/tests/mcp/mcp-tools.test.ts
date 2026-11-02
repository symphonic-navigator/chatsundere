// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mcpToolsCall } from '../../src/mcp/mcp-client.js';
import { type McpToolContext, contributeMcpTools } from '../../src/mcp/mcp-tools.js';

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
    requestApproval: async () => true,
    resolveRoute: async () => ({ ok: false, error: 'not expected' }),
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

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
