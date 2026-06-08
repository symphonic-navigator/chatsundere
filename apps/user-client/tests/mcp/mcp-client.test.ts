// SPDX-License-Identifier: AGPL-3.0-only
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
  corsProxy: null,
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

describe('proxy routing', () => {
  it('targets the proxy URL with the cors-proxy headers and forwards the path', async () => {
    const proxyEndpoint: McpEndpoint = {
      url: 'https://mcp.example.com/mcp',
      routing: 'proxy',
      corsProxy: { url: 'https://cors-proxy.tidesson.net', key: 'pk' },
      auth: { header: 'Authorization', value: 'Bearer k' },
    };
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
    expect(initReq.url).toBe('https://cors-proxy.tidesson.net/mcp');
    expect(initReq.headers.get('x-cors-proxy-target')).toBe('https://mcp.example.com');
    expect(initReq.headers.get('x-cors-proxy-api-key')).toBe('pk');
    expect(initReq.headers.get('authorization')).toBe('Bearer k');
  });
});
