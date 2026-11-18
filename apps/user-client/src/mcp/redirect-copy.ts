// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The status line and *Test connection* sentence for an MCP server that answered with a
 * redirect (add-mcp-connector spec §6.3).
 */
export const MCP_REDIRECT_DETAIL =
  "This server answered with a redirect, which Chatsundere doesn't follow. Enter its final link.";

/** The *Add server* check's sentence for a link that redirects (spec §6.3). */
export const MCP_REDIRECT_CHECK =
  "This link redirects somewhere else, and Chatsundere only connects to the exact link it is given. Use the server's final link — often the same link with or without a / at the end.";

/** The pill notice's sentence for a tool call whose server answered with a redirect (spec §6.3). */
export function mcpRedirectNoticeLine(serverName: string): string {
  return `${serverName} answered with a redirect, which Chatsundere doesn't follow.`;
}

/**
 * The constant tool result for a call whose server answered with a redirect: names only,
 * so it is the same on every call and replays byte-identically (spec §6.3 "Running chats").
 */
export function mcpRedirectToolError(serverName: string): string {
  return `${mcpRedirectNoticeLine(serverName)} Tell the user to open the server in My Integrations and enter its final link; do not retry this tool in this turn.`;
}
