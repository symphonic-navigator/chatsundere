// SPDX-License-Identifier: AGPL-3.0-only
import type { AttachmentRow } from '../../boot/client-data-db';
import { AttachmentThumb } from './AttachmentThumb';

/**
 * Horizontal strip of attachment thumbnails for a chat cockpit or a sent message bubble.
 *
 * Renders nothing when the attachment list is empty.
 * Calls `onOpen(index)` when a thumb is clicked so the caller can open the lightbox at
 * the correct position. The lightbox re-measures the origin rect at close time via
 * `[data-attachment-thumb="<id>"]`.
 */
export function AttachmentStrip({
  attachments,
  onOpen,
}: {
  attachments: AttachmentRow[];
  onOpen: (index: number) => void;
}): JSX.Element | null {
  if (attachments.length === 0) return null;
  return (
    <div className="attach-strip">
      {attachments.map((row, i) => (
        <AttachmentThumb key={row.id} row={row} onOpen={() => onOpen(i)} />
      ))}
    </div>
  );
}
