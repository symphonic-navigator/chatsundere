// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The MCP protocol version this client speaks. Sent in `initialize`, as the header on
 * every request after it (2025-06-18 Streamable HTTP transport), and on direct OAuth
 * POSTs, where the custom header forces a CORS preflight (spec §7).
 */
export const MCP_PROTOCOL_VERSION = '2025-06-18';
