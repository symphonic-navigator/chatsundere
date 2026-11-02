// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';
import type { McpServerRow } from '../boot/client-data-db.js';
import { openMcpKey, persistMcpRoute } from '../data/mcp-servers.js';
import { testMcpConnection } from './mcp-connectivity.js';
import type { McpActiveServer, McpToolContext } from './mcp-tools.js';
import { resolveActiveServers, usableRoute } from './resolve-active.js';

/** Inputs for assembling the per-send MCP context. */
export interface BuildMcpContextArgs {
  servers: McpServerRow[];
  overrides: Record<string, 'on' | 'off'>;
  hasProxy: boolean;
  mk: MasterKey | null;
  requestApproval: McpToolContext['requestApproval'];
}

/** Assemble the per-send MCP context, or null when no server is active. */
export function buildMcpContext(args: BuildMcpContextArgs): McpToolContext | null {
  const active = resolveActiveServers(args.servers, args.overrides, args.hasProxy);
  if (active.length === 0) return null;

  const byId = new Map(active.map((s) => [s.id, s]));
  const servers: McpActiveServer[] = active.map((s) => ({
    id: s.id,
    name: s.name,
    prefix: s.prefix,
    routing: usableRoute(s)?.routing ?? null,
    resolvedEndpoint: usableRoute(s)?.resolvedEndpoint ?? null,
    auth: s.auth
      ? s.auth.scheme === 'bearer'
        ? { scheme: 'bearer' }
        : { scheme: 'header', headerName: s.auth.headerName }
      : null,
    autoRun: s.autoRun,
    tools: s.tools,
    hiddenTools: s.hiddenTools,
  }));

  return {
    servers,
    getServerKey: async (serverId) => {
      const row = byId.get(serverId);
      if (!row || !args.mk) return null;
      return openMcpKey(row, args.mk);
    },
    requestApproval: args.requestApproval,
    resolveRoute: async (serverId, auth, signal) => {
      const row = byId.get(serverId);
      if (!row) return { ok: false, error: 'This server is no longer configured.' };
      const result = await testMcpConnection({
        url: row.url,
        hasProxy: args.hasProxy,
        allowDirect: row.allowDirect,
        auth,
        signal,
      });
      if (!result.ok || !result.routing || !result.resolvedEndpoint) {
        return { ok: false, error: result.error ?? 'No route to the server.' };
      }
      const route = { routing: result.routing, resolvedEndpoint: result.resolvedEndpoint };
      await persistMcpRoute(serverId, route, { url: row.url, allowDirect: row.allowDirect });
      return { ok: true, ...route };
    },
  };
}
