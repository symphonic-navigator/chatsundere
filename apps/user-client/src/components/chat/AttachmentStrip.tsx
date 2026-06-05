// SPDX-License-Identifier: AGPL-3.0-only
import type { AttachmentRow } from '../../boot/client-data-db';
import { AttachmentThumb } from './AttachmentThumb';

/**
 * Horizontal strip of attachment thumbnails for a chat cockpit or a sent message bubble.
 *
 * Renders nothing when the attachment list is empty.
 * Calls `onOpen(index, rect)` when a thumb is clicked, forwarding the tile's bounding rect
 * so the caller can open the lightbox with a FLIP zoom from the correct origin.
 */
export function AttachmentStrip({
  attachments,
  onOpen,
}: {
  attachments: AttachmentRow[];
  onOpen: (index: number, rect: DOMRect) => void;
}): JSX.Element | null {
  if (attachments.length === 0) return null;
  return (
    <div className="attach-strip">
      {attachments.map((row, i) => (
        <AttachmentThumb key={row.id} row={row} onOpen={(rect) => onOpen(i, rect)} />
      ))}
    </div>
  );
}
