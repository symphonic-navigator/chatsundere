// SPDX-License-Identifier: AGPL-3.0-only

interface Props {
  title: string;
  isDirty: boolean;
  onBack: () => void;
  onSaveAndBack: () => void;
  saveDisabled?: boolean;
  saveTooltip?: string;
  hideSaveAndBack?: boolean;
}

/**
 * Topbar shared between the Persona Editor and My Settings. Three slots:
 *  - back button (left): discards in-flight edits; if `isDirty`, asks
 *    the user to confirm via window.confirm before invoking onBack.
 *  - title (centre): static text label.
 *  - "Save & Back" pill (right): explicit save-then-navigate, mirror
 *    of the bottom SaveBar's "save + stay" path.
 */
export function EditorTopbar({
  title,
  isDirty,
  onBack,
  onSaveAndBack,
  saveDisabled = false,
  saveTooltip,
  hideSaveAndBack = false,
}: Props): JSX.Element {
  function handleBack() {
    if (isDirty) {
      const ok = window.confirm('Discard your unsaved changes?');
      if (!ok) return;
    }
    onBack();
  }

  return (
    <header className="flex items-center justify-between gap-3 pb-2">
      <button
        type="button"
        aria-label="Back"
        onClick={handleBack}
        className="grid h-10 w-10 place-items-center rounded-md text-2xl leading-none text-paper-soft hover:bg-white/5 hover:text-paper"
      >
        ←
      </button>
      <div className="min-w-0 flex-1 truncate text-center font-display text-sm text-paper">
        {title}
      </div>
      {hideSaveAndBack ? (
        <span className="w-[88px]" aria-hidden />
      ) : (
        <button
          type="button"
          onClick={onSaveAndBack}
          disabled={saveDisabled}
          title={saveDisabled ? saveTooltip : undefined}
          className="rounded-md border border-paper px-3 py-1.5 text-xs uppercase tracking-wider text-paper hover:bg-paper/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save &amp; Back
        </button>
      )}
    </header>
  );
}
