// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import type { AttachmentRow } from '../../boot/client-data-db';

function extension(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toUpperCase() : 'TXT';
}

/**
 * A single attachment thumbnail tile.
 *
 * Images display their content via an object URL (created/revoked in an effect).
 * Documents show a pill with the uppercased file extension.
 * A quiet "analysing" indicator appears on sent images that still lack a vision description.
 * Deliberately carries NO remove/× button — removal is via the lightbox only (anti-misclick).
 * Clicking the tile calls `onOpen` so the caller can open the lightbox at this item's index.
 * The `data-attachment-thumb` attribute lets the lightbox re-measure the rect at close time
 * for the reverse FLIP zoom.
 */
export function AttachmentThumb({
  row,
  onOpen,
}: {
  row: AttachmentRow;
  onOpen: () => void;
}): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (row.kind === 'image' && row.blob) {
      const u = URL.createObjectURL(row.blob);
      setUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    return undefined;
  }, [row.kind, row.blob]);

  // Show the "analysing" indicator on a sent image that still awaits a vision description.
  const analysing =
    row.kind === 'image' && row.messageId !== null && row.visionDescription === null;

  return (
    <button
      type="button"
      className="attach-thumb"
      data-kind={row.kind}
      data-attachment-thumb={row.id}
      onClick={() => onOpen()}
      title={row.fileName}
    >
      {row.kind === 'image' && url ? (
        <span className="attach-thumb-img" style={{ backgroundImage: `url(${url})` }} />
      ) : (
        <span className="attach-thumb-doc">{extension(row.fileName)}</span>
      )}
      {analysing && <span className="attach-thumb-analysing" aria-label="Analysing image" />}
      <span className="attach-thumb-name">{row.fileName}</span>
    </button>
  );
}
