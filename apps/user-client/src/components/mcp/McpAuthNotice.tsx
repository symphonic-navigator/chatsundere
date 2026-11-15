// SPDX-License-Identifier: AGPL-3.0-only
import { useId } from 'react';
import { useMcpOAuthGrants } from '../../data/mcp-oauth-grants.js';
import type { McpAuthNotice as McpAuthNoticePayload } from '../../mcp/mcp-tools.js';
import { isGrantLive, isGrantPaused } from '../../mcp/oauth/grant-generation.js';
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
  // The list's liveness rule: a paused grant never reads as connected again or granted.
  const live = isGrantLive(grant);

  if (notice.variant === 'held' && live) {
    // Pills sync: one paused on another device reads this device's own grant.
    return <output className="pill-notice">{`● ${name}: in use`}</output>;
  }

  if (notice.variant === 'dead' && live) {
    return <output className="pill-notice">{`● ${name}: connected again`}</output>;
  }

  if (notice.variant === 'scope' && live && grant) {
    const wanted = scopesOf(notice.scope);
    const granted = scopesOf(grant.scope ?? undefined);
    // An empty challenge says nothing a grant could be checked against.
    if (wanted.length > 0 && wanted.every((s) => granted.includes(s))) {
      return <output className="pill-notice">{`● ${name}: access granted`}</output>;
    }
  }

  if (notice.variant === 'waiting') {
    return <output className="pill-notice">{`○ ${name}: can't renew access right now`}</output>;
  }

  const scope = notice.variant === 'scope';
  // A held pill with no grant on this device falls back to the ended rendering.
  const paused = notice.variant === 'held' && grant !== undefined && isGrantPaused(grant);
  const label = scope
    ? `⚠ ${name}: needs more access`
    : paused
      ? `⚠ ${name}: sign-in paused on this device`
      : `⚠ ${name}: sign-in ended`;
  return (
    <output className="pill-notice">
      <span>{label}</span>
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
