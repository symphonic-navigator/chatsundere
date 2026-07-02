// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The sync failure/status copy catalogue (spec §11.3 + the §11.1 status-line
 * vocabulary), keyed by server error codes and engine states — mirroring WS-0's
 * gate catalogue. British English; every entry names the next constructive step.
 * Pull from here; never inline sync copy into components.
 */

/** Human-readable byte size for quota copy (e.g. 1_572_864 → "1.5 MB"). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

export const syncCopy = {
  /** §11.1 status-line states. "Synced" is defined to EXCLUDE an active pull. */
  status: {
    /** Relative `lastSyncAt` is appended by the caller. */
    synced: 'Synced',
    waiting: (count: number): string =>
      count === 1 ? '1 change waiting' : `${count} changes waiting`,
    offline: 'Offline — changes queued',
    pulling: 'Pulling your data onto this device…',
    recovery: 'Re-checking everything is in sync — your data is safe.',
  },

  /** Attention (error) states — catalogue copy the status line surfaces. */
  attention: {
    quotaExceeded: ({
      usedBytes,
      quotaBytes,
    }: {
      usedBytes: number;
      quotaBytes: number;
    }): string =>
      `Your account's sync storage is full (${formatBytes(usedBytes)} of ${formatBytes(
        quotaBytes,
      )} used). Free space by deleting large documents, or ask your operator for more.`,
    recordTooLarge:
      "This item is too large to sync (over the server's per-item limit). It stays on this device.",
    deleteRateLimited: "That's a lot of deleting at once — the rest will follow shortly.",
    tombstoneThreshold: (count: number): string =>
      `${count} ${
        count === 1 ? 'item was' : 'items were'
      } removed by another device. They stay recoverable for 30 days.`,
    recoveryPaused: 'Your server is behaving inconsistently — syncing is paused.',
    tamper:
      'Your server sent something that should not be possible. To protect your data, that change was refused — if this keeps happening, tell your operator.',
  },

  /** Post-resolution surface, shown only when the local edit lost the conflict. */
  conflictLost: 'Another device changed this first — its version was kept.',

  /** Settings, two-tier (§11.3): ordinary applied change vs local-precedence overwrite. */
  settings: {
    applied: "Your account's settings were applied.",
    precedence: "Your other device's settings took precedence here.",
  },

  /** The gentlest copy in the catalogue (decision 5): offline bookmarking. */
  offlineBookmark: 'Saved bookmarks need your server — this wakes up the moment you’re back.',
} as const;
