// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { toolsListMock, discoverMock } = vi.hoisted(() => ({
  toolsListMock: vi.fn(),
  discoverMock: vi.fn(),
}));

vi.mock('../../../src/mcp/mcp-client.js', async (orig) => ({
  ...(await orig<typeof import('../../../src/mcp/mcp-client.js')>()),
  mcpToolsList: (...args: unknown[]) => toolsListMock(...args),
}));
vi.mock('../../../src/mcp/oauth/discovery.js', () => ({
  discoverOAuth: (...args: unknown[]) => discoverMock(...args),
}));

import { McpAuthRequiredError } from '../../../src/mcp/mcp-client.js';
import { checkServer } from '../../../src/mcp/oauth/check-server.js';
import type { OAuthDiscovery } from '../../../src/mcp/oauth/discovery.js';
import { OAuthError } from '../../../src/mcp/oauth/url.js';
import type { McpEndpoint } from '../../../src/mcp/types.js';

const TOOLS = [{ name: 'search', description: '', inputSchema: {} }];

function discovery(resource: string): OAuthDiscovery {
  return {
    kind: 'oauth',
    resource,
    issuer: 'https://auth.example',
    resourceName: 'Kumbu',
    authorizationEndpoint: 'https://auth.example/authorize',
    tokenEndpoint: 'https://auth.example/token',
    registrationEndpoint: null,
    revocationEndpoint: null,
    cimdSupported: true,
    issParameterSupported: false,
    scope: null,
  };
}

const unauthorised = () => new McpAuthRequiredError('MCP initialize failed: HTTP 401', 401, null);

describe('checkServer', () => {
  beforeEach(() => {
    toolsListMock.mockReset();
    discoverMock.mockReset();
  });

  it('reports an open server with its tools and route', async () => {
    toolsListMock.mockResolvedValue(TOOLS);
    const r = await checkServer('https://open.example/mcp', { hasProxy: true, allowDirect: false });
    expect(r).toEqual({
      kind: 'open',
      route: 'proxy',
      endpoint: 'https://open.example/mcp',
      tools: TOOLS,
    });
    expect(discoverMock).not.toHaveBeenCalled();
  });

  it('reports a key server when a 401 carries no OAuth metadata', async () => {
    toolsListMock.mockRejectedValue(unauthorised());
    discoverMock.mockResolvedValue({ kind: 'no-oauth' });
    const r = await checkServer('https://key.example/mcp', { hasProxy: true, allowDirect: false });
    expect(r).toEqual({ kind: 'key', route: 'proxy', endpoint: 'https://key.example/mcp' });
  });

  it('turns a /mcp suffix that answers into the resource, through buildCandidates', async () => {
    toolsListMock.mockImplementation(async (e: McpEndpoint) => {
      if (e.url.endsWith('/mcp')) throw unauthorised();
      throw new Error('MCP initialize failed: HTTP 404');
    });
    discoverMock.mockImplementation(async (url: string) => discovery(url));
    const r = await checkServer('https://kumbu.example/', { hasProxy: true, allowDirect: false });
    expect(r.kind).toBe('sign-in');
    if (r.kind !== 'sign-in') return;
    expect(r.endpoint).toBe('https://kumbu.example/mcp');
    expect(r.discovery.resource).toBe('https://kumbu.example/mcp');
    expect(r.route).toBe('proxy');
    expect(discoverMock.mock.calls[0]?.[0]).toBe('https://kumbu.example/mcp');
    expect(discoverMock.mock.calls[0]?.[1]).toMatchObject({ route: 'proxy', hasProxy: true });
  });

  it('probes an https link directly without a proxy, ignoring allowDirect and sending no credential', async () => {
    toolsListMock.mockResolvedValue(TOOLS);
    const r = await checkServer('https://open.example/mcp', {
      hasProxy: false,
      allowDirect: false,
    });
    expect(r.kind).toBe('open');
    if (r.kind === 'open') expect(r.route).toBe('direct');
    for (const call of toolsListMock.mock.calls) {
      const endpoint = call[0] as McpEndpoint;
      expect(endpoint.routing).toBe('direct');
      expect(endpoint.auth).toBeNull();
    }
  });

  it('says a direct-only failure may need a linked server', async () => {
    toolsListMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const r = await checkServer('https://kumbu.example/mcp/c/abc', {
      hasProxy: false,
      allowDirect: false,
    });
    expect(r).toMatchObject({ kind: 'unreachable', directOnly: true });
  });

  it('is unreachable but not direct-only when the proxy was tried', async () => {
    toolsListMock.mockRejectedValue(new Error('MCP initialize failed: HTTP 503'));
    const r = await checkServer('https://down.example/mcp', { hasProxy: true, allowDirect: true });
    expect(r).toMatchObject({ kind: 'unreachable', directOnly: false });
    const routings = toolsListMock.mock.calls.map((c) => (c[0] as McpEndpoint).routing);
    expect(routings).toContain('direct');
    expect(routings).toContain('proxy');
  });

  it('does not probe a plain http link without a proxy or Local network', async () => {
    const r = await checkServer('http://192.168.1.5:8080/mcp', {
      hasProxy: false,
      allowDirect: false,
    });
    expect(r.kind).toBe('unreachable');
    expect(toolsListMock).not.toHaveBeenCalled();
  });

  it('passes on a readable discovery refusal, never a raw code', async () => {
    toolsListMock.mockRejectedValue(unauthorised());
    discoverMock.mockRejectedValue(
      new OAuthError(
        'no-pkce',
        "This server's sign-in does not support the required protection (PKCE).",
      ),
    );
    const r = await checkServer('https://odd.example/mcp', { hasProxy: true, allowDirect: false });
    expect(r).toMatchObject({ kind: 'unreachable', directOnly: false });
    if (r.kind === 'unreachable') {
      expect(r.error).toMatch(/required protection/);
      expect(r.error).not.toMatch(/no-pkce/);
    }
  });

  it('names the cause, so only a failed probe reads as unreachable', async () => {
    const link = await checkServer('http://192.168.1.5/mcp', {
      hasProxy: false,
      allowDirect: false,
    });
    expect(link).toMatchObject({ kind: 'unreachable', cause: 'link' });
    toolsListMock.mockRejectedValue(new Error('MCP initialize failed: HTTP 503'));
    const probe = await checkServer('https://down.example/mcp', {
      hasProxy: true,
      allowDirect: false,
    });
    expect(probe).toMatchObject({ kind: 'unreachable', cause: 'probe' });
    toolsListMock.mockRejectedValue(unauthorised());
    discoverMock.mockRejectedValue(new OAuthError('no-pkce', 'This server cannot be used safely.'));
    const refused = await checkServer('https://odd.example/mcp', {
      hasProxy: true,
      allowDirect: false,
    });
    expect(refused).toMatchObject({ kind: 'unreachable', cause: 'refused' });
  });
});
