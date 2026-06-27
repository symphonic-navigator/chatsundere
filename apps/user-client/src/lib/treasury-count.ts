// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Treasury header count. `total` is the count of artefacts the user could
 * see (after NSFW gating); `filtered` is how many survive the active filters.
 *
 * - `empty` when there are no artefacts at all,
 * - `N artefacts` when no filter hides anything,
 * - `N of M` when a filter narrows the set — so the header never reads
 *   "42 artefacts" above three rows.
 *
 * @param total Artefacts visible to the user (after NSFW gating).
 * @param filtered How many of those survive the active filters.
 */
export function treasuryCountLabel(total: number, filtered: number): string {
  if (total === 0) return 'empty';
  if (filtered >= total) return `${total} artefacts`;
  return `${filtered} of ${total}`;
}
