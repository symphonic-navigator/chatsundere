// SPDX-License-Identifier: AGPL-3.0-only
import type { SyncCollection } from '@chatsundere/shared-types';
import type { ArtefactRow, AttachmentRow } from '../../boot/client-data-db.js';

/** Per-item capability descriptor — drives which action buttons the lightbox renders. */
export interface Caps {
  /** Always true — every attachment can be renamed by the user. */
  rename: boolean;
  /** True for upload- or library-origin items that are still pending (not yet sent). */
  remove: boolean;
  /** True for text items — copy the raw content to the clipboard. */
  copy: boolean;
  /** True for text items — download the content as a file. */
  download: boolean;
  /** True for generated-origin items, e.g. artefacts. */
  delete: boolean;
  /** True for text items that are still pending — allows editing the source. */
  editSource: boolean;
  /** True for artefacts — show the tag editor in the lightbox. */
  editTags: boolean;
}

/** Presentation item consumed by the lightbox — storage-agnostic. */
export interface ViewableItem {
  id: string;
  /** 'image' → `<img>`; 'text' → the format is derived from fileName/mime. */
  kind: 'image' | 'text';
  fileName: string;
  /** Display title, separate from fileName — present for artefacts only. */
  title?: string;
  /** MIME type — used for preview-format detection and download. */
  mime: string;
  /** Blob object URL — only present for image items. Caller revokes. */
  imageUrl?: string;
  /**
   * WS-D §6: a lazy-on-view blob source for an image item whose bytes may not be
   * on this device yet. When present (and `imageUrl` is not), the lightbox drives
   * the fetch off {@link useBlobBytes} — a dismissable ring, hydrate-in-place, and
   * a quiet retry on failure. Existing callers that own an `imageUrl` are unaffected.
   */
  blobSource?: { collection: SyncCollection; key: string; field: string };
  /** Text content — only present for text items. */
  text?: string;
  /** Normalised tags — present for artefacts; drives the lightbox tag editor. */
  tags?: string[];
  /** Human-readable origin label, e.g. "My Library › Doc" — present for library refs. */
  provenance?: string;
  caps: Caps;
}

/** Map a stored artefact to a viewable. Generated artefacts are first-class:
 *  editable, copyable, downloadable, deletable. Image artefacts view the full
 *  blob (thumbnail fallback); the object URL created here follows the
 *  creator-revokes contract of the attachment path — callers that map rows
 *  ad hoc and never unmount simply let it live for the page's lifetime. */
export function artefactToViewable(row: ArtefactRow): ViewableItem {
  if (row.kind === 'image') {
    // WS-D §6: a pulled-but-unhydrated image (refs present, bytes not yet on this
    // device) opens via the lazy blob source — a dismissable ring, hydrate-in-place,
    // and the §10 terminal copy for an oversize sentinel. A locally-present image
    // keeps the immediate object-URL path.
    const localBytes = row.blob ?? row.thumbBlob;
    return {
      id: row.id,
      kind: 'image',
      fileName: row.fileName,
      title: row.title,
      mime: row.mime,
      imageUrl: localBytes ? URL.createObjectURL(localBytes) : undefined,
      blobSource: localBytes ? undefined : { collection: 'artefacts', key: row.id, field: 'blob' },
      tags: row.tags,
      provenance: row.genMeta ? `${row.genMeta.prompt} — via ${row.genMeta.modelLabel}` : undefined,
      caps: {
        rename: true,
        remove: false,
        copy: false,
        download: true,
        delete: true,
        editSource: false,
        editTags: true,
      },
    };
  }
  return {
    id: row.id,
    kind: 'text',
    fileName: row.fileName,
    title: row.title,
    mime: row.mime,
    text: row.content,
    tags: row.tags,
    caps: {
      rename: true,
      remove: false,
      copy: true,
      download: true,
      delete: true,
      editSource: true,
      editTags: true,
    },
  };
}

/**
 * Map a stored `AttachmentRow` to a `ViewableItem` + capability descriptor.
 * The preview format for text items is derived later (format-detect.ts) from
 * `fileName`/`mime`; this layer only carries the raw data + capabilities.
 */
export function attachmentToViewable(
  row: AttachmentRow,
  opts: { pending: boolean; objectUrl?: string; effectiveText?: string; provenance?: string },
): ViewableItem {
  const isText = row.kind === 'text';
  const removable = (row.origin === 'upload' || row.origin === 'library') && opts.pending;
  const hasContent = row.text !== undefined || opts.effectiveText !== undefined;
  // WS-D §6: an image attachment with no local object URL (pulled, not yet
  // hydrated) opens via the lazy blob source; a local one keeps its object URL.
  const lazyImage = row.kind === 'image' && !opts.objectUrl;
  return {
    id: row.id,
    kind: row.kind,
    fileName: row.fileName,
    mime: row.mime,
    imageUrl: row.kind === 'image' ? opts.objectUrl : undefined,
    blobSource: lazyImage ? { collection: 'attachments', key: row.id, field: 'blob' } : undefined,
    text: isText ? (row.text ?? opts.effectiveText) : undefined,
    provenance: opts.provenance,
    caps: {
      rename: true,
      remove: removable,
      copy: isText,
      download: isText,
      delete: row.origin === 'generated',
      editSource: isText && opts.pending && hasContent,
      editTags: false,
    },
  };
}
