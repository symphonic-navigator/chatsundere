// SPDX-License-Identifier: AGPL-3.0-only
import type { McpOAuthGrantRow, McpServerRow } from '../boot/client-data-db.js';
import { McpAuthRequiredError, mcpToolsList } from './mcp-client.js';
import { tokenAllowedFor } from './resolve-active.js';
import type {
  McpAuthResolved,
  McpCandidate,
  McpConnectionResult,
  McpProbeResult,
  McpRouting,
} from './types.js';

/**
 * Build the ordered probe candidates. `allowDirect` is the user's intent:
 * when false, only proxy candidates are produced (the client never probes the
 * network directly); when true, direct is tried first, then proxy as fallback.
 */
export function buildCandidates(
  url: string,
  hasProxy: boolean,
  allowDirect: boolean,
): McpCandidate[] {
  const trimmed = url.replace(/\/+$/, '');
  const variants = trimmed.endsWith('/mcp') ? [trimmed] : [trimmed, `${trimmed}/mcp`];
  const routings = routingsFor(hasProxy, allowDirect);
  return routings.flatMap((routing) => variants.map((u) => ({ routing, url: u })));
}

function routingsFor(hasProxy: boolean, allowDirect: boolean): McpRouting[] {
  if (allowDirect) return hasProxy ? ['direct', 'proxy'] : ['direct'];
  return hasProxy ? ['proxy'] : [];
}

/**
 * Probe candidates for an OAuth row: exactly the grant's `resource`, never a `/mcp`
 * variant, so a bearer token cannot reach another path (spec §7). Nothing at all when
 * the grant does not belong to the row.
 */
export function candidatesFor(
  row: Pick<McpServerRow, 'url' | 'allowDirect'>,
  grant: McpOAuthGrantRow,
  hasProxy: boolean,
): McpCandidate[] {
  if (!tokenAllowedFor(grant, { url: row.url, resolvedEndpoint: null })) return [];
  return routingsFor(hasProxy, row.allowDirect).map((routing) => ({
    routing,
    url: grant.resource,
  }));
}

/**
 * Run candidates in order, stop at the first success, or with `stopOnAuth` at the first
 * auth answer. Pure over `probe`.
 */
export async function resolveConnection(
  candidates: McpCandidate[],
  probe: (c: McpCandidate) => Promise<McpProbeResult>,
  opts: { stopOnAuth?: boolean } = {},
): Promise<McpConnectionResult> {
  let lastError = 'No candidates';
  let lastAuth: Pick<McpProbeResult, 'auth' | 'scope'> = {};
  for (const c of candidates) {
    const r = await probe(c);
    if (r.ok) {
      return { ok: true, routing: c.routing, resolvedEndpoint: c.url, tools: r.tools, error: null };
    }
    lastError = r.error ?? 'unknown';
    if (r.auth) {
      lastAuth = { auth: r.auth, ...(r.scope ? { scope: r.scope } : {}) };
      // An auth answer proves the server is reachable here; trying the next routing would
      // only send the same token a second time.
      if (opts.stopOnAuth) break;
    }
  }
  return {
    ok: false,
    routing: null,
    resolvedEndpoint: null,
    tools: [],
    error: lastError,
    ...lastAuth,
  };
}

/**
 * The live probe: initialise + tools/list against a candidate.
 *
 * Security note: `auth` is sent on EVERY probe candidate. All candidates target
 * the same user-entered origin, so credential egress is bounded to that origin.
 * A future maintainer who introduces a third-party fallback candidate MUST NOT
 * reuse this probe as-is — doing so would widen credential egress. Proxy routing
 * is late-bound: `mcp-client` reads the account proxy at request-build time.
 */
export function liveProbe(
  auth: McpAuthResolved | null,
  signal?: AbortSignal,
): (c: McpCandidate) => Promise<McpProbeResult> {
  return async (c) => {
    try {
      const tools = await mcpToolsList(
        {
          url: c.url,
          routing: c.routing,
          auth,
        },
        undefined,
        signal,
      );
      return { ok: true, tools, error: null };
    } catch (e) {
      if (e instanceof McpAuthRequiredError) {
        const scope = e.challenge?.scope;
        return {
          ok: false,
          tools: [],
          error: e.message,
          auth: e.status === 401 ? 'required' : 'insufficient-scope',
          ...(scope ? { scope } : {}),
        };
      }
      return { ok: false, tools: [], error: e instanceof Error ? e.message : String(e) };
    }
  };
}

/**
 * Top-level entry the UI calls. `candidates` replaces the derived ones and stops at the
 * first auth answer (OAuth rows); key rows keep trying every candidate, as before.
 */
export async function testMcpConnection(input: {
  url: string;
  hasProxy: boolean;
  allowDirect: boolean;
  auth: McpAuthResolved | null;
  signal?: AbortSignal;
  candidates?: McpCandidate[];
}): Promise<McpConnectionResult> {
  return resolveConnection(
    input.candidates ?? buildCandidates(input.url, input.hasProxy, input.allowDirect),
    liveProbe(input.auth, input.signal),
    { stopOnAuth: input.candidates !== undefined },
  );
}
