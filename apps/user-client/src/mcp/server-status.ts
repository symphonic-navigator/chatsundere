// SPDX-License-Identifier: AGPL-3.0-only
import type { McpOAuthGrantRow, McpServerRow } from '../boot/client-data-db.js';
import { canResolveOnFirstUse, usableRoute } from './resolve-active.js';

/** What the status line needs beyond the row itself. */
export type ServerStatusContext = {
  hasProxy: boolean;
  /** Whether this account is linked, which decides "waiting" against "needs linking". */
  linked: boolean;
  /** The row's grant on this device; undefined when it has not arrived (or the row is no OAuth row). */
  grant?: McpOAuthGrantRow | undefined;
  /** Whether this device has a sign-in in progress for the row. */
  signingIn?: boolean;
};

function connected(routing: 'direct' | 'proxy'): string {
  return routing === 'proxy' ? '● Connected (via proxy)' : '● Connected (direct)';
}

/** The OAuth rows' statuses of spec §9; they take precedence over the `✗` states. */
function oauthStatus(row: McpServerRow, ctx: ServerStatusContext): string {
  if (ctx.signingIn) return '○ Sign-in in progress';
  const grant = ctx.grant;
  // A grant row that has not arrived yet is a wait, never an ended sign-in.
  if (!grant) return '○ Connects on first use';
  if (grant.tokens === null && !grant.pendingTokens) return '⚠ Sign in again';
  const route = usableRoute(row);
  // Tokens renewed through the proxy need it however the tools are reached.
  const needsProxy =
    (route ? route.routing === 'proxy' : !row.allowDirect) || grant.tokenRoute === 'proxy';
  if (needsProxy && !ctx.hasProxy) {
    return ctx.linked
      ? '○ Waiting for your Chatsundere server'
      : '○ Needs a linked Chatsundere server';
  }
  if (!route) return '○ Connects on first use';
  if (row.lastError) return `✗ ${row.lastError}`;
  return connected(route.routing);
}

/** Row status string used in the integrations list and on the detail page. */
export function statusOf(row: McpServerRow, ctx: ServerStatusContext): string {
  if (!row.enabled) return '✗ Disabled';
  if (row.auth?.scheme === 'oauth') return oauthStatus(row, ctx);
  const { hasProxy } = ctx;
  const route = usableRoute(row);
  if (!route) {
    if (!row.allowDirect && !hasProxy) return '✗ Needs proxy or Local network';
    if (row.lastError) return `✗ ${row.lastError}`;
    return canResolveOnFirstUse(row, hasProxy) ? '○ Connects on first use' : '✗ Not tested';
  }
  if (route.routing === 'proxy' && !hasProxy) return '✗ Needs proxy';
  if (row.lastError) return `✗ ${row.lastError}`;
  return connected(route.routing);
}
