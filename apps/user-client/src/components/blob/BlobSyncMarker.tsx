// SPDX-License-Identifier: AGPL-3.0-only
import { syncCopy } from '../../sync/copy.js';
import { useQuotaBlocked } from '../../sync/quota-signal.js';

/**
 * The per-item blob sync marker (WS-D §10, Laura hard/soft). A small, calm,
 * inspectable pill worn by an artefact/attachment item in the chat or Treasury
 * whose blob will never reach the server — either permanently ("too large",
 * a durable `413` sentinel) or transiently ("storage full", the server's quota
 * is exhausted and the upload waits for space to be freed).
 *
 * The user who created the image lives in the chat, not on the account page, so
 * the truth surfaces at the item. Disabled-over-hidden discipline: a synced or
 * merely-still-draining item shows NO marker; there are no toasts.
 */

/** The resolved marker kind, or `null` when the item needs no marker. */
export type BlobMarkerKind = 'too-large' | 'storage-full' | null;

/**
 * Pure marker resolution (§10). `oversized` is the durable per-row sentinel;
 * `storage-full` is only shown for an item that both still holds unsynced bytes
 * AND whose server is currently out of storage — a normal in-flight upload
 * (quota fine) wears nothing.
 */
export function resolveBlobMarker(input: {
  oversized: boolean;
  hasUnsyncedBlob: boolean;
  quotaBlocked: boolean;
}): BlobMarkerKind {
  if (input.oversized) return 'too-large';
  if (input.quotaBlocked && input.hasUnsyncedBlob) return 'storage-full';
  return null;
}

const MARKER_COPY: Record<Exclude<BlobMarkerKind, null>, string> = {
  'too-large': syncCopy.blob.markerTooLarge,
  'storage-full': syncCopy.blob.markerStorageFull,
};

/**
 * Render the marker for one blob-bearing item. `oversized` and `hasUnsyncedBlob`
 * are read from the owning row; the quota signal is shared (§7.3). Renders
 * nothing when the item needs no marker.
 */
export function BlobSyncMarker({
  oversized,
  hasUnsyncedBlob,
}: {
  oversized: boolean;
  hasUnsyncedBlob: boolean;
}): JSX.Element | null {
  const quotaBlocked = useQuotaBlocked();
  const marker = resolveBlobMarker({ oversized, hasUnsyncedBlob, quotaBlocked });
  if (marker === null) return null;
  const text = MARKER_COPY[marker];
  return (
    <span className="blob-marker" data-blob-marker={marker} title={text}>
      <span className="blob-marker-dot" aria-hidden>
        ⃠
      </span>
      {text}
    </span>
  );
}
