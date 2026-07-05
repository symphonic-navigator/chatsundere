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
    /** Page-based pull progress (§11.1); there is no known total, so we count pages fetched. */
    pullingProgress: (pages: number): string =>
      pages === 1 ? '1 page so far' : `${pages} pages so far`,
    recovery: 'Re-checking everything is in sync — your data is safe.',
    /** §3.7 — one-off upload of pre-link data; progress numbers are interpolated. */
    backfill: (done: number, total: number): string =>
      `Uploading your existing data… ${done} of ${total}`,
    /** §3.7 — the one-off total is not yet snapshotted; avoid a misleading "0 of 0". */
    backfillPreparing: 'Uploading your existing data…',
    /** §3.7 — offline while a backfill is pending; reassure it resumes (U-6). */
    offlineBackfill: 'Offline — your upload will pick up where it left off.',
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
    /** §8 — epoch recovery would re-upload a large amount; ask before it does. */
    blobReuploadThreshold: ({ bytes, count }: { bytes: number; count: number }): string =>
      `Re-syncing this device would re-upload ${formatBytes(bytes)} of images (${count} ${
        count === 1 ? 'image' : 'images'
      }). Confirm before it uploads.`,
    tamper:
      'Your server sent something that should not be possible. To protect your data, that change was refused — if this keeps happening, tell your operator.',
    /** §5.2 — the server definitively refused to refresh this session; syncing is
     *  paused until the account is re-linked. Local work is unaffected. */
    authDegraded:
      "This server no longer recognises this device. Your data is safe here — reconnect with a new invitation when you're ready.",
  },

  /** Action labels the status line renders alongside retriable attention states. */
  actions: {
    /** The manual affordance behind the `recovery_paused` attention state (§8). */
    retry: 'Try again',
    /** §5.2 — the relink affordance behind the `auth_degraded` attention state. */
    reconnect: 'Reconnect',
  },

  /** The calm inline breadcrumb shown on the chat surface (§7.3, Laura soft). */
  breadcrumb: {
    deletedElsewhere: 'This was deleted on another device.',
  },

  /**
   * The ambient `ConnectivityBadge`'s expanded/tapped state — "the badge
   * explains the weather" (§11.2). The offline framing rests the app into
   * reading mode rather than reporting breakage.
   */
  connectivity: {
    offlinePaused:
      "Your server isn't reachable, so shared edits are paused — nothing is lost, and everything wakes up the moment you're back. Reading works as always.",
    linkedOnline: 'Connected to your server — shared edits sync as you make them.',
    authFailed: 'Your server needs you to sign in again before syncing resumes.',
    local: 'Local-only — everything stays on this device.',
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

  /**
   * Blob channel copy (WS-D §9). The 413 origin/remote pair distinguishes the
   * device that created the too-large image from every other device (Laura hard);
   * the quota copy names the linked instance ("your server at <host>") rather
   * than an abstract operator; the fetch/placeholder strings drive §10's surfaces.
   */
  blob: {
    /** §9 — origin device: the image the operator's limit rejected stays local. */
    tooLargeOrigin: (maxBlobBytes: number): string =>
      `This image is larger than your server accepts (limit: ${formatBytes(
        maxBlobBytes,
      )}). It stays on this device.`,
    /** §9 — remote device: the terminal placeholder for an oversize-sentinel ref. */
    tooLargeRemote:
      'This image was too large for the server — it lives on the device that created it.',
    /** §9 — quota copy naming the linked instance host (Laura). */
    quotaFull: (
      host: string,
      { usedBytes, quotaBytes }: { usedBytes: number; quotaBytes: number },
    ): string =>
      `Your server at ${host} is out of storage (${formatBytes(usedBytes)} of ${formatBytes(
        quotaBytes,
      )} used). Free space by deleting large images and it will sync.`,
    /** §6/§10 — the status-line sub-state gating "Synced" until the queue drains. */
    fetching: 'Fetching images…',
    /** §10 — a pending (retriable) fetch placeholder. */
    placeholderPending: 'Loading image…',
    /** §10 — a terminal placeholder (oversize sentinel or the §7.1 rest state). */
    placeholderTerminal: 'Image unavailable',
    /** §10 — per-item marker at the origin item: a 413-terminal blob. */
    markerTooLarge: 'Not synced — too large',
    /** §10 — per-item marker at the origin item: a blob waiting on quota. */
    markerStorageFull: 'Not synced — storage full',
    /**
     * §9 — the calm, display-only quota line on the account page. Names the
     * linked instance ("your server at <host>") and the freeing action lives in
     * the adjacent quota attention copy; this line only reports the numbers.
     */
    storageUsed: (
      host: string,
      { usedBytes, quotaBytes }: { usedBytes: number; quotaBytes: number },
    ): string =>
      `${formatBytes(usedBytes)} of ${formatBytes(quotaBytes)} storage used on your server at ${host}.`,
  },
} as const;
