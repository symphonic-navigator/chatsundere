// SPDX-License-Identifier: AGPL-3.0-only

interface Props {
  onCancel: () => void;
  onSave: () => void;
  saveDisabled?: boolean;
  saveTooltip?: string;
}

export function SaveBar({ onCancel, onSave, saveDisabled, saveTooltip }: Props): JSX.Element {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-2 border-t border-white/5 bg-bg/95 px-4 py-3 backdrop-blur">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md border border-paper-soft/30 px-4 py-2 text-xs uppercase tracking-wider text-paper-soft hover:text-paper"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saveDisabled}
        title={saveDisabled ? saveTooltip : undefined}
        className="rounded-md border border-paper bg-paper/10 px-6 py-2 text-xs uppercase tracking-wider text-paper hover:bg-paper/20 disabled:opacity-40"
      >
        Save Persona
      </button>
    </div>
  );
}
