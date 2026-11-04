// SPDX-License-Identifier: AGPL-3.0-only
import { setProxyAuthSource } from '@chatsundere/llm-unified';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MCP_PROTOCOL_VERSION,
  McpAuthRequiredError,
  __resetMcpSessions,
  mcpToolsCall,
  mcpToolsList,
  readJsonRpcResponse,
} from '../../src/mcp/mcp-client.js';
import { candidatesFor, testMcpConnection } from '../../src/mcp/mcp-connectivity.js';
import { type McpToolContext, contributeMcpTools } from '../../src/mcp/mcp-tools.js';
import type { McpEndpoint } from '../../src/mcp/types.js';

const directEndpoint: McpEndpoint = {
  url: 'https://mcp.example.com/mcp',
  routing: 'direct',
  auth: { header: 'Authorization', value: 'Bearer k' },
};

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
function sseResponse(objs: unknown[], headers: Record<string, string> = {}): Response {
  const body = objs.map((o) => `data: ${JSON.stringify(o)}\n`).join('\n');
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...headers },
  });
}

afterEach(() => {
  __resetMcpSessions();
  vi.restoreAllMocks();
});

describe('readJsonRpcResponse', () => {
  it('parses application/json', async () => {
    const reply = await readJsonRpcResponse(
      jsonResponse({ jsonrpc: '2.0', id: 1, result: { ok: true } }),
      1,
    );
    expect(reply.result).toEqual({ ok: true });
  });
  it('parses the matching id out of an SSE stream', async () => {
    const reply = await readJsonRpcResponse(
      sseResponse([{ jsonrpc: '2.0', id: 9, result: { tools: [] } }]),
      9,
    );
    expect(reply.result).toEqual({ tools: [] });
  });
});

describe('mcpToolsList', () => {
  it('initialises (capturing the session id) then lists tools', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }, { 'mcp-session-id': 'sess-1' }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          id: 2,
          result: { tools: [{ name: 'search', description: 'd', inputSchema: {} }] },
        }),
      );
    const tools = await mcpToolsList(directEndpoint);
    expect(tools).toEqual([{ name: 'search', description: 'd', inputSchema: {} }]);
    // biome-ignore lint/style/noNonNullAssertion: mock call array is under our control
    const listReq = fetchMock.mock.calls[2]![0] as Request;
    expect(listReq.headers.get('mcp-session-id')).toBe('sess-1');
  });
});

describe('mcpToolsCall', () => {
  it('returns the joined text content on success', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }, { 'mcp-session-id': 's' }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          id: 2,
          result: { content: [{ type: 'text', text: 'hello' }] },
        }),
      );
    const r = await mcpToolsCall(directEndpoint, 'search', { q: 'x' });
    expect(r).toEqual({ stdout: 'hello', error: null });
  });
  it('surfaces an isError result as a constructive error', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }, { 'mcp-session-id': 's' }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          id: 2,
          result: { isError: true, content: [{ type: 'text', text: 'boom' }] },
        }),
      );
    const r = await mcpToolsCall(directEndpoint, 'search', {});
    expect(r.error).toBe('boom');
  });
});

const proxyEndpoint: McpEndpoint = {
  url: 'https://mcp.example.com/mcp',
  routing: 'proxy',
  auth: { header: 'Authorization', value: 'Bearer k' },
};

describe('proxy routing', () => {
  afterEach(() => setProxyAuthSource(null));

  it('targets the proxy URL with the account JWT + target and no shared key, redirect manual', async () => {
    setProxyAuthSource({
      getUrl: () => 'https://proxy.example',
      getToken: () => 'jwt-abc',
      refreshToken: async () => null,
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }, { 'mcp-session-id': 's' }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: 2, result: { tools: [] } }));
    await mcpToolsList(proxyEndpoint);
    // biome-ignore lint/style/noNonNullAssertion: mock call array is under our control
    const initReq = fetchMock.mock.calls[0]![0] as Request;
    expect(initReq.url).toBe('https://proxy.example/mcp');
    expect(initReq.headers.get('x-cors-proxy-target')).toBe('https://mcp.example.com');
    expect(initReq.headers.get('x-chatsundere-authorization')).toBe('Bearer jwt-abc');
    expect(initReq.headers.get('x-cors-proxy-api-key')).toBeNull();
    expect(initReq.headers.get('authorization')).toBe('Bearer k');
    expect(initReq.redirect).toBe('manual');
  });

  it('refreshes once on a 401 and retries with the new token; Mcp-Session-Id survives', async () => {
    let token = 'old';
    setProxyAuthSource({
      getUrl: () => 'https://proxy.example',
      getToken: () => token,
      refreshToken: async () => {
        token = 'new';
        return 'new';
      },
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }, { 'mcp-session-id': 'sess-9' }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      // The proxy's own refusal of the account token, as opposed to an upstream 401.
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: 'unauthorized', message: 'Request refused' } }),
          {
            status: 401,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          id: 2,
          result: { content: [{ type: 'text', text: 'ok' }] },
        }),
      );
    const r = await mcpToolsCall(proxyEndpoint, 'search', { q: 'x' });
    expect(r).toEqual({ stdout: 'ok', error: null });
    // biome-ignore lint/style/noNonNullAssertion: mock call array is under our control
    const firstCall = fetchMock.mock.calls[2]![0] as Request;
    // biome-ignore lint/style/noNonNullAssertion: mock call array is under our control
    const retryCall = fetchMock.mock.calls[3]![0] as Request;
    expect(firstCall.headers.get('x-chatsundere-authorization')).toBe('Bearer old');
    expect(retryCall.headers.get('x-chatsundere-authorization')).toBe('Bearer new');
    expect(retryCall.headers.get('mcp-session-id')).toBe('sess-9');
  });

  it('never attaches the account JWT to a direct endpoint', async () => {
    setProxyAuthSource({
      getUrl: () => 'https://proxy.example',
      getToken: () => 'jwt-abc',
      refreshToken: async () => null,
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }, { 'mcp-session-id': 's' }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: 2, result: { tools: [] } }));
    await mcpToolsList(directEndpoint);
    // biome-ignore lint/style/noNonNullAssertion: mock call array is under our control
    const initReq = fetchMock.mock.calls[0]![0] as Request;
    expect(initReq.headers.get('x-chatsundere-authorization')).toBeNull();
    expect(initReq.url).toBe('https://mcp.example.com/mcp');
  });
});

const initOk = (sid = 's') =>
  jsonResponse(
    { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18' } },
    { 'mcp-session-id': sid },
  );
const callOk = (text = 'ok') =>
  jsonResponse({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text }] } });
const upstream401 = (
  challenge = 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"',
) =>
  new Response('{"error":"invalid_token"}', {
    status: 401,
    headers: { 'content-type': 'application/json', 'www-authenticate': challenge },
  });
const reqAt = (m: { mock: { calls: unknown[][] } }, i: number) => m.mock.calls[i]?.[0] as Request;

describe('auth signals', () => {
  afterEach(() => setProxyAuthSource(null));

  it('throws McpAuthRequiredError with the parsed challenge on a 401 from tools/list', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(initOk())
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(upstream401('Bearer error="invalid_token", scope="read"'));
    const err = await mcpToolsList(directEndpoint).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpAuthRequiredError);
    expect((err as McpAuthRequiredError).status).toBe(401);
    expect((err as McpAuthRequiredError).challenge).toMatchObject({
      error: 'invalid_token',
      scope: 'read',
    });
  });

  it('throws McpAuthRequiredError when initialise itself is refused', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(upstream401());
    const err = await mcpToolsList(directEndpoint).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpAuthRequiredError);
  });

  it('returns auth: required from tools/call on a 401', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(initOk())
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(upstream401());
    const r = await mcpToolsCall(directEndpoint, 'search', {});
    expect(r.auth).toBe('required');
    expect(r.error).toMatch(/401/);
    expect(r.stdout).toBe('');
  });

  it('returns insufficient-scope with the challenged scope on a 403', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(initOk())
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        new Response('', {
          status: 403,
          headers: { 'www-authenticate': 'Bearer error="insufficient_scope", scope="write"' },
        }),
      );
    const r = await mcpToolsCall(directEndpoint, 'search', {});
    expect(r).toMatchObject({ auth: 'insufficient-scope', scope: 'write' });
  });

  it('treats any other 403 as an ordinary error', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(initOk())
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(new Response('', { status: 403 }));
    const r = await mcpToolsCall(directEndpoint, 'search', {});
    expect(r.auth).toBeUndefined();
    expect(r.error).toMatch(/403/);
  });
});

describe('headers', () => {
  afterEach(() => setProxyAuthSource(null));
  const proxy = () =>
    setProxyAuthSource({
      getUrl: () => 'https://proxy.example',
      getToken: () => 'jwt',
      refreshToken: async () => 'jwt2',
    });

  it('marks every proxied MCP request as kind mcp', async () => {
    proxy();
    const f = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(initOk())
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(callOk());
    await mcpToolsCall(proxyEndpoint, 'search', {});
    expect(f).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 3; i++) {
      expect(reqAt(f, i).headers.get('x-cors-proxy-kind')).toBe('mcp');
    }
  });

  it('does not mark a direct request', async () => {
    const f = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(initOk())
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(callOk());
    await mcpToolsCall(directEndpoint, 'search', {});
    expect(reqAt(f, 2).headers.get('x-cors-proxy-kind')).toBeNull();
  });

  it('sends MCP-Protocol-Version on every request after initialise, not on initialise', async () => {
    const f = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(initOk())
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(callOk());
    await mcpToolsCall(directEndpoint, 'search', {});
    expect(reqAt(f, 0).headers.get('mcp-protocol-version')).toBeNull();
    expect(reqAt(f, 1).headers.get('mcp-protocol-version')).toBe(MCP_PROTOCOL_VERSION);
    expect(reqAt(f, 2).headers.get('mcp-protocol-version')).toBe(MCP_PROTOCOL_VERSION);
  });

  it('reads Mcp-Session-Id through the proxy and sends it back', async () => {
    proxy();
    const f = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(initOk('sess-p'))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(callOk());
    await mcpToolsCall(proxyEndpoint, 'search', {});
    expect(reqAt(f, 1).headers.get('mcp-session-id')).toBe('sess-p');
    expect(reqAt(f, 2).headers.get('mcp-session-id')).toBe('sess-p');
  });

  it('sends an upstream 401 through the proxy once, without spending an account refresh', async () => {
    const refreshToken = vi.fn(async () => 'jwt2');
    setProxyAuthSource({
      getUrl: () => 'https://proxy.example',
      getToken: () => 'jwt',
      refreshToken,
    });
    const f = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(initOk())
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(upstream401());
    const r = await mcpToolsCall(proxyEndpoint, 'search', {});
    expect(r.auth).toBe('required');
    expect(f).toHaveBeenCalledTimes(3);
    expect(refreshToken).not.toHaveBeenCalled();
  });
});

describe('an OAuth tool call over the wire', () => {
  afterEach(() => setProxyAuthSource(null));

  it('sends a call refused by the upstream exactly twice in total, then reports dead', async () => {
    const refreshToken = vi.fn(async () => 'jwt2');
    setProxyAuthSource({
      getUrl: () => 'https://proxy.example',
      getToken: () => 'jwt',
      refreshToken,
    });
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const req = input as Request;
      const body = JSON.parse(await req.clone().text()) as { method: string };
      if (body.method === 'initialize') return initOk();
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      return upstream401();
    });
    const getOAuthToken = vi
      .fn<McpToolContext['getOAuthToken']>()
      .mockResolvedValueOnce({ ok: true, accessToken: 'at-1' })
      .mockResolvedValueOnce({ ok: true, accessToken: 'at-2' });
    const ctx: McpToolContext = {
      servers: [
        {
          id: 'o',
          name: 'Kumbu',
          prefix: 'kumbu',
          url: 'https://mcp.example.com/mcp',
          routing: 'proxy',
          resolvedEndpoint: 'https://mcp.example.com/mcp',
          auth: { scheme: 'oauth' },
          autoRun: true,
          hasConsent: true,
          tools: [{ name: 'go', description: 'd', inputSchema: {} }],
          hiddenTools: [],
        },
      ],
      getServerKey: async () => null,
      getOAuthToken,
      requestApproval: async () => true,
      requestFirstUse: async () => true,
      recordConsent: async () => undefined,
      resolveRoute: async () => ({ ok: false, error: 'not expected' }),
    };
    const [tool] = contributeMcpTools(ctx);
    const r = await tool?.execute({});
    const calls = await Promise.all(
      f.mock.calls.map(async (c) => JSON.parse(await (c[0] as Request).clone().text()).method),
    );
    expect(calls.filter((m) => m === 'tools/call')).toHaveLength(2);
    expect(refreshToken).not.toHaveBeenCalled();
    expect(r?.meta).toEqual({ mcpAuth: { serverId: 'o', serverName: 'Kumbu', variant: 'dead' } });
    expect(getOAuthToken).toHaveBeenLastCalledWith(
      'o',
      expect.objectContaining({ rejectedToken: 'at-1' }),
    );
  });
});

describe('fix round 1', () => {
  afterEach(() => setProxyAuthSource(null));
  const proxy401 = () =>
    new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Request refused' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  const methodOf = async (c: unknown[]) =>
    (JSON.parse(await (c[0] as Request).clone().text()) as { method: string }).method;
  const oauthCtx = (over: Partial<McpToolContext>): McpToolContext => ({
    servers: [
      {
        id: 'o',
        name: 'Kumbu',
        prefix: 'kumbu',
        url: 'https://mcp.example.com/mcp',
        routing: 'proxy',
        resolvedEndpoint: 'https://mcp.example.com/mcp',
        auth: { scheme: 'oauth' },
        autoRun: true,
        hasConsent: true,
        tools: [{ name: 'go', description: 'd', inputSchema: {} }],
        hiddenTools: [],
      },
    ],
    getServerKey: async () => null,
    getOAuthToken: async () => ({ ok: true, accessToken: 'at-1' }),
    requestApproval: async () => true,
    requestFirstUse: async () => true,
    recordConsent: async () => undefined,
    resolveRoute: async () => ({ ok: false, error: 'not expected' }),
    ...over,
  });

  it('a proxy refusal that survives the account refresh is a plain error, never an MCP auth signal', async () => {
    setProxyAuthSource({
      getUrl: () => 'https://proxy.example',
      getToken: () => 'jwt',
      refreshToken: async () => null,
    });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(initOk())
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(proxy401());
    const r = await mcpToolsCall(proxyEndpoint, 'search', {});
    expect(r.auth).toBeUndefined();
    expect(r.error).toMatch(/Chatsundere server session has expired/);
  });

  it('a resend still refused by the proxy is a plain error too', async () => {
    setProxyAuthSource({
      getUrl: () => 'https://proxy.example',
      getToken: () => 'jwt',
      refreshToken: async () => 'jwt2',
    });
    const f = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(initOk())
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(proxy401())
      .mockResolvedValueOnce(proxy401());
    const r = await mcpToolsCall(proxyEndpoint, 'search', {});
    expect(r.auth).toBeUndefined();
    expect(f).toHaveBeenCalledTimes(4);
  });

  it('a lapsed account session never spends the MCP refresh token', async () => {
    setProxyAuthSource({
      getUrl: () => 'https://proxy.example',
      getToken: () => 'jwt',
      refreshToken: async () => null,
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const m = await methodOf([input]);
      if (m === 'initialize') return initOk();
      if (m === 'notifications/initialized') return new Response(null, { status: 202 });
      return proxy401();
    });
    const getOAuthToken = vi.fn<McpToolContext['getOAuthToken']>(async () => ({
      ok: true,
      accessToken: 'at-1',
    }));
    const [tool] = contributeMcpTools(oauthCtx({ getOAuthToken }));
    const r = await tool?.execute({});
    expect(r?.ok).toBe(false);
    expect(r?.meta).toBeUndefined();
    expect(getOAuthToken).toHaveBeenCalledTimes(1);
    expect(getOAuthToken).not.toHaveBeenCalledWith(
      'o',
      expect.objectContaining({ rejectedToken: expect.anything() }),
    );
  });

  it('a first-use probe refused upstream reaches the server at most twice across routings', async () => {
    setProxyAuthSource({
      getUrl: () => 'https://proxy.example',
      getToken: () => 'jwt',
      refreshToken: async () => 'jwt2',
    });
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => upstream401());
    const row = { url: 'https://mcp.example.com/mcp', allowDirect: true };
    const grant = {
      id: 'o',
      resource: 'https://mcp.example.com/mcp',
      issuer: 'https://auth.example',
      tokenEndpoint: 'https://auth.example/token',
      revocationEndpoint: null,
      clientId: 'c',
      registration: 'cimd' as const,
      scope: null,
      tokenRoute: 'proxy' as const,
      tokens: null,
      claim: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const getOAuthToken = vi
      .fn<McpToolContext['getOAuthToken']>()
      .mockResolvedValueOnce({ ok: true, accessToken: 'at-1' })
      .mockResolvedValueOnce({ ok: true, accessToken: 'at-2' });
    const context = oauthCtx({
      getOAuthToken,
      resolveRoute: async (_id, auth, signal) => {
        const result = await testMcpConnection({
          url: row.url,
          hasProxy: true,
          allowDirect: true,
          auth,
          signal,
          candidates: candidatesFor(row, grant, true),
        });
        return result.ok && result.routing && result.resolvedEndpoint
          ? { ok: true, routing: result.routing, resolvedEndpoint: result.resolvedEndpoint }
          : {
              ok: false,
              error: result.error ?? 'x',
              ...(result.auth ? { auth: result.auth } : {}),
            };
      },
    });
    const server = context.servers[0];
    if (server) {
      server.routing = null;
      server.resolvedEndpoint = null;
    }
    const [tool] = contributeMcpTools(context);
    const r = await tool?.execute({});
    expect(f).toHaveBeenCalledTimes(2);
    expect(r?.meta).toEqual({ mcpAuth: { serverId: 'o', serverName: 'Kumbu', variant: 'dead' } });
  });

  it('a direct request carrying a credential refuses redirects', async () => {
    const f = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(initOk())
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(callOk());
    await mcpToolsCall(directEndpoint, 'search', {});
    for (let i = 0; i < 3; i++) expect(reqAt(f, i).redirect).toBe('error');
  });

  it('a direct request without a credential still follows redirects', async () => {
    const f = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(initOk())
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(callOk());
    await mcpToolsCall({ ...directEndpoint, auth: null }, 'search', {});
    expect(reqAt(f, 0).redirect).toBe('follow');
  });
});
