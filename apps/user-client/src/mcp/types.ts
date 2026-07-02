// SPDX-License-Identifier: AGPL-3.0-only

/** A tool as advertised by an MCP server's `tools/list`. */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type McpRouting = 'direct' | 'proxy';

/** How a single MCP call reaches its server. Built per call: `auth.value`
 *  carries the opened plaintext key (never persisted). */
export interface McpEndpoint {
  /** Resolved endpoint URL (bare or +/mcp), as decided by the connection test. */
  url: string;
  routing: McpRouting;
  /** Auth header to send to the upstream, or null. */
  auth: { header: string; value: string } | null;
}

/** Outcome of a single connection probe. */
export interface McpProbeResult {
  ok: boolean;
  tools: McpToolDefinition[];
  error: string | null;
}

/** A candidate (routing × URL variant) the connection test tries in order. */
export interface McpCandidate {
  routing: McpRouting;
  url: string;
}

/** Resolved outcome of the connection test for a server. */
export interface McpConnectionResult {
  ok: boolean;
  routing: McpRouting | null;
  resolvedEndpoint: string | null;
  tools: McpToolDefinition[];
  error: string | null;
}

/** A resolved auth header (plaintext key already opened). */
export interface McpAuthResolved {
  header: string;
  value: string;
}
