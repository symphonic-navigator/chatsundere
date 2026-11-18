// SPDX-License-Identifier: AGPL-3.0-only
import { Link, useLocation } from 'react-router-dom';
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
 * (add-mcp-connector spec §6.3). Its action opens the server's page, which returns here.
 */
export function McpRedirectNotice({ notice }: { notice: McpRedirectNoticePayload }): JSX.Element {
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}`;
  const href = `/app/integrations/${encodeURIComponent(notice.serverId)}?return=${encodeURIComponent(returnTo)}`;
  return (
    <output className="pill-notice">
      <span>{mcpRedirectNoticeLine(notice.serverName)}</span>
      <Link to={href} className="cs-btn inline-flex min-h-[44px] items-center">
        {`Open ${notice.serverName}`}
      </Link>
    </output>
  );
}
