// SPDX-License-Identifier: AGPL-3.0-only
import { setProxyAuthSource } from '@chatsundere/llm-unified';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetMcpSessions,
  mcpToolsCall,
  mcpToolsList,
  readJsonRpcResponse,
} from '../../src/mcp/mcp-client.js';
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
      .mockResolvedValueOnce(new Response('', { status: 401 }))
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
