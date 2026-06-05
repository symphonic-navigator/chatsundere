// SPDX-License-Identifier: AGPL-3.0-only
import type { SearchTier } from '@chatsundere/llm-unified';

/** The default tier id (first, cheapest) for a tier list, or null when none. */
export function initialTierId(tiers: SearchTier[]): string | null {
  return tiers[0]?.id ?? null;
}

/** Resolve a (possibly stale or null) selected id against the available tiers,
 *  falling back to the default (first). Null when there are no tiers. */
export function resolveTierId(selected: string | null, tiers: SearchTier[]): string | null {
  const first = tiers[0];
  if (!first) return null;
  const hit = selected ? tiers.find((t) => t.id === selected) : undefined;
  return (hit ?? first).id;
}
