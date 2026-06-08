// SPDX-License-Identifier: AGPL-3.0-only
import { mcpToolsList } from './mcp-client.js';
import type {
  McpAuthResolved,
  McpCandidate,
  McpConnectionResult,
  McpProbeResult,
  McpRouting,
} from './types.js';

/** Build the ordered probe candidates: direct (bare, +/mcp) then proxy (bare, +/mcp). */
export function buildCandidates(url: string, hasProxy: boolean): McpCandidate[] {
  const trimmed = url.replace(/\/+$/, '');
  const variants = trimmed.endsWith('/mcp') ? [trimmed] : [trimmed, `${trimmed}/mcp`];
  const routings: McpRouting[] = hasProxy ? ['direct', 'proxy'] : ['direct'];
  return routings.flatMap((routing) => variants.map((u) => ({ routing, url: u })));
}

/** Run candidates in order, stop at the first success. Pure over `probe`. */
export async function resolveConnection(
  candidates: McpCandidate[],
  probe: (c: McpCandidate) => Promise<McpProbeResult>,
): Promise<McpConnectionResult> {
  let lastError = 'No candidates';
  for (const c of candidates) {
    const r = await probe(c);
    if (r.ok) {
      return { ok: true, routing: c.routing, resolvedEndpoint: c.url, tools: r.tools, error: null };
    }
    lastError = r.error ?? 'unknown';
  }
  return { ok: false, routing: null, resolvedEndpoint: null, tools: [], error: lastError };
}

/**
 * The live probe: initialise + tools/list against a candidate.
 *
 * Security note: `auth` is sent on EVERY probe candidate. All candidates target
 * the same user-entered origin, so credential egress is bounded to that origin.
 * A future maintainer who introduces a third-party fallback candidate MUST NOT
 * reuse this probe as-is — doing so would widen credential egress.
 */
export function liveProbe(
  corsProxy: { url: string; key: string } | null,
  auth: McpAuthResolved | null,
): (c: McpCandidate) => Promise<McpProbeResult> {
  return async (c) => {
    try {
      const tools = await mcpToolsList({
        url: c.url,
        routing: c.routing,
        corsProxy: c.routing === 'proxy' ? corsProxy : null,
        auth,
      });
      return { ok: true, tools, error: null };
    } catch (e) {
      return { ok: false, tools: [], error: e instanceof Error ? e.message : String(e) };
    }
  };
}

/** Top-level entry the UI calls. */
export async function testMcpConnection(input: {
  url: string;
  hasProxy: boolean;
  corsProxy: { url: string; key: string } | null;
  auth: McpAuthResolved | null;
}): Promise<McpConnectionResult> {
  return resolveConnection(
    buildCandidates(input.url, input.hasProxy),
    liveProbe(input.corsProxy, input.auth),
  );
}
