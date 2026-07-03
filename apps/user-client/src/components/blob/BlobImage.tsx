// SPDX-License-Identifier: AGPL-3.0-only
import type { SyncCollection } from '@chatsundere/shared-types';
import { useEffect, useState } from 'react';
import { useBlobBytes } from '../../sync/blob-fetch.js';
import { syncCopy } from '../../sync/copy.js';

/**
 * Render a blob-bearing image that may not be on this device yet (WS-D §6/§10).
 * Drives the placeholder → progress → hydrate lifecycle off {@link useBlobBytes}:
 *
 *  - `ready`       → the image, from the row's local bytes;
 *  - `loading` /   → a calm neutral frame with a file-type glyph and an
 *    initial `placeholder`  indeterminate progress ring (driven by the ref's presence);
 *  - `terminal`    → the §10 explanatory copy, NO retry — an oversize sentinel or
 *    the §7.1 rest state is unrecoverable, and a retry nag would misdirect;
 *  - a *pending*   → the same explanatory-but-actionable copy PLUS a quiet retry
 *    failed fetch    affordance (never a trapping ring).
 *
 * Terminal and pending are deliberately distinct in look and behaviour — never a
 * broken-image glyph, never a retry nag on the unrecoverable (Laura hard).
 *
 * The lazy path never blocks its host surface: the frame renders immediately and
 * the image hydrates in place when the fetch completes onto the Dexie row.
 */
export function BlobImage({
  collection,
  recordKey,
  field,
  alt,
  className,
  glyph = '🖼',
}: {
  collection: SyncCollection;
  recordKey: string;
  field: string;
  alt: string;
  className?: string;
  /** File-type glyph shown on the neutral placeholder frame. */
  glyph?: string;
}): JSX.Element {
  const result = useBlobBytes(collection, recordKey, field);
  const [url, setUrl] = useState<string | null>(null);

  // Own the object URL's lifecycle: create when bytes arrive, revoke on change
  // or unmount. Mirrors the AttachmentThumb pattern (effect-owned URLs).
  useEffect(() => {
    if (result.state !== 'ready' || !result.bytes) {
      setUrl(null);
      return undefined;
    }
    const u = URL.createObjectURL(result.bytes);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [result.state, result.bytes]);

  if (result.state === 'ready' && url) {
    return <img className={className} src={url} alt={alt} data-blob-state="ready" />;
  }

  if (result.state === 'terminal') {
    return (
      <span className={className} data-blob-state="terminal" role="img" aria-label={alt}>
        <span className="blob-frame">
          <span className="blob-frame-glyph" aria-hidden>
            {glyph}
          </span>
          <span className="blob-frame-note">{syncCopy.blob.placeholderTerminal}</span>
        </span>
      </span>
    );
  }

  // A pending (retriable) failure: a quiet retry affordance, distinct from terminal.
  if (result.state === 'placeholder' && result.retry) {
    const retry = result.retry;
    return (
      <span className={className} data-blob-state="pending" role="img" aria-label={alt}>
        <span className="blob-frame">
          <span className="blob-frame-glyph" aria-hidden>
            {glyph}
          </span>
          <span className="blob-frame-note">{syncCopy.blob.placeholderPending}</span>
          <button type="button" className="blob-frame-retry" onClick={() => retry()}>
            {syncCopy.actions.retry}
          </button>
        </span>
      </span>
    );
  }

  // Initial placeholder or loading: the calm neutral frame + progress ring.
  return (
    <span className={className} data-blob-state="loading" role="img" aria-label={alt}>
      <span className="blob-frame">
        <span className="blob-frame-glyph" aria-hidden>
          {glyph}
        </span>
        <span className="blob-frame-ring" aria-hidden />
      </span>
    </span>
  );
}
