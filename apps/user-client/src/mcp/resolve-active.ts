// SPDX-License-Identifier: AGPL-3.0-only
import type { McpServerRow } from '../boot/client-data-db.js';
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
 * Whether a server without a route may find one by itself on first use. Synced
 * tools prove another device connected. Local network servers are excluded: their
 * reachability belongs to the device, and an automatic probe could hand the key to
 * whatever answers at that address on another network, so they need a manual test.
 */
export function canResolveOnFirstUse(row: McpServerRow, hasProxy: boolean): boolean {
  return !row.allowDirect && hasProxy && row.tools.length > 0;
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
