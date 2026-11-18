// SPDX-License-Identifier: AGPL-3.0-only

export interface SwitchProps {
  /** Current state. */
  checked: boolean;
  /** Called with the requested next state; never fires while disabled. */
  onChange: (next: boolean) => void;
  /**
   * Id of the button. Point the row's visible `<label htmlFor>` at it so that
   * tapping the label toggles too.
   */
  id?: string;
  /** Accessible name when no visible label element names the switch. */
  ariaLabel?: string;
  /** Id of an existing visible element that names the switch. */
  labelledBy?: string;
  disabled?: boolean;
  /** Tooltip, typically the reason the switch is disabled. */
  title?: string;
  /** Extra classes for the track, e.g. a call site's disabled styling. */
  className?: string;
}

/**
 * On/off toggle with the 24 × 48 track look, carrying `.cs-hit` so the
 * touch target reaches 44 × 44 without growing the visible control.
 */
export function Switch({
  checked,
  onChange,
  id,
  ariaLabel,
  labelledBy,
  disabled,
  title,
  className,
}: SwitchProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      disabled={disabled}
      title={title}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={`cs-hit h-6 w-12 shrink-0 rounded-full border ${
        checked ? 'border-paper bg-paper/30' : 'border-paper-soft/30 bg-white/5'
      }${className ? ` ${className}` : ''}`}
    >
      <span
        className={`block h-5 w-5 rounded-full bg-paper transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-0'
        }`}
      />
    </button>
  );
}
