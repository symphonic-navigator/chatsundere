// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react';

interface Props {
  onCancel: () => void;
  onDelete: () => void;
}

/** Inline confirm-tray used by HistoryRow when the user taps the delete glyph. */
export function HistoryRowConfirmTray({ onCancel, onDelete }: Props): JSX.Element {
  useEffect(() => {
    const t = setTimeout(onCancel, 6000);
    return () => clearTimeout(t);
  }, [onCancel]);

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-danger/40 bg-danger/[0.06] px-3 py-2">
      <span className="text-xs uppercase tracking-wider text-paper-soft">Delete this chat?</span>
      <div className="flex gap-2">
        <button
          type="button"
          data-cancel
          onClick={onCancel}
          className="rounded-md border border-paper-soft/30 px-3 py-1 text-xs uppercase tracking-wider text-paper"
        >
          Cancel
        </button>
        <button
          type="button"
          data-confirm
          onClick={onDelete}
          className="rounded-md border border-danger px-3 py-1 text-xs uppercase tracking-wider text-danger"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
