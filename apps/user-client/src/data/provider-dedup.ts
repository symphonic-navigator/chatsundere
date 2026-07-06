// SPDX-License-Identifier: AGPL-3.0-only
import type { ProviderRow } from '../boot/client-data-db.js';

/**
 * Pick the single survivor amongst provider rows sharing a `templateId` (spec §5.2).
 * A total order, so every device converges on the same winner: an enabled row
 * beats a disabled one; else the higher `updatedAt` wins; else the
 * lexicographically smaller `id` is the deterministic tiebreak. `rows` must be
 * non-empty.
 */
export function pickProviderSurvivor(rows: ProviderRow[]): ProviderRow {
  return rows.reduce((best, r) => {
    if (r.enabled !== best.enabled) return r.enabled ? r : best;
    if (r.updatedAt !== best.updatedAt) return r.updatedAt > best.updatedAt ? r : best;
    return r.id < best.id ? r : best;
  });
}
