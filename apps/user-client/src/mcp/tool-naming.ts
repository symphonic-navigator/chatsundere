// SPDX-License-Identifier: AGPL-3.0-only

const MAX_NAME = 64;

/** OpenAI-compatible tool names allow only [a-zA-Z0-9_-], max 64 chars. */
export function sanitiseToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, MAX_NAME);
}

/** Prepend a server prefix to a tool name; the result is sanitised and clipped to 64 chars (the OpenAI wire limit). */
export function applyPrefix(prefix: string, name: string): string {
  return sanitiseToolName(`${prefix}_${name}`);
}

/** Input shape for buildMcpToolNames: one configured MCP server and its tool names. */
export interface NamingServer {
  id: string;
  prefix: string;
  tools: { name: string }[];
}

/** A tool with its collision-free wire name ready for the OpenAI tools array. */
export interface NamedTool {
  serverId: string;
  originalName: string;
  wireName: string;
}

/** Build collision-free wire names across all active servers plus a reverse map
 *  (wireName → {serverId, originalName}) for dispatch. Deterministic: a clashing
 *  wire name gets a numeric discriminator appended. */
export function buildMcpToolNames(servers: NamingServer[]): {
  tools: NamedTool[];
  reverse: Map<string, { serverId: string; originalName: string }>;
} {
  const used = new Set<string>();
  const tools: NamedTool[] = [];
  const reverse = new Map<string, { serverId: string; originalName: string }>();

  for (const server of servers) {
    for (const tool of server.tools) {
      let wireName = applyPrefix(server.prefix, tool.name);
      if (used.has(wireName)) {
        let n = 2;
        let suffix = `_${n}`;
        let base = wireName.slice(0, MAX_NAME - suffix.length);
        while (used.has(`${base}${suffix}`)) {
          n++;
          suffix = `_${n}`;
          base = wireName.slice(0, MAX_NAME - suffix.length);
        }
        wireName = `${base}${suffix}`;
      }
      used.add(wireName);
      tools.push({ serverId: server.id, originalName: tool.name, wireName });
      reverse.set(wireName, { serverId: server.id, originalName: tool.name });
    }
  }
  return { tools, reverse };
}
