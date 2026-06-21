// SPDX-License-Identifier: AGPL-3.0-only
import type { JSX } from 'react';

/** Minimal confirm card for manual compaction. Keeps the reassurance line and
 *  two buttons. Styling comes in the design-language pass; structure is
 *  minimal-functional. */
export function CompactConfirmCard(p: {
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <dialog className="compact-confirm-card" aria-label="Compact conversation" open>
      <p>
        Compact this conversation to keep it going? Your full conversation stays in Reading Mode.
      </p>
      <div className="compact-confirm-actions">
        <button type="button" onClick={p.onCancel} disabled={p.busy}>
          Cancel
        </button>
        <button type="button" onClick={p.onConfirm} disabled={p.busy}>
          {p.busy ? 'Compacting…' : 'Compact'}
        </button>
      </div>
    </dialog>
  );
}
