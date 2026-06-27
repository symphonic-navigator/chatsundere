// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The My History header count for the Chats tab. `total` is how many chats the
 * user could see (after NSFW persona gating); `shown` is how many survive the
 * active persona filter + title search.
 *
 * - `empty` when there are no chats at all,
 * - `N chats` (singular `1 chat`) when no filter hides anything,
 * - `N of M` when a filter narrows the set — so the header never reads
 *   "8 chats" above three rows.
 *
 * @param total Chats visible to the user (after NSFW gating).
 * @param shown How many of those survive the active filter + search.
 */
export function historyCountLabel(total: number, shown: number): string {
  if (total === 0) return 'empty';
  if (shown >= total) return `${total} ${total === 1 ? 'chat' : 'chats'}`;
  return `${shown} of ${total}`;
}
