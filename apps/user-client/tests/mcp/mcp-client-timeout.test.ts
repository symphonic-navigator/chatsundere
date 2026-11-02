// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
// jsdom's AbortSignal has no `any`; every browser we support does.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetMcpSessions, mcpToolsCall } from '../../src/mcp/mcp-client.js';

const endpoint = { url: 'https://mcp.example.com/mcp', routing: 'direct' as const, auth: null };

function hangingFetch() {
  return vi.fn(
    (_req: Request, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      }),
  );
}

afterEach(() => {
  __resetMcpSessions();
  vi.unstubAllGlobals();
});

describe('mcpToolsCall timeout', () => {
  it('still times out when the caller supplies an abort signal', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const r = await mcpToolsCall(endpoint, 'go', {}, 20, new AbortController().signal);
    expect(r.error).toBe('MCP server timed out after 20ms');
  });

  it('still honours the caller stopping the call early', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const stop = new AbortController();
    const pending = mcpToolsCall(endpoint, 'go', {}, 60_000, stop.signal);
    stop.abort();
    const r = await pending;
    expect(r.error).not.toBeNull();
    expect(r.error).not.toContain('timed out');
  });
});
