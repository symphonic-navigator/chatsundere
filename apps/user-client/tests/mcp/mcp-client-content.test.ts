// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetMcpSessions, mcpToolsCall } from '../../src/mcp/mcp-client.js';
import type { McpEndpoint } from '../../src/mcp/types.js';

const endpoint: McpEndpoint = {
  url: 'https://mcp.example.com/mcp',
  routing: 'direct',
  auth: { header: 'Authorization', value: 'Bearer k' },
};

function json(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function mockCall(result: unknown): void {
  vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(json({ jsonrpc: '2.0', id: 1, result: {} }, { 'mcp-session-id': 's' }))
    .mockResolvedValueOnce(new Response(null, { status: 202 }))
    .mockResolvedValueOnce(json({ jsonrpc: '2.0', id: 2, result }));
}

afterEach(() => {
  __resetMcpSessions();
  vi.restoreAllMocks();
});

describe('mcpToolsCall raw content', () => {
  it('keeps every content block and structuredContent next to the joined text', async () => {
    mockCall({
      content: [
        { type: 'text', text: 'hi' },
        { type: 'audio', data: 'SUQz', mimeType: 'audio/mpeg' },
      ],
      structuredContent: { a: 1 },
    });
    const r = await mcpToolsCall(endpoint, 'speak', {});
    expect(r.stdout).toBe('hi');
    expect(r.error).toBeNull();
    expect(r.raw?.content).toHaveLength(2);
    expect(r.raw?.structuredContent).toEqual({ a: 1 });
  });

  it('keeps the raw result on isError results too', async () => {
    mockCall({ isError: true, content: [{ type: 'text', text: 'boom' }] });
    const r = await mcpToolsCall(endpoint, 'speak', {});
    expect(r.error).toBe('boom');
    expect(r.raw?.content).toHaveLength(1);
  });
});
