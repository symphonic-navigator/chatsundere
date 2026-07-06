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
