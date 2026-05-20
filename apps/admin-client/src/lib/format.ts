// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Format an ISO timestamp as a short relative phrase like "3 minutes ago" or
 * "2 days ago". For `null` returns "Never". For dates older than 30 days
 * falls back to `toLocaleDateString('en-GB')` (DD/MM/YYYY).
 */
export function formatRelative(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'Never';
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} hour${diffHour === 1 ? '' : 's'} ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
  return then.toLocaleDateString('en-GB');
}
