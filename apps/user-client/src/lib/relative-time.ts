// SPDX-License-Identifier: AGPL-3.0-only
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Compact, British-convention relative-time label used by HistoryRow.
 *
 * - < 60s   → "just now"
 * - < 1h    → "Xm ago"
 * - < 24h   → "Xh ago"
 * - >= 24h  → "D MMM" (no leading zero on the day)
 */
export function relativeTimeLabel(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
