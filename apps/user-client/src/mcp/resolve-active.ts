// SPDX-License-Identifier: AGPL-3.0-only
import type { McpServerRow } from '../boot/client-data-db.js';

/** The servers active for a persona this send: enabled, successfully tested,
 *  on by default-or-override, and reachable given the proxy state. */
export function resolveActiveServers(
  servers: McpServerRow[],
  overrides: Record<string, 'on' | 'off'>,
  hasProxy: boolean,
): McpServerRow[] {
  return servers.filter((s) => {
    if (!s.enabled) return false;
    if (s.routing === null || s.resolvedEndpoint === null) return false;
    if (s.routing === 'proxy' && !hasProxy) return false;
    const ov = overrides[s.id];
    return ov ? ov === 'on' : s.onByDefault;
  });
}
