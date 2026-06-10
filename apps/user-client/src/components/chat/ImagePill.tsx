// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { type ArtefactRow, type PillRow, getClientDataDb } from '../../boot/client-data-db.js';
import { Lightbox } from '../lightbox/Lightbox.js';
import type { ViewableItem } from '../lightbox/viewable-item.js';
import { CopyButton } from './markdown/CopyButton.js';

interface ImagePayload {
  argumentsJson?: string;
  prompt?: string;
  modelLabel?: string;
  artefactIds?: string[];
  moderatedReasons?: string[];
  error?: string;
}

/** How many images the call asked for — from the streamed arguments JSON.
 *  Partial or unparseable JSON falls back to 1; never crashes. */
function countOf(p: ImagePayload): number {
  if (!p.argumentsJson) return 1;
  try {
    const parsed = JSON.parse(p.argumentsJson) as { count?: unknown };
    if (typeof parsed.count === 'number' && parsed.count > 0) return parsed.count;
  } catch {
    /* ignore — arguments may still be streaming */
  }
  return 1;
}

const EMPTY_IDS: string[] = [];
const EMPTY_ARTEFACTS: ArtefactRow[] = [];

/** Pill for generate_image tool-calls: live "painting" while pending, expandable
 *  prompt + provenance when done, with inline thumbnails opening a lightbox. */
export function ImagePill({ row }: { row: PillRow }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const p = (row.payload ?? {}) as ImagePayload;
  const model = p.modelLabel ?? 'image model';
  const artefactIds = p.artefactIds ?? EMPTY_IDS;

  // Stable fallback: a fresh `= []` default per render would re-trigger the
  // URL effect (which sets state) every render — an update loop.
  const { data: artefacts = EMPTY_ARTEFACTS } = useQuery({
    queryKey: ['artefacts', 'image-pill', row.id, artefactIds],
    queryFn: async () => {
      const rows = await getClientDataDb().artefacts.bulkGet(artefactIds);
      // A deleted artefact comes back undefined and renders nothing.
      return rows.filter((r): r is ArtefactRow => r !== undefined);
    },
    enabled: artefactIds.length > 0,
    // Immutable rows — prevents a focus-refetch from revoking objectURLs under an open lightbox.
    staleTime: Number.POSITIVE_INFINITY,
  });

  // Object URLs for the loaded rows: thumbnail prefers thumbBlob, lightbox
  // prefers the full blob. Created INSIDE the effect (AttachmentThumb pattern)
  // so each effect run owns the URLs its own cleanup revokes — creating them
  // in render/useMemo let StrictMode's mount cycle (effect → cleanup → effect)
  // revoke them with no way to recreate, blanking the <img>s on any remount
  // that found the artefact query cache warm.
  const [urls, setUrls] = useState<Map<string, { thumb: string; full: string }>>(new Map());
  useEffect(() => {
    const m = new Map<string, { thumb: string; full: string }>();
    for (const a of artefacts) {
      const thumbBlob = a.thumbBlob ?? a.blob;
      const fullBlob = a.blob ?? a.thumbBlob;
      if (!thumbBlob || !fullBlob) continue;
      m.set(a.id, { thumb: URL.createObjectURL(thumbBlob), full: URL.createObjectURL(fullBlob) });
    }
    setUrls(m);
    return () => {
      for (const u of m.values()) {
        URL.revokeObjectURL(u.thumb);
        URL.revokeObjectURL(u.full);
      }
    };
  }, [artefacts]);

  const images = artefacts.filter((a) => urls.has(a.id));
  // Inline ViewableItems — deliberately NOT artefactToViewable: in the chat
  // stream generated images are read-only (no rename/delete/tags), and the
  // object URLs here are owned (and revoked) by this component.
  const lightboxItems: ViewableItem[] = images.map((a) => ({
    id: a.id,
    kind: 'image',
    fileName: a.fileName,
    title: a.title,
    mime: a.mime,
    imageUrl: urls.get(a.id)?.full,
    provenance: a.genMeta
      ? `${a.genMeta.prompt} — via ${a.genMeta.modelLabel}`
      : p.prompt !== undefined
        ? `${p.prompt} — via ${p.modelLabel ?? 'image model'}`
        : undefined,
    caps: {
      rename: false,
      remove: false,
      copy: false,
      download: true,
      delete: false,
      editSource: false,
      editTags: false,
    },
  }));

  if (row.status === 'pending') {
    const count = countOf(p);
    return (
      <span className="artefact-pill" data-state="building">
        <span className="artefact-pill-ic" aria-hidden>
          ▢
        </span>
        <span className="artefact-pill-ttl">
          {count > 1 ? `Painting ${count} images` : 'Painting'}
        </span>
        <span className="artefact-pill-sub">{model}</span>
        <span className="artefact-pill-bar">
          <i />
        </span>
      </span>
    );
  }

  if (row.status === 'failed') {
    return (
      <span className="pill-wrap">
        <button
          type="button"
          className="pill"
          data-pill-kind="tool-call"
          data-pill-status="failed"
          data-pill-expandable
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="pill-icon" aria-hidden>
            ▢
          </span>
          Couldn't paint
        </button>
        {expanded && p.error ? (
          <span className="pill-detail">
            <code className="pill-detail-error">{p.error}</code>
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span className="pill-wrap">
      <button
        type="button"
        className="pill"
        data-pill-kind="tool-call"
        data-pill-status="completed"
        data-pill-expandable
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="pill-icon" aria-hidden>
          ▢
        </span>
        Painted · {model}
      </button>
      {expanded ? (
        <span className="pill-detail">
          {p.prompt !== undefined && (
            <>
              <code className="pill-detail-code">{p.prompt}</code>
              <CopyButton text={p.prompt} />
            </>
          )}
          <span className="pill-detail-lore-note">via {model}</span>
          {(p.moderatedReasons ?? []).map((reason) => (
            <span key={reason} className="pill-detail-lore-note">
              moderated · {reason}
            </span>
          ))}
        </span>
      ) : null}
      {images.length > 0 ? (
        <span className="image-pill-grid">
          {images.map((a, i) => (
            <button
              key={a.id}
              type="button"
              data-attachment-thumb={a.id}
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex(i);
              }}
            >
              <img className="image-pill-thumb" src={urls.get(a.id)?.thumb} alt={a.title} />
            </button>
          ))}
        </span>
      ) : null}
      {lightboxIndex !== null && (
        <Lightbox
          items={lightboxItems}
          index={lightboxIndex}
          getOriginRect={(id) =>
            document
              .querySelector<HTMLElement>(`[data-attachment-thumb="${CSS.escape(id)}"]`)
              ?.getBoundingClientRect() ?? null
          }
          onRename={() => {}}
          onRemove={() => {}}
          onEditText={() => {}}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </span>
  );
}
