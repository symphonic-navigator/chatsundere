// SPDX-License-Identifier: AGPL-3.0-only
import type { AttachmentRow } from '../../boot/client-data-db.js';

/** Per-item capability descriptor — drives which action buttons the lightbox renders. */
export interface Caps {
  /** Always true — every attachment can be renamed by the user. */
  rename: boolean;
  /** True only for upload-origin items that are still pending (not yet sent). */
  remove: boolean;
  /** True for text items — copy the raw content to the clipboard. */
  copy: boolean;
  /** True for text items — download the content as a file. */
  download: boolean;
  /** True for generated-origin items (Phase 2+; always false in v1). */
  delete: boolean;
  /** True for text items that are still pending — allows editing the source. */
  editSource: boolean;
}

/** Presentation item consumed by the lightbox — storage-agnostic. */
export interface ViewableItem {
  id: string;
  /** 'image' → `<img>`; 'text' → the format is derived from fileName/mime. */
  kind: 'image' | 'text';
  fileName: string;
  /** MIME type — used for preview-format detection and download. */
  mime: string;
  /** Blob object URL — only present for image items. Caller revokes. */
  imageUrl?: string;
  /** Text content — only present for text items. */
  text?: string;
  caps: Caps;
}

/**
 * Map a stored `AttachmentRow` to a `ViewableItem` + capability descriptor.
 * The preview format for text items is derived later (format-detect.ts) from
 * `fileName`/`mime`; this layer only carries the raw data + capabilities.
 */
export function attachmentToViewable(
  row: AttachmentRow,
  opts: { pending: boolean; objectUrl?: string },
): ViewableItem {
  const isText = row.kind === 'text';
  return {
    id: row.id,
    kind: row.kind,
    fileName: row.fileName,
    mime: row.mime,
    imageUrl: row.kind === 'image' ? opts.objectUrl : undefined,
    text: isText ? row.text : undefined,
    caps: {
      rename: true,
      remove: row.origin === 'upload' && opts.pending,
      copy: isText,
      download: isText,
      delete: row.origin === 'generated',
      editSource: isText && opts.pending,
    },
  };
}
