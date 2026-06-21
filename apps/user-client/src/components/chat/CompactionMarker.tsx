// SPDX-License-Identifier: AGPL-3.0-only
import { type JSX, useState } from 'react';
import type { CompactionCheckpointRow } from '../../boot/client-data-db.js';
import { CompactionDrawer } from './CompactionDrawer.js';

/** Formats a raw token count as a compact string: ≥1000 → Nk, otherwise as-is. */
const k = (n: number): string => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);

/**
 * Tappable pill rendered at a compaction boundary in the message stream.
 * Mirrors the affordance attributes of `Pill.tsx` (`data-pill-expandable`,
 * `aria-expanded`, the `pill` class) so it reads as consistent with other
 * inline pills. Tapping opens the read-only `CompactionDrawer` below it.
 */
export function CompactionMarker({
  checkpoint,
}: { checkpoint: CompactionCheckpointRow }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <span className="pill-wrap compaction-marker-wrap">
      <button
        type="button"
        className="pill compaction-marker"
        data-pill-expandable
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ✨ Compacted · {k(checkpoint.tokensBefore)} → {k(checkpoint.tokensAfter)} tokens
        <span className="compaction-marker-chevron" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open ? <CompactionDrawer checkpoint={checkpoint} /> : null}
    </span>
  );
}
