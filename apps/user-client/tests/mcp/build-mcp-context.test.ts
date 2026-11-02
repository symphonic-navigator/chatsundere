// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServerRow } from '../../src/boot/client-data-db.js';
import { persistMcpRoute } from '../../src/data/mcp-servers.js';
import { buildMcpContext } from '../../src/mcp/build-mcp-context.js';
import { testMcpConnection } from '../../src/mcp/mcp-connectivity.js';

vi.mock('../../src/data/mcp-servers.js', () => ({
  openMcpKey: vi.fn(),
  persistMcpRoute: vi.fn(),
}));
vi.mock('../../src/mcp/mcp-connectivity.js', () => ({ testMcpConnection: vi.fn() }));

const server = (over: Partial<McpServerRow>): McpServerRow => ({
  id: 's',
  name: 'S',
  url: 'https://s/mcp',
  prefix: 's',
  auth: {
    scheme: 'bearer',
    key: { version: 1, ciphertext: new Uint8Array(), nonce: new Uint8Array() } as unknown as never,
  },
  onByDefault: true,
  autoRun: false,
  allowDirect: true,
  enabled: true,
  routing: 'direct',
  resolvedEndpoint: 'https://s/mcp',
  tools: [{ name: 'go', description: '', inputSchema: {} }],
  hiddenTools: [],
  lastTestedAt: 1,
  lastError: null,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe('buildMcpContext', () => {
  it('returns null when no servers resolve active', () => {
    const ctx = buildMcpContext({
      servers: [server({ enabled: false })],
      overrides: {},
      hasProxy: true,
      mk: {} as unknown as never,
      requestApproval: async () => true,
    });
    expect(ctx).toBeNull();
  });

  it('maps active servers, stripping the sealed key from the active descriptor', () => {
    const ctx = buildMcpContext({
      servers: [server({})],
      overrides: {},
      hasProxy: true,
      mk: {} as unknown as never,
      requestApproval: async () => true,
    });
    expect(ctx).not.toBeNull();
    expect(ctx?.servers[0]).toMatchObject({ id: 's', prefix: 's', auth: { scheme: 'bearer' } });
    expect(ctx?.servers[0]?.tools).toBeDefined();
    expect((ctx?.servers[0]?.auth as Record<string, unknown>).key).toBeUndefined();
  });
});

describe('buildMcpContext route resolution', () => {
  const unrouted = () => {
    const { routing: _r, resolvedEndpoint: _e, ...rest } = server({ allowDirect: false });
    return rest as McpServerRow;
  };
  const build = () =>
    buildMcpContext({
      servers: [unrouted()],
      overrides: {},
      hasProxy: true,
      mk: {} as unknown as never,
      requestApproval: async () => true,
    });

  beforeEach(() => {
    vi.mocked(testMcpConnection).mockReset();
    vi.mocked(persistMcpRoute).mockReset();
  });

  it('carries a row without probe fields as unrouted rather than undefined', () => {
    expect(build()?.servers[0]).toMatchObject({ routing: null, resolvedEndpoint: null });
  });

  it('hands out a stale stored route as unrouted, never as a target', () => {
    const ctx = buildMcpContext({
      servers: [
        server({
          url: 'https://new/mcp',
          allowDirect: false,
          routing: 'proxy',
          resolvedEndpoint: 'https://old/mcp',
        }),
      ],
      overrides: {},
      hasProxy: true,
      mk: {} as unknown as never,
      requestApproval: async () => true,
    });
    expect(ctx?.servers[0]).toMatchObject({ routing: null, resolvedEndpoint: null });
  });

  it('probes with the row intent and remembers the outcome on this device', async () => {
    vi.mocked(testMcpConnection).mockResolvedValue({
      ok: true,
      routing: 'proxy',
      resolvedEndpoint: 'https://s/mcp',
      tools: [],
      error: null,
    });
    const auth = { header: 'Authorization', value: 'Bearer k' };
    const r = await build()?.resolveRoute('s', auth);
    expect(testMcpConnection).toHaveBeenCalledWith({
      url: 'https://s/mcp',
      hasProxy: true,
      allowDirect: false,
      auth,
      signal: undefined,
    });
    expect(persistMcpRoute).toHaveBeenCalledWith(
      's',
      { routing: 'proxy', resolvedEndpoint: 'https://s/mcp' },
      { url: 'https://s/mcp', allowDirect: false },
    );
    expect(r).toEqual({ ok: true, routing: 'proxy', resolvedEndpoint: 'https://s/mcp' });
  });

  it('reports a failed probe and remembers nothing', async () => {
    vi.mocked(testMcpConnection).mockResolvedValue({
      ok: false,
      routing: null,
      resolvedEndpoint: null,
      tools: [],
      error: 'HTTP 503',
    });
    const r = await build()?.resolveRoute('s', null);
    expect(r).toEqual({ ok: false, error: 'HTTP 503' });
    expect(persistMcpRoute).not.toHaveBeenCalled();
  });
});
