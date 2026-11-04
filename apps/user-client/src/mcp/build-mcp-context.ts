// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';
import {
  type McpOAuthGrantRow,
  type McpServerRow,
  getClientDataDb,
} from '../boot/client-data-db.js';
import { openMcpKey, persistMcpRoute, recordMcpConsent } from '../data/mcp-servers.js';
import { candidatesFor, testMcpConnection } from './mcp-connectivity.js';
import type { McpActiveServer, McpTokenResult, McpToolContext } from './mcp-tools.js';
import { type EnsureResult, createEnsureDeps, ensureAccessToken } from './oauth/ensure-token.js';
import { resolveActiveServers, tokenAllowedFor, usableRoute } from './resolve-active.js';

type EnsureOpts = Parameters<McpToolContext['getOAuthToken']>[1];

/** Inputs for assembling the per-send MCP context. */
export interface BuildMcpContextArgs {
  servers: McpServerRow[];
  overrides: Record<string, 'on' | 'off'>;
  hasProxy: boolean;
  mk: MasterKey | null;
  requestApproval: McpToolContext['requestApproval'];
  requestFirstUse: McpToolContext['requestFirstUse'];
  /** One per send: which servers already produced an auth notice in it. */
  authNotices?: Map<string, string>;
  /** Reads a server's grant; defaults to the local database. */
  getGrant?: (serverId: string) => Promise<McpOAuthGrantRow | undefined>;
  /** Obtains an access token; defaults to the cross-device refresh algorithm. */
  ensureToken?: (serverId: string, opts: EnsureOpts) => Promise<EnsureResult>;
}

const readGrant = (serverId: string): Promise<McpOAuthGrantRow | undefined> =>
  getClientDataDb().mcpOAuthGrants.get(serverId);

async function realEnsure(serverId: string, opts: EnsureOpts): Promise<EnsureResult> {
  try {
    return await ensureAccessToken(serverId, await createEnsureDeps(), opts ?? {});
  } catch {
    return { ok: false, reason: 'waiting' };
  }
}

/**
 * The access token for an OAuth row, through the chokepoint and the refresh path. Shared
 * by the chat's tool calls and the detail page's *Test connection*.
 */
export async function oauthTokenFor(
  row: McpServerRow,
  opts: EnsureOpts,
  deps: {
    getGrant?: BuildMcpContextArgs['getGrant'];
    ensureToken?: BuildMcpContextArgs['ensureToken'];
  } = {},
): Promise<McpTokenResult> {
  if (row.auth?.scheme !== 'oauth') return { ok: false, reason: 'not-oauth' };
  let grant: McpOAuthGrantRow | undefined;
  try {
    grant = await (deps.getGrant ?? readGrant)(row.id);
  } catch {
    return { ok: false, reason: 'waiting' };
  }
  // A grant row that has not arrived yet is a wait, not an ended sign-in (spec §9).
  if (!grant) return { ok: false, reason: 'no-grant' };
  // The chokepoint: no token is even opened for a row the grant does not belong to.
  if (
    !tokenAllowedFor(grant, {
      url: row.url,
      resolvedEndpoint: usableRoute(row)?.resolvedEndpoint ?? null,
    })
  ) {
    return { ok: false, reason: 'mismatch' };
  }
  return (deps.ensureToken ?? realEnsure)(row.id, opts);
}

/** Assemble the per-send MCP context, or null when no server is active. */
export function buildMcpContext(args: BuildMcpContextArgs): McpToolContext | null {
  const active = resolveActiveServers(args.servers, args.overrides, args.hasProxy);
  if (active.length === 0) return null;
  const getGrant = args.getGrant ?? readGrant;
  const ensureToken = args.ensureToken ?? realEnsure;

  const byId = new Map(active.map((s) => [s.id, s]));
  const servers: McpActiveServer[] = active.map((s) => ({
    id: s.id,
    name: s.name,
    prefix: s.prefix,
    url: s.url,
    routing: usableRoute(s)?.routing ?? null,
    resolvedEndpoint: usableRoute(s)?.resolvedEndpoint ?? null,
    auth: s.auth
      ? s.auth.scheme === 'header'
        ? { scheme: 'header', headerName: s.auth.headerName }
        : { scheme: s.auth.scheme }
      : null,
    autoRun: s.autoRun,
    hasConsent: (s.firstUseConsentFor ?? null) === s.url,
    tools: s.tools,
    hiddenTools: s.hiddenTools,
  }));

  return {
    servers,
    ...(args.authNotices ? { authNotices: args.authNotices } : {}),
    getServerKey: async (serverId) => {
      const row = byId.get(serverId);
      if (!row || !args.mk) return null;
      return openMcpKey(row, args.mk);
    },
    getOAuthToken: async (serverId, opts): Promise<McpTokenResult> => {
      const row = byId.get(serverId);
      if (!row) return { ok: false, reason: 'not-oauth' };
      return oauthTokenFor(row, opts, { getGrant, ensureToken });
    },
    requestApproval: args.requestApproval,
    requestFirstUse: args.requestFirstUse,
    recordConsent: (serverId, url) => recordMcpConsent(serverId, url),
    resolveRoute: async (serverId, auth, signal) => {
      const row = byId.get(serverId);
      if (!row) return { ok: false, error: 'This server is no longer configured.' };
      let candidates: ReturnType<typeof candidatesFor> | undefined;
      if (row.auth?.scheme === 'oauth') {
        const grant = await getGrant(serverId);
        candidates = grant ? candidatesFor(row, grant, args.hasProxy) : [];
        if (candidates.length === 0) {
          return { ok: false, error: 'This server has no sign-in that matches its address.' };
        }
      }
      const result = await testMcpConnection({
        url: row.url,
        hasProxy: args.hasProxy,
        allowDirect: row.allowDirect,
        auth,
        signal,
        ...(candidates ? { candidates } : {}),
      });
      if (!result.ok || !result.routing || !result.resolvedEndpoint) {
        return {
          ok: false,
          error: result.error ?? 'No route to the server.',
          ...(result.auth ? { auth: result.auth } : {}),
          ...(result.scope ? { scope: result.scope } : {}),
        };
      }
      const route = { routing: result.routing, resolvedEndpoint: result.resolvedEndpoint };
      await persistMcpRoute(serverId, route, { url: row.url, allowDirect: row.allowDirect });
      return { ok: true, ...route };
    },
  };
}
