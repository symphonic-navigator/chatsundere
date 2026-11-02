// SPDX-License-Identifier: AGPL-3.0-only
import type { Tool, ToolResult } from '../tools/types.js';
import { mcpToolsCall } from './mcp-client.js';
import { buildMcpToolNames } from './tool-naming.js';
import type { McpAuthResolved, McpEndpoint, McpRouting, McpToolDefinition } from './types.js';

/**
 * Upper bound for one MCP tool call. Agentic servers run real work (searches,
 * shell-like commands), so this is a hung-server guard rather than a latency goal.
 */
const MCP_CALL_TIMEOUT_MS = 120_000;

/** One server resolved active for this send (no plaintext key — opened lazily). */
export interface McpActiveServer {
  id: string;
  name: string;
  prefix: string;
  /** Null until probed on this device; resolved on first use. */
  routing: McpRouting | null;
  resolvedEndpoint: string | null;
  auth: { scheme: 'bearer' } | { scheme: 'header'; headerName: string } | null;
  autoRun: boolean;
  tools: McpToolDefinition[];
  hiddenTools: string[];
}

/** Per-send MCP context: the active servers plus the key opener and approval hook. */
export interface McpToolContext {
  servers: McpActiveServer[];
  /** Opens a server's plaintext key (MasterKey-gated) at call time, or null. */
  getServerKey: (serverId: string) => Promise<string | null>;
  /** Surfaces an approval request and resolves with the user's decision. */
  requestApproval: (req: {
    serverId: string;
    serverName: string;
    toolName: string;
    args: Record<string, unknown>;
  }) => Promise<boolean>;
  /** Probes a server this device has no route to yet, and remembers the outcome. */
  resolveRoute: (
    serverId: string,
    auth: McpAuthResolved | null,
    signal?: AbortSignal,
  ) => Promise<McpRouteResult>;
}

/** Outcome of resolving a route on this device. */
export type McpRouteResult =
  | { ok: true; routing: McpRouting; resolvedEndpoint: string }
  | { ok: false; error: string };

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

  // Several tools share a server and a send may call them repeatedly: one probe is enough.
  const routes = new Map<string, Promise<McpRouteResult>>();
  const routeFor = (
    server: McpActiveServer,
    auth: McpAuthResolved | null,
    signal?: AbortSignal,
  ) => {
    if (server.routing && server.resolvedEndpoint) {
      const known: McpRouteResult = {
        ok: true,
        routing: server.routing,
        resolvedEndpoint: server.resolvedEndpoint,
      };
      return Promise.resolve(known);
    }
    let route = routes.get(server.id);
    if (!route) {
      // A failure stays retryable within the turn: the model may well try again.
      route = ctx.resolveRoute(server.id, auth, signal).then(
        (r) => {
          if (!r.ok) routes.delete(server.id);
          return r;
        },
        (e: unknown) => {
          routes.delete(server.id);
          throw e;
        },
      );
      routes.set(server.id, route);
    }
    return route;
  };

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
          const auth = resolveAuth(server, key);
          const route = await routeFor(server, auth, signal);
          if (!route.ok) {
            return {
              ok: false,
              output: '',
              error: `Could not connect to ${server.name}: ${route.error}`,
            };
          }
          const endpoint: McpEndpoint = {
            url: route.resolvedEndpoint,
            routing: route.routing,
            auth,
          };
          const r = await mcpToolsCall(endpoint, n.originalName, args, MCP_CALL_TIMEOUT_MS, signal);
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
