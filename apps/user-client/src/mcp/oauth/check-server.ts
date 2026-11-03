// SPDX-License-Identifier: AGPL-3.0-only
import { buildCandidates, liveProbe } from '../mcp-connectivity.js';
import type { McpCandidate, McpProbeResult, McpRouting, McpToolDefinition } from '../types.js';
import { type OAuthDiscovery, discoverOAuth } from './discovery.js';
import { type OAuthFetch, createOAuthFetch } from './oauth-fetch.js';
import { OAuthError } from './url.js';

/** What *Check server* found out about a link (MCP OAuth spec §9 "Connect"). */
export type CheckResult =
  | { kind: 'sign-in'; discovery: OAuthDiscovery; route: McpRouting; endpoint: string }
  | { kind: 'key'; route: McpRouting; endpoint: string }
  | { kind: 'open'; route: McpRouting; endpoint: string; tools: McpToolDefinition[] }
  | {
      kind: 'unreachable';
      directOnly: boolean;
      error: string;
      /**
       * Why: `probe` when no candidate answered (`error` is then the last probe's detail),
       * `refused` when the server answered but its sign-in cannot be used, `link` when the
       * link itself cannot be checked. For the last two `error` is a whole sentence.
       */
      cause: 'probe' | 'refused' | 'link';
    };

const HTTP_ONLY_WITHOUT_PROXY =
  'Without a linked Chatsundere server, only https links can be checked. For a server on your home network, enter the details manually and turn on Local network.';

/**
 * Checks a link before anything is saved. Without a proxy an `https` link is probed
 * directly whatever `allowDirect` says (spec §7), since the "Local network" toggle lives in
 * the manual path; no probe carries a credential. A `/mcp` suffix that answers becomes
 * the endpoint, and so the OAuth `resource`.
 */
export async function checkServer(
  url: string,
  deps: {
    hasProxy: boolean;
    allowDirect: boolean;
    oauthFetch?: OAuthFetch;
    probe?: (c: McpCandidate) => Promise<McpProbeResult>;
  },
): Promise<CheckResult> {
  const { hasProxy } = deps;
  let isHttps = false;
  try {
    isHttps = new URL(url.trim()).protocol === 'https:';
  } catch {
    return {
      kind: 'unreachable',
      directOnly: false,
      error: 'This link is not a valid address.',
      cause: 'link',
    };
  }
  if (!hasProxy && !deps.allowDirect && !isHttps) {
    return {
      kind: 'unreachable',
      directOnly: false,
      error: HTTP_ONLY_WITHOUT_PROXY,
      cause: 'link',
    };
  }
  const allowDirect = hasProxy ? deps.allowDirect : true;
  const candidates = buildCandidates(url.trim(), hasProxy, allowDirect);
  const probe = deps.probe ?? liveProbe(null);
  let lastError = '';
  for (const c of candidates) {
    const r = await probe(c);
    if (r.ok) return { kind: 'open', route: c.routing, endpoint: c.url, tools: r.tools };
    if (!r.auth) {
      lastError = r.error ?? lastError;
      continue;
    }
    // An auth answer proves this candidate is the server; the others are not tried.
    try {
      const found = await discoverOAuth(c.url, {
        oauthFetch: deps.oauthFetch ?? createOAuthFetch(),
        route: c.routing,
        hasProxy,
      });
      if (found.kind === 'no-oauth') return { kind: 'key', route: c.routing, endpoint: c.url };
      return { kind: 'sign-in', discovery: found, route: c.routing, endpoint: found.resource };
    } catch (err) {
      // OAuthError messages are written for people; anything else is not shown.
      const error =
        err instanceof OAuthError ? err.message : "This server's sign-in could not be read.";
      return { kind: 'unreachable', directOnly: false, error, cause: 'refused' };
    }
  }
  return { kind: 'unreachable', directOnly: !hasProxy, error: lastError, cause: 'probe' };
}
