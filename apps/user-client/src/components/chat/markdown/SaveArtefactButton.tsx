// SPDX-License-Identifier: AGPL-3.0-only
import type { MouseEvent } from 'react';

/** "Save as artefact" button for a markdown code/Mermaid block. Positioning is
 *  owned by the parent toolbar; this is just the pill. Stops click propagation
 *  so saving never toggles the surrounding message bubble. Success feedback is
 *  the global toast fired by the save handler, not an inline state flip. */
export function SaveArtefactButton({ onSave }: { onSave: () => void }): JSX.Element {
  function handleClick(e: MouseEvent): void {
    e.stopPropagation();
    onSave();
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      className="rounded border border-white/10 bg-white/10 px-2 py-0.5 font-mono text-[11px] text-white/45 transition-colors hover:bg-white/15 hover:text-white/70"
    >
      Save
    </button>
  );
}
