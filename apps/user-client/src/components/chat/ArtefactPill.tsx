// SPDX-License-Identifier: AGPL-3.0-only
import type { PillRow } from '../../boot/client-data-db.js';
import { useArtefact } from '../../data/artefacts.js';
import { useCurrentChatStore } from '../../state/current-chat.store.js';

interface ArtefactPayload {
  name?: string;
  title?: string;
  argumentsJson?: string;
  artefactId?: string;
  charCount?: number;
  format?: string;
  phase?: string;
  error?: string;
}

type ArtefactToolName = 'create_artefact' | 'modify_artefact' | 'inspect_artefact';

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

function toolNameOf(p: ArtefactPayload): ArtefactToolName {
  if (p.name === 'modify_artefact' || p.name === 'inspect_artefact') return p.name;
  return 'create_artefact';
}

/** Format badge label: payload → row → default HTML. */
function formatBadge(payloadFormat: string | undefined, rowFormat: string | undefined): string {
  const raw = payloadFormat ?? rowFormat;
  if (raw === 'markdown') return 'MD';
  if (raw === 'html') return 'HTML';
  return 'HTML';
}

function pendingSubtitle(tool: ArtefactToolName, p: ArtefactPayload): string {
  const phase = p.phase;
  const chars = (p.charCount ?? 0).toLocaleString();

  if (tool === 'create_artefact') {
    return `building · ${chars} chars`;
  }

  if (tool === 'modify_artefact') {
    if (phase === 'reading') return 'reading';
    if (phase === 'writing') return `writing · ${chars} chars`;
    if (phase && phase !== 'starting' && phase !== 'done' && phase !== 'building') {
      return phase;
    }
    return 'working…';
  }

  // inspect_artefact
  if (phase === 'explaining') return 'explaining';
  if (phase === 'reading') return 'reading';
  return 'inspecting…';
}

function readySubtitle(tool: ArtefactToolName): string {
  if (tool === 'modify_artefact') return 'updated · tap to open ↗';
  if (tool === 'inspect_artefact') return 'explained · tap to open ↗';
  return 'tap to open ↗';
}

/** Variant-C pill for create / modify / inspect artefact tool-calls. */
export function ArtefactPill({ row }: { row: PillRow }): JSX.Element {
  const p = (row.payload ?? {}) as ArtefactPayload;
  const openArtefact = useCurrentChatStore((s) => s.openArtefact);
  const artefactId = p.artefactId ?? null;
  // Only query existence once we have an id (completed).
  const { data: artefact, isFetched } = useArtefact(artefactId);
  const title = titleOf(p);
  const tool = toolNameOf(p);
  const badge = formatBadge(p.format, artefact?.format);
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
        <span className="artefact-pill-badge">{badge}</span>
        <span className="artefact-pill-sub">{pendingSubtitle(tool, p)}</span>
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
      <span className="artefact-pill-badge">{badge}</span>
      <span className="artefact-pill-sub">{readySubtitle(tool)}</span>
    </button>
  );
}
