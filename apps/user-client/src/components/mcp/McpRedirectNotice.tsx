// SPDX-License-Identifier: AGPL-3.0-only
import { Link, useLocation } from 'react-router-dom';
import { useMcpServers } from '../../data/mcp-servers.js';
import type { McpRedirectNotice as McpRedirectNoticePayload } from '../../mcp/mcp-tools.js';
import { mcpRedirectNoticeLine } from '../../mcp/redirect-copy.js';

/** The payload's notice when both fields are strings; pills can come from imported files. */
export function readMcpRedirectNotice(value: unknown): McpRedirectNoticePayload | null {
  if (typeof value !== 'object' || value === null) return null;
  const { serverId, serverName } = value as Record<string, unknown>;
  if (typeof serverId !== 'string' || typeof serverName !== 'string') return null;
  return { serverId, serverName };
}

/**
 * The in-chat notice under a tool pill whose MCP server answered with a redirect
 * (add-mcp-connector spec §6.3). Its action opens the server's page, which returns here;
 * once the server is known to be gone from this device, it opens My Integrations instead.
 */
export function McpRedirectNotice({ notice }: { notice: McpRedirectNoticePayload }): JSX.Element {
  const location = useLocation();
  const { data: servers } = useMcpServers();
  const returnTo = encodeURIComponent(`${location.pathname}${location.search}`);
  // Until the servers have loaded, the server is assumed to be there.
  const gone = servers !== undefined && !servers.some((s) => s.id === notice.serverId);
  const href = gone
    ? `/app/integrations?return=${returnTo}`
    : `/app/integrations/${encodeURIComponent(notice.serverId)}?return=${returnTo}`;
  return (
    <output className="pill-notice">
      <span>{mcpRedirectNoticeLine(notice.serverName)}</span>
      <Link
        to={href}
        className="cs-btn inline-flex max-w-full items-center [overflow-wrap:anywhere]"
      >
        {gone ? 'Open My Integrations' : `Open ${notice.serverName}`}
      </Link>
    </output>
  );
}
