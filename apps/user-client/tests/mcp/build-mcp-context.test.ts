// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpOAuthGrantRow, McpServerRow } from '../../src/boot/client-data-db.js';
import { persistMcpRoute, recordMcpConsent } from '../../src/data/mcp-servers.js';
import { buildMcpContext } from '../../src/mcp/build-mcp-context.js';
import { testMcpConnection } from '../../src/mcp/mcp-connectivity.js';

vi.mock('../../src/data/mcp-servers.js', () => ({
  openMcpKey: vi.fn(),
  persistMcpRoute: vi.fn(),
  recordMcpConsent: vi.fn(),
}));
vi.mock('../../src/mcp/oauth/ensure-token.js', () => ({
  ensureAccessToken: vi.fn(),
  createEnsureDeps: vi.fn(),
}));
vi.mock('../../src/mcp/mcp-connectivity.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/mcp/mcp-connectivity.js')>()),
  testMcpConnection: vi.fn(),
}));

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
      requestFirstUse: async () => true,
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
      requestFirstUse: async () => true,
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
      requestFirstUse: async () => true,
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
      requestFirstUse: async () => true,
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

const oauthGrant = (over: Partial<McpOAuthGrantRow> = {}): McpOAuthGrantRow => ({
  id: 'o',
  resource: 'https://o.example/mcp',
  issuer: 'https://auth.example',
  tokenEndpoint: 'https://auth.example/token',
  revocationEndpoint: null,
  clientId: 'c',
  registration: 'cimd',
  scope: null,
  tokenRoute: 'proxy',
  tokens: null,
  claim: null,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});
const oauthRow = (over: Partial<McpServerRow> = {}): McpServerRow =>
  server({
    id: 'o',
    url: 'https://o.example/mcp',
    auth: { scheme: 'oauth' },
    allowDirect: false,
    routing: 'proxy',
    resolvedEndpoint: 'https://o.example/mcp',
    ...over,
  });

describe('buildMcpContext with OAuth and consent', () => {
  beforeEach(() => {
    vi.mocked(testMcpConnection).mockReset();
    vi.mocked(recordMcpConsent).mockReset();
  });
  const build = (rows: McpServerRow[], over: Record<string, unknown> = {}) =>
    buildMcpContext({
      servers: rows,
      overrides: {},
      hasProxy: true,
      mk: {} as unknown as never,
      requestApproval: async () => true,
      requestFirstUse: async () => true,
      ...over,
    });

  it('passes auth, url and hasConsent', () => {
    const ctx = build([
      oauthRow({ firstUseConsentFor: 'https://o.example/mcp' }),
      server({ id: 'k', url: 'https://k/mcp', resolvedEndpoint: 'https://k/mcp' }),
    ]);
    expect(ctx?.servers[0]).toMatchObject({
      auth: { scheme: 'oauth' },
      url: 'https://o.example/mcp',
      hasConsent: true,
    });
    expect(ctx?.servers[1]).toMatchObject({ url: 'https://k/mcp', hasConsent: false });
  });

  it('counts consent only for the URL it was given for', () => {
    const ctx = build([oauthRow({ firstUseConsentFor: 'https://o.example/old' })]);
    expect(ctx?.servers[0]?.hasConsent).toBe(false);
  });

  it('hands out a token for a grant that belongs to the row', async () => {
    const ensureToken = vi.fn(async () => ({ ok: true as const, accessToken: 'at' }));
    const ctx = build([oauthRow()], {
      getGrant: async () => oauthGrant(),
      ensureToken,
    });
    expect(await ctx?.getOAuthToken('o', { rejectedToken: 'old' })).toEqual({
      ok: true,
      accessToken: 'at',
    });
    expect(ensureToken).toHaveBeenCalledWith('o', { rejectedToken: 'old' });
  });

  it('a grant failing tokenAllowedFor yields no token', async () => {
    const ensureToken = vi.fn(async () => ({ ok: true as const, accessToken: 'at' }));
    const ctx = build([oauthRow()], {
      getGrant: async () => oauthGrant({ resource: 'https://elsewhere.example/mcp' }),
      ensureToken,
    });
    const r = await ctx?.getOAuthToken('o');
    expect(r?.ok).toBe(false);
    expect(ensureToken).not.toHaveBeenCalled();
  });

  it('a missing grant yields no-grant', async () => {
    const ctx = build([oauthRow()], { getGrant: async () => undefined, ensureToken: vi.fn() });
    expect(await ctx?.getOAuthToken('o')).toEqual({ ok: false, reason: 'no-grant' });
  });

  it('probes an unrouted OAuth row only at the grant resource', async () => {
    vi.mocked(testMcpConnection).mockResolvedValue({
      ok: true,
      routing: 'proxy',
      resolvedEndpoint: 'https://o.example/mcp',
      tools: [],
      error: null,
    });
    const ctx = build([oauthRow({ routing: null, resolvedEndpoint: null })], {
      getGrant: async () => oauthGrant(),
    });
    const auth = { header: 'Authorization', value: 'Bearer at' };
    await ctx?.resolveRoute('o', auth);
    expect(testMcpConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: [{ routing: 'proxy', url: 'https://o.example/mcp' }],
        auth,
      }),
    );
  });

  it('passes a probe 401 on as an auth signal', async () => {
    vi.mocked(testMcpConnection).mockResolvedValue({
      ok: false,
      routing: null,
      resolvedEndpoint: null,
      tools: [],
      error: 'MCP initialise failed: HTTP 401',
      auth: 'required',
    });
    const ctx = build([oauthRow({ routing: null, resolvedEndpoint: null })], {
      getGrant: async () => oauthGrant(),
    });
    expect(await ctx?.resolveRoute('o', null)).toMatchObject({ ok: false, auth: 'required' });
  });

  it('records consent for the given URL', async () => {
    const ctx = build([oauthRow()]);
    await ctx?.recordConsent('o', 'https://o.example/mcp');
    expect(recordMcpConsent).toHaveBeenCalledWith('o', 'https://o.example/mcp');
  });

  it('a non-OAuth row asks for no token and is not reported as a missing grant', async () => {
    const ensureToken = vi.fn();
    const ctx = build([server({})], { getGrant: async () => oauthGrant(), ensureToken });
    expect(await ctx?.getOAuthToken('s')).toEqual({ ok: false, reason: 'not-oauth' });
    expect(ensureToken).not.toHaveBeenCalled();
  });
});
