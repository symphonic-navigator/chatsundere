// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import type { PillRow } from '../../boot/client-data-db.js';

interface VisionPayload {
  model?: string;
  fileName?: string;
  result?: string;
  error?: string;
}

/** Pill for a substitute-vision describe: live "reading image" while pending,
 *  expandable to the description + model when done. One per substituted image. */
export function VisionPill({ row }: { row: PillRow }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const p = (row.payload ?? {}) as VisionPayload;
  const name = p.fileName ?? 'image';
  const model = p.model ?? 'vision model';

  if (row.status === 'pending') {
    return (
      <span className="artefact-pill" data-state="building">
        <span className="artefact-pill-ic" aria-hidden>
          ▢
        </span>
        <span className="artefact-pill-ttl">Reading image</span>
        <span className="artefact-pill-sub">{name}</span>
        <span className="artefact-pill-bar">
          <i />
        </span>
      </span>
    );
  }

  if (row.status === 'failed') {
    return (
      <span className="artefact-pill" data-state="tombstone" aria-disabled>
        <span className="artefact-pill-ic" aria-hidden>
          ▢
        </span>
        <span className="artefact-pill-ttl">Couldn't read image</span>
        <span className="artefact-pill-sub">{name}</span>
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
        Read image · {name}
      </button>
      {expanded ? (
        <span className="pill-detail">
          {p.result !== undefined && <code className="pill-detail-result">{p.result}</code>}
          <span className="pill-detail-lore-note">via {model}</span>
        </span>
      ) : null}
    </span>
  );
}
