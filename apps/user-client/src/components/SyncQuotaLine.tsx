// SPDX-License-Identifier: AGPL-3.0-only
import type { BlobListResponse } from '@chatsundere/shared-types';
import { useEffect, useState } from 'react';
import { listBlobs } from '../sync/blob-transport.js';
import { syncCopy } from '../sync/copy.js';
import { useQuotaBlocked } from '../sync/quota-signal.js';

/**
 * The second status row on the account/server-linking page (WS-D §9): a calm,
 * display-only "X of Y storage used on your server at <host>" line sourced from
 * the blob inventory endpoint.
 *
 * DISPLAY-ONLY, PINNED (Larissa I-3): no engine decision ever rides on these
 * server-reported numbers. Fetched on MOUNT and again after a quota error (the
 * shared quota signal flipping) — NOT polled. A fetch failure just hides the
 * line (the account page is not the place to alarm).
 */
export function SyncQuotaLine({
  baseUrl,
  fetchInventory = listBlobs,
}: {
  baseUrl: string;
  /** Injectable for tests; defaults to the real inventory transport. */
  fetchInventory?: () => Promise<BlobListResponse>;
}): JSX.Element | null {
  const [inventory, setInventory] = useState<BlobListResponse | null>(null);
  const quotaBlocked = useQuotaBlocked();

  // Fetch on mount and re-fetch when the server reports its storage full — a
  // quota error is exactly when the numbers change and the user looks. No poll.
  // `quotaBlocked` is a deliberate trigger dependency, not read in the body.
  // biome-ignore lint/correctness/useExhaustiveDependencies: quotaBlocked flip re-fetches (§9)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchInventory();
        if (!cancelled) setInventory(res);
      } catch {
        // A failed inventory read simply hides the line — never an alarm.
        if (!cancelled) setInventory(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchInventory, quotaBlocked]);

  if (!inventory) return null;

  const host = hostOf(baseUrl);
  return (
    <p className="text-[11px] text-paper-soft" data-sync-quota>
      {syncCopy.blob.storageUsed(host, {
        usedBytes: inventory.totalBytes,
        quotaBytes: inventory.quotaBytes,
      })}
    </p>
  );
}

/** The linked instance's host, matching the identity the linking page shows. */
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}
