// SPDX-License-Identifier: AGPL-3.0-only
import type { PillRow } from '../../boot/client-data-db.js';
import { useArtefact } from '../../data/artefacts.js';
import { useCurrentChatStore } from '../../state/current-chat.store.js';

interface ArtefactPayload {
  title?: string;
  argumentsJson?: string;
  artefactId?: string;
  charCount?: number;
  error?: string;
}

function titleOf(p: ArtefactPayload): string {
  if (p.title) return p.title;
  if (p.argumentsJson) {
    try {
      const a = JSON.parse(p.argumentsJson) as { title?: string };
      if (typeof a.title === 'string') return a.title;
    } catch {
      /* ignore */
    }
  }
  return 'Artefact';
}

/** Variant-C pill for create_artefact tool-calls: building / ready / tombstone. */
export function ArtefactPill({ row }: { row: PillRow }): JSX.Element {
  const p = (row.payload ?? {}) as ArtefactPayload;
  const openArtefact = useCurrentChatStore((s) => s.openArtefact);
  const artefactId = p.artefactId ?? null;
  // Only query existence once we have an id (completed).
  const { data: artefact, isFetched } = useArtefact(artefactId);
  const title = titleOf(p);
  const building = row.status === 'pending';
  const failed = row.status === 'failed';
  const missing = artefactId !== null && isFetched && artefact === undefined;

  if (building) {
    return (
      <span className="artefact-pill" data-state="building">
        <span className="artefact-pill-ic" aria-hidden>
          ⬡
        </span>
        <span className="artefact-pill-ttl">{title}</span>
        <span className="artefact-pill-badge">HTML</span>
        <span className="artefact-pill-sub">
          building · {(p.charCount ?? 0).toLocaleString()} chars
        </span>
        <span className="artefact-pill-bar">
          <i />
        </span>
      </span>
    );
  }
  if (failed || missing || artefactId === null) {
    return (
      <span className="artefact-pill" data-state="tombstone" aria-disabled>
        <span className="artefact-pill-ic" aria-hidden>
          ⬡
        </span>
        <span className="artefact-pill-ttl">{title}</span>
        <span className="artefact-pill-sub">{failed ? 'failed' : 'artefact deleted'}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      className="artefact-pill"
      data-state="ready"
      data-artefact-pill={artefactId}
      onClick={() => openArtefact(artefactId)}
    >
      <span className="artefact-pill-ic" aria-hidden>
        ⬡
      </span>
      <span className="artefact-pill-ttl">{title}</span>
      <span className="artefact-pill-badge">HTML</span>
      <span className="artefact-pill-sub">tap to open ↗</span>
    </button>
  );
}
