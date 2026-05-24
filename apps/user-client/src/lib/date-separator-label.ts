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

/** Format a chat-stream date-separator label in British convention.
 *  Returns "Today", "Yesterday", or "D MMM YYYY". */
export function formatDateSepLabel(date: Date, now: Date): string {
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = dayStart(now);
  const target = dayStart(date);
  const dayMs = 24 * 60 * 60 * 1000;
  if (target === today) return 'Today';
  if (today - target === dayMs) return 'Yesterday';
  const month = MONTHS[date.getMonth()] ?? '???';
  return `${date.getDate()} ${month} ${date.getFullYear()}`;
}
