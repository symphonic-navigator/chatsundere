// SPDX-License-Identifier: AGPL-3.0-only
import type { JSX } from 'react';

/** Blocking overlay shown while the Layer-3 synchronous block-and-compact path
 *  is in progress. The breathing pulse is the no-freeze guarantee: the user
 *  always sees live motion, never a frozen label. Styling is minimal-functional
 *  — the design-language pass refines it later. */
export function CompactingOverlay(): JSX.Element {
  return (
    <div className="compacting-overlay">
      <output
        className="compacting-overlay-card"
        aria-live="polite"
        aria-label="Compacting the conversation"
      >
        <span className="compacting-overlay-pulse" aria-hidden="true" />
        <span>Compacting the conversation…</span>
      </output>
    </div>
  );
}
