// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { buildCandidates, resolveConnection } from '../../src/mcp/mcp-connectivity.js';
import type { McpCandidate, McpProbeResult } from '../../src/mcp/types.js';

describe('buildCandidates', () => {
  it('direct first (bare then +/mcp), then proxy variants when a proxy exists', () => {
    expect(buildCandidates('https://x.io/api', true)).toEqual([
      { routing: 'direct', url: 'https://x.io/api' },
      { routing: 'direct', url: 'https://x.io/api/mcp' },
      { routing: 'proxy', url: 'https://x.io/api' },
      { routing: 'proxy', url: 'https://x.io/api/mcp' },
    ]);
  });
  it('omits proxy candidates without a proxy', () => {
    expect(buildCandidates('https://x.io/api', false)).toEqual([
      { routing: 'direct', url: 'https://x.io/api' },
      { routing: 'direct', url: 'https://x.io/api/mcp' },
    ]);
  });
  it('does not double-append /mcp when the URL already ends in /mcp', () => {
    const c = buildCandidates('https://x.io/mcp', false);
    expect(c).toHaveLength(1);
    expect(c[0]).toEqual({ routing: 'direct', url: 'https://x.io/mcp' });
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
