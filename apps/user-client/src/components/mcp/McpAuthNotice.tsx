// SPDX-License-Identifier: AGPL-3.0-only
import { useId } from 'react';
import { useMcpOAuthGrants } from '../../data/mcp-oauth-grants.js';
import type { McpAuthNotice as McpAuthNoticePayload } from '../../mcp/mcp-tools.js';
import { useMcpSignInOverlay } from '../../state/mcp-sign-in-overlay.store.js';
import { useClass2Gate } from '../../sync/gate.js';
import { Button } from '../ui/index.js';
import { SIGN_IN_WAITS_FOR_BACKEND } from './sign-in-copy.js';

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
  const blocked = useClass2Gate().disabled;
  const reasonId = useId();
  const grant = (grants.data ?? []).find((g) => g.id === notice.serverId);
  const name = notice.serverName;
  // The same test as the list's status: a pending pair is live access too.
  const live = grant !== undefined && (grant.tokens !== null || Boolean(grant.pendingTokens));

  if (notice.variant === 'dead' && live) {
    return <output className="pill-notice">{`● ${name}: connected again`}</output>;
  }

  if (notice.variant === 'scope' && live) {
    const wanted = scopesOf(notice.scope);
    const held = scopesOf(grant.scope ?? undefined);
    // An empty challenge says nothing a grant could be checked against.
    if (wanted.length > 0 && wanted.every((s) => held.includes(s))) {
      return <output className="pill-notice">{`● ${name}: access granted`}</output>;
    }
  }

  if (notice.variant === 'waiting') {
    return <output className="pill-notice">{`○ ${name}: can't renew access right now`}</output>;
  }

  const scope = notice.variant === 'scope';
  return (
    <output className="pill-notice">
      <span>{scope ? `⚠ ${name}: needs more access` : `⚠ ${name}: sign-in ended`}</span>
      <Button
        disabled={blocked}
        aria-describedby={blocked ? reasonId : undefined}
        onClick={() =>
          open({ serverId: notice.serverId, extraScopes: scope ? scopesOf(notice.scope) : [] })
        }
      >
        {scope ? 'Grant access' : 'Sign in again'}
      </Button>
      {blocked ? (
        <span id={reasonId} className="text-xs text-paper-soft">
          {SIGN_IN_WAITS_FOR_BACKEND}
        </span>
      ) : null}
    </output>
  );
}
