// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { McpServerRow } from '../../src/boot/client-data-db.js';
import { buildMcpContext } from '../../src/mcp/build-mcp-context.js';

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
      corsProxyUrl: 'p',
      corsProxyKey: 'k',
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
      corsProxyUrl: 'p',
      corsProxyKey: 'k',
      mk: {} as unknown as never,
      requestApproval: async () => true,
    });
    expect(ctx).not.toBeNull();
    expect(ctx?.servers[0]).toMatchObject({ id: 's', prefix: 's', auth: { scheme: 'bearer' } });
    expect(ctx?.servers[0]?.tools).toBeDefined();
    expect((ctx?.servers[0]?.auth as Record<string, unknown>).key).toBeUndefined();
  });
});
