// SPDX-License-Identifier: AGPL-3.0-only
import { useMcpOAuthGrants } from '../../data/mcp-oauth-grants.js';
import type { McpAuthNotice as McpAuthNoticePayload } from '../../mcp/mcp-tools.js';
import { useMcpSignInOverlay } from '../../state/mcp-sign-in-overlay.store.js';
import { Button } from '../ui/index.js';

/** Splits a scope string into its tokens; empty or absent gives none. */
function scopesOf(scope: string | undefined): string[] {
  return (scope ?? '').split(/\s+/).filter(Boolean);
}

/**
 * The in-chat notice under a tool pill whose OAuth server could not be reached with a
 * token (MCP OAuth spec §9 "In a chat"). It reads the current grant, so a pill from before
 * a recovery stops offering a sign-in. The action only opens the overlay; nothing re-runs.
 */
export function McpAuthNotice({ notice }: { notice: McpAuthNoticePayload }): JSX.Element {
  const grants = useMcpOAuthGrants();
  const open = useMcpSignInOverlay((s) => s.open);
  const grant = (grants.data ?? []).find((g) => g.id === notice.serverId);
  const name = notice.serverName;

  if (notice.variant === 'dead' && grant?.tokens) {
    return <output className="pill-notice">{`● ${name}: connected again`}</output>;
  }

  if (notice.variant === 'waiting') {
    return <output className="pill-notice">{`○ ${name}: can't renew access right now`}</output>;
  }

  const scope = notice.variant === 'scope';
  return (
    <output className="pill-notice">
      <span>{scope ? `⚠ ${name}: needs more access` : `⚠ ${name}: sign-in ended`}</span>
      <Button
        onClick={() =>
          open({ serverId: notice.serverId, extraScopes: scope ? scopesOf(notice.scope) : [] })
        }
      >
        {scope ? 'Grant access' : 'Sign in again'}
      </Button>
    </output>
  );
}
