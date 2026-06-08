// SPDX-License-Identifier: AGPL-3.0-only
import type { Tool, ToolResult } from '../tools/types.js';
import { mcpToolsCall } from './mcp-client.js';
import { buildMcpToolNames } from './tool-naming.js';
import type { McpAuthResolved, McpEndpoint, McpToolDefinition } from './types.js';

/** One server resolved active for this send (no plaintext key — opened lazily). */
export interface McpActiveServer {
  id: string;
  name: string;
  prefix: string;
  routing: 'direct' | 'proxy';
  resolvedEndpoint: string;
  auth: { scheme: 'bearer' } | { scheme: 'header'; headerName: string } | null;
  autoRun: boolean;
  tools: McpToolDefinition[];
  hiddenTools: string[];
}

/** Per-send MCP context: the active servers plus the proxy coords, key opener, and approval hook. */
export interface McpToolContext {
  servers: McpActiveServer[];
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  /** Opens a server's plaintext key (MasterKey-gated) at call time, or null. */
  getServerKey: (serverId: string) => Promise<string | null>;
  /** Surfaces an approval request and resolves with the user's decision. */
  requestApproval: (req: {
    serverId: string;
    serverName: string;
    toolName: string;
    args: Record<string, unknown>;
  }) => Promise<boolean>;
}

function resolveAuth(server: McpActiveServer, key: string | null): McpAuthResolved | null {
  if (!server.auth || !key) return null;
  if (server.auth.scheme === 'bearer') return { header: 'Authorization', value: `Bearer ${key}` };
  return { header: server.auth.headerName, value: key };
}

/** Build the active MCP tools for this send. Mirrors `contributeKnowledgeTools`. */
export function contributeMcpTools(ctx: McpToolContext): Tool[] {
  const visible = ctx.servers.map((s) => ({
    server: s,
    visibleTools: s.tools.filter((t) => !s.hiddenTools.includes(t.name)),
  }));
  const { tools: named } = buildMcpToolNames(
    visible.map((v) => ({ id: v.server.id, prefix: v.server.prefix, tools: v.visibleTools })),
  );

  const result: Tool[] = [];
  for (const n of named) {
    const entry = visible.find((v) => v.server.id === n.serverId);
    if (!entry) continue;
    const server = entry.server;
    const def = entry.visibleTools.find((t) => t.name === n.originalName);
    if (!def) continue;
    result.push({
      name: n.wireName,
      description: def.description,
      parameters: def.inputSchema,
      systemPromptInstruction: null,
      async execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
        if (!server.autoRun) {
          const ok = await ctx.requestApproval({
            serverId: server.id,
            serverName: server.name,
            toolName: n.originalName,
            args,
          });
          if (!ok) return { ok: false, output: '', error: 'Tool call declined by the user.' };
        }
        try {
          const key = await ctx.getServerKey(server.id);
          const endpoint: McpEndpoint = {
            url: server.resolvedEndpoint,
            routing: server.routing,
            corsProxy:
              server.routing === 'proxy' && ctx.corsProxyUrl && ctx.corsProxyKey
                ? { url: ctx.corsProxyUrl, key: ctx.corsProxyKey }
                : null,
            auth: resolveAuth(server, key),
          };
          const r = await mcpToolsCall(endpoint, n.originalName, args, 30_000, signal);
          if (r.error) return { ok: false, output: '', error: r.error };
          return { ok: true, output: r.stdout, error: null };
        } catch (e) {
          return {
            ok: false,
            output: '',
            error: e instanceof Error ? e.message : 'MCP tool failed.',
          };
        }
      },
    });
  }
  return result;
}
