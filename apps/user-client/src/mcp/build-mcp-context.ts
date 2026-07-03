// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';
import type { McpServerRow } from '../boot/client-data-db.js';
import { openMcpKey } from '../data/mcp-servers.js';
import type { McpActiveServer, McpToolContext } from './mcp-tools.js';
import { resolveActiveServers } from './resolve-active.js';

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
  // Defensive — resolveActiveServers already excludes untested servers; skip rather
  // than crash the send if that invariant ever drifts.
  const servers: McpActiveServer[] = active.flatMap((s) => {
    if (s.routing === null || s.resolvedEndpoint === null) return [];
    return [
      {
        id: s.id,
        name: s.name,
        prefix: s.prefix,
        routing: s.routing,
        resolvedEndpoint: s.resolvedEndpoint,
        auth: s.auth
          ? s.auth.scheme === 'bearer'
            ? { scheme: 'bearer' }
            : { scheme: 'header', headerName: s.auth.headerName }
          : null,
        autoRun: s.autoRun,
        tools: s.tools,
        hiddenTools: s.hiddenTools,
      },
    ];
  });

  return {
    servers,
    getServerKey: async (serverId) => {
      const row = byId.get(serverId);
      if (!row || !args.mk) return null;
      return openMcpKey(row, args.mk);
    },
    requestApproval: args.requestApproval,
  };
}
