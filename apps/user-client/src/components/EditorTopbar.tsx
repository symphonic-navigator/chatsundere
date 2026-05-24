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
 * Topbar shared between My Circle, the Persona Editor, My Settings, and
 * My Account. Three vertically-centred slots:
 *  - back button (left): generous 44×44 hit area with a hand-drawn SVG
 *    arrow at stroke 1.5 — sits visually balanced against the Lora title.
 *    Discards in-flight edits; if `isDirty`, confirms via window.confirm
 *    before invoking onBack.
 *  - title (centre): Lora (var(--font-display)) at text-lg / lg:text-xl,
 *    no gradient — same family as the brand wordmark but quieter, so
 *    page identity does not compete with the topbar logo.
 *  - "Save & Back" pill (right): explicit save-then-navigate. Pass
 *    `hideSaveAndBack` on read-only surfaces to swap the pill for a
 *    matched-width spacer so the title stays optically centred.
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
        className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-paper-soft transition hover:bg-white/5 hover:text-paper"
      >
        <BackArrow />
      </button>
      <h1 className="min-w-0 flex-1 truncate text-center font-display text-lg leading-none text-paper lg:text-xl">
        {title}
      </h1>
      {hideSaveAndBack ? (
        <span className="w-[88px] shrink-0" aria-hidden />
      ) : (
        <button
          type="button"
          onClick={onSaveAndBack}
          disabled={saveDisabled}
          title={saveDisabled ? saveTooltip : undefined}
          className="shrink-0 rounded-md border border-paper px-3 py-1.5 text-xs uppercase tracking-wider text-paper transition hover:bg-paper/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save &amp; Back
        </button>
      )}
    </header>
  );
}

/** Hand-drawn left arrow — stroke 1.5, rounded caps, matched to Lora's stroke feel. */
function BackArrow(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 12H5" />
      <path d="M11 18l-6-6 6-6" />
    </svg>
  );
}
