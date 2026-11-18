// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpServerRow } from '../../src/boot/client-data-db.js';
import { __resetMcpSessions } from '../../src/mcp/mcp-client.js';
import {
  buildCandidates,
  liveProbe,
  resolveConnection,
  testMcpConnection,
} from '../../src/mcp/mcp-connectivity.js';
import { MCP_REDIRECT_DETAIL } from '../../src/mcp/redirect-copy.js';
import { statusOf } from '../../src/mcp/server-status.js';
import type { McpCandidate, McpProbeResult } from '../../src/mcp/types.js';

describe('buildCandidates', () => {
  it('direct first (bare then +/mcp), then proxy variants when a proxy exists', () => {
    expect(buildCandidates('https://x.io/api', true, true)).toEqual([
      { routing: 'direct', url: 'https://x.io/api' },
      { routing: 'direct', url: 'https://x.io/api/mcp' },
      { routing: 'proxy', url: 'https://x.io/api' },
      { routing: 'proxy', url: 'https://x.io/api/mcp' },
    ]);
  });
  it('omits proxy candidates without a proxy', () => {
    expect(buildCandidates('https://x.io/api', false, true)).toEqual([
      { routing: 'direct', url: 'https://x.io/api' },
      { routing: 'direct', url: 'https://x.io/api/mcp' },
    ]);
  });
  it('does not double-append /mcp when the URL already ends in /mcp', () => {
    const c = buildCandidates('https://x.io/mcp', false, true);
    expect(c).toHaveLength(1);
    expect(c[0]).toEqual({ routing: 'direct', url: 'https://x.io/mcp' });
  });
});

describe('buildCandidates — allowDirect gating', () => {
  it('proxy-only when allowDirect is false (proxy configured)', () => {
    const c = buildCandidates('http://192.168.1.50:9000', true, false);
    expect(c.every((x) => x.routing === 'proxy')).toBe(true);
    expect(c.some((x) => x.routing === 'direct')).toBe(false);
  });

  it('empty when allowDirect is false and no proxy', () => {
    expect(buildCandidates('http://192.168.1.50:9000', false, false)).toEqual([]);
  });

  it('direct-first then proxy when allowDirect is true (proxy configured)', () => {
    const c = buildCandidates('http://192.168.1.50:9000', true, true);
    expect(c[0]?.routing).toBe('direct');
    expect(c.some((x) => x.routing === 'proxy')).toBe(true);
  });

  it('direct-only when allowDirect is true and no proxy', () => {
    const c = buildCandidates('http://192.168.1.50:9000', false, true);
    expect(c.every((x) => x.routing === 'direct')).toBe(true);
  });
});

describe('resolveConnection', () => {
  const probeFor = (results: Record<string, McpProbeResult>) => (c: McpCandidate) =>
    Promise.resolve(results[`${c.routing} ${c.url}`] ?? { ok: false, tools: [], error: 'no' });

  it('stops at the first success and reports its routing + endpoint + tools', async () => {
    const probe = probeFor({
      'direct https://x.io/mcp': {
        ok: true,
        tools: [{ name: 't', description: '', inputSchema: {} }],
        error: null,
      },
    });
    const r = await resolveConnection(
      [
        { routing: 'direct', url: 'https://x.io' },
        { routing: 'direct', url: 'https://x.io/mcp' },
      ],
      probe,
    );
    expect(r).toMatchObject({ ok: true, routing: 'direct', resolvedEndpoint: 'https://x.io/mcp' });
    expect(r.tools).toHaveLength(1);
  });

  it('falls through to proxy when direct fails', async () => {
    const probe = probeFor({ 'proxy https://x.io/mcp': { ok: true, tools: [], error: null } });
    const r = await resolveConnection(
      [
        { routing: 'direct', url: 'https://x.io/mcp' },
        { routing: 'proxy', url: 'https://x.io/mcp' },
      ],
      probe,
    );
    expect(r).toMatchObject({ ok: true, routing: 'proxy', resolvedEndpoint: 'https://x.io/mcp' });
  });

  it('returns the last error when every candidate fails', async () => {
    const probe = () => Promise.resolve({ ok: false, tools: [], error: 'blocked by allowlist' });
    const r = await resolveConnection([{ routing: 'proxy', url: 'https://x.io/mcp' }], probe);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('blocked by allowlist');
  });
});

describe('resolveConnection with stopOnAuth', () => {
  const cs = [
    { routing: 'direct' as const, url: 'https://o/mcp' },
    { routing: 'proxy' as const, url: 'https://o/mcp' },
  ];
  const refused = async () => ({
    ok: false,
    tools: [],
    error: 'HTTP 401',
    auth: 'required' as const,
  });

  it('stops at the first auth answer, so the token reaches one routing only', async () => {
    const probe = vi.fn(refused);
    const r = await resolveConnection(cs, probe, { stopOnAuth: true });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: false, auth: 'required' });
  });

  it('key rows keep trying every candidate, as before', async () => {
    const probe = vi.fn(refused);
    await resolveConnection(cs, probe);
    expect(probe).toHaveBeenCalledTimes(2);
  });
});

/** What fetch resolves with when a `redirect: 'manual'` request met a 3xx. */
const opaqueRedirect = (): Response => {
  const r = new Response(null, { status: 200 });
  Object.defineProperty(r, 'type', { value: 'opaqueredirect' });
  return r;
};

describe('redirects (spec §6.3)', () => {
  afterEach(() => {
    __resetMcpSessions();
    vi.restoreAllMocks();
  });

  it('liveProbe flags a redirect and carries the detail sentence', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(opaqueRedirect());
    const r = await liveProbe(null)({ routing: 'direct', url: 'https://r.example/mcp' });
    expect(r).toEqual({ ok: false, tools: [], error: MCP_REDIRECT_DETAIL, redirect: true });
  });

  it('liveProbe does not flag a network failure as a redirect', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const r = await liveProbe(null)({ routing: 'direct', url: 'https://r.example/mcp' });
    expect(r.ok).toBe(false);
    expect(r.redirect).toBeUndefined();
    expect(r.error).toBe('Failed to fetch');
  });

  it('testMcpConnection puts the detail sentence in error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(opaqueRedirect());
    const r = await testMcpConnection({
      url: 'https://r.example/mcp',
      hasProxy: false,
      allowDirect: true,
      auth: null,
    });
    expect(r).toMatchObject({ ok: false, routing: null, error: MCP_REDIRECT_DETAIL });
  });

  it('a redirect outweighs a later plain failure, so the bare link redirecting is what is said', async () => {
    const results: Record<string, McpProbeResult> = {
      'direct https://r.example': {
        ok: false,
        tools: [],
        error: MCP_REDIRECT_DETAIL,
        redirect: true,
      },
      'direct https://r.example/mcp': {
        ok: false,
        tools: [],
        error: 'MCP initialise failed: HTTP 404',
      },
    };
    const r = await resolveConnection(
      buildCandidates('https://r.example', false, true),
      async (c) => results[`${c.routing} ${c.url}`] as McpProbeResult,
    );
    expect(r.error).toBe(MCP_REDIRECT_DETAIL);
  });

  it('an auth answer still outweighs a redirect: that candidate is the server', async () => {
    const results: Record<string, McpProbeResult> = {
      'direct https://r.example': {
        ok: false,
        tools: [],
        error: MCP_REDIRECT_DETAIL,
        redirect: true,
      },
      'direct https://r.example/mcp': {
        ok: false,
        tools: [],
        error: 'MCP initialise failed: HTTP 401',
        auth: 'required',
      },
    };
    const r = await resolveConnection(
      buildCandidates('https://r.example', false, true),
      async (c) => results[`${c.routing} ${c.url}`] as McpProbeResult,
    );
    expect(r).toMatchObject({ error: 'MCP initialise failed: HTTP 401', auth: 'required' });
  });

  it('the status line reads the detail sentence from lastError', () => {
    const row = {
      id: 'k',
      name: 'Open',
      url: 'https://r.example/mcp',
      prefix: 'open',
      auth: null,
      onByDefault: true,
      autoRun: false,
      allowDirect: true,
      enabled: true,
      routing: null,
      resolvedEndpoint: null,
      tools: [],
      hiddenTools: [],
      lastTestedAt: 1,
      lastError: MCP_REDIRECT_DETAIL,
      firstUseConsentFor: null,
      createdAt: 1,
      updatedAt: 1,
    } as McpServerRow;
    expect(statusOf(row, { hasProxy: false, linked: false })).toBe(
      "✗ This server answered with a redirect, which Chatsundere doesn't follow. Enter its final link.",
    );
  });
});
