// SPDX-License-Identifier: AGPL-3.0-only
import type { McpOAuthGrantRow, McpServerRow } from '../boot/client-data-db.js';
import { assertSecureEndpoint, canonicalResource } from './oauth/url.js';
import type { McpRouting } from './types.js';

type RouteFields = Pick<McpServerRow, 'url' | 'allowDirect' | 'routing' | 'resolvedEndpoint'>;

/**
 * The route this device may use, or null. The chokepoint for "the target is always
 * the user-entered URL": a stored route pointing anywhere else, or going direct
 * against the row's intent, is ignored whatever put it there. Rows pulled before
 * pulls were normalised lack the fields entirely, hence no `=== null`.
 */
export function usableRoute(
  row: RouteFields,
): { routing: McpRouting; resolvedEndpoint: string } | null {
  const { routing, resolvedEndpoint } = row;
  if (!routing || !resolvedEndpoint) return null;
  if (routing === 'direct' && !row.allowDirect) return null;
  try {
    if (new URL(resolvedEndpoint).origin !== new URL(row.url).origin) return null;
  } catch {
    return null;
  }
  return { routing, resolvedEndpoint };
}

/**
 * The token chokepoint (spec §8): an access token may be sent for this row only when
 * the row's URL is, canonically, the resource the grant was issued for, and so is any
 * endpoint this device resolved. Anything else, including a URL that does not parse or
 * is not https, sends nothing.
 */
export function tokenAllowedFor(
  grant: McpOAuthGrantRow,
  row: Pick<McpServerRow, 'url' | 'resolvedEndpoint'>,
): boolean {
  try {
    assertSecureEndpoint(row.url, 'MCP server');
    const resource = canonicalResource(grant.resource);
    if (canonicalResource(row.url) !== resource) return false;
    // Rows pulled before the probe fields existed lack the field, hence no `!== null`.
    if (row.resolvedEndpoint && canonicalResource(row.resolvedEndpoint) !== resource) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a server without a route may find one by itself on first use. Synced
 * tools prove another device connected. Local network servers are excluded: their
 * reachability belongs to the device, and an automatic probe could hand the key to
 * whatever answers at that address on another network, so they need a manual test.
 * OAuth servers are the exception (spec §7): their URL is https and the token
 * chokepoint binds the grant to it, so any route this device has will do.
 */
export function canResolveOnFirstUse(row: McpServerRow, hasProxy: boolean): boolean {
  if (row.tools.length === 0) return false;
  if (row.auth?.scheme === 'oauth') return hasProxy || row.allowDirect;
  return !row.allowDirect && hasProxy;
}

function reachable(s: McpServerRow, hasProxy: boolean): boolean {
  const route = usableRoute(s);
  if (route) return route.routing === 'direct' || hasProxy;
  return canResolveOnFirstUse(s, hasProxy);
}

/** The servers active for a persona this send: enabled, reachable from this
 *  device, and on by default-or-override. */
export function resolveActiveServers(
  servers: McpServerRow[],
  overrides: Record<string, 'on' | 'off'>,
  hasProxy: boolean,
): McpServerRow[] {
  return servers.filter((s) => {
    if (!s.enabled) return false;
    if (!reachable(s, hasProxy)) return false;
    const ov = overrides[s.id];
    return ov ? ov === 'on' : s.onByDefault;
  });
}
