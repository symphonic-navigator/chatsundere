// SPDX-License-Identifier: AGPL-3.0-only
import type { AttachmentRow } from '../../boot/client-data-db.js';

/** Per-item capability descriptor — drives which action buttons the lightbox renders. */
export interface Caps {
  /** Always true — every attachment can be renamed by the user. */
  rename: boolean;
  /** True only for upload-origin items that are still pending (not yet sent). */
  remove: boolean;
  /** True for generated-origin items (Phase 2+; always false in v1). */
  download: boolean;
  /** True for generated-origin items (Phase 2+; always false in v1). */
  delete: boolean;
  /** True for text/markdown items that are still pending — allows editing the source in the lightbox. */
  editSource: boolean;
}

/** Presentation item consumed by the lightbox — storage-agnostic. */
export interface ViewableItem {
  id: string;
  /** Viewer to use: 'image' → `<img>`, 'markdown' → rendered Markdown, 'text' → `<pre>`. */
  kind: 'image' | 'text' | 'markdown';
  fileName: string;
  /** Blob object URL — only present for image items. Caller is responsible for revocation. */
  imageUrl?: string;
  /** Text content — only present for text/markdown items. */
  text?: string;
  caps: Caps;
}

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown']);

function isMarkdown(row: AttachmentRow): boolean {
  if (row.mime === 'text/markdown') return true;
  const dotIndex = row.fileName.lastIndexOf('.');
  return dotIndex >= 0 && MARKDOWN_EXTENSIONS.has(row.fileName.slice(dotIndex + 1).toLowerCase());
}

/**
 * Map a stored `AttachmentRow` to a `ViewableItem` + capability descriptor.
 *
 * Rules:
 * - Rename is always enabled.
 * - Remove is enabled only for upload-origin pending items.
 * - Download/delete are enabled only for generated-origin items (Phase 2+, always false in v1).
 * - editSource is enabled only for text/markdown items that are still pending.
 * - Viewer kind: image → 'image'; text with .md extension or text/markdown mime → 'markdown'; otherwise → 'text'.
 */
export function attachmentToViewable(
  row: AttachmentRow,
  opts: { pending: boolean; objectUrl?: string },
): ViewableItem {
  const viewerKind: ViewableItem['kind'] =
    row.kind === 'image' ? 'image' : isMarkdown(row) ? 'markdown' : 'text';

  return {
    id: row.id,
    kind: viewerKind,
    fileName: row.fileName,
    imageUrl: row.kind === 'image' ? opts.objectUrl : undefined,
    text: row.kind === 'text' ? row.text : undefined,
    caps: {
      rename: true,
      remove: row.origin === 'upload' && opts.pending,
      download: row.origin === 'generated',
      delete: row.origin === 'generated',
      editSource: row.kind === 'text' && opts.pending,
    },
  };
}
