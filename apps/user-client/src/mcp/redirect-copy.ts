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
