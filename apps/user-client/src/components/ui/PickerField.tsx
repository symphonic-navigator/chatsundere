// SPDX-License-Identifier: AGPL-3.0-only
import { useRef } from 'react';

export interface PickerFieldProps {
  label: string;
  value: React.ReactNode;
  stale?: { reason: React.ReactNode };
  disabled?: boolean;
  disabledReason?: string;
  onOpen: (trigger: HTMLElement) => void;
}

/**
 * The generic picker trigger (spec §6): a labelled row showing the current value
 * that opens its overlay on tap, passing itself as the zoom origin. Carries a
 * constructive stale state (names the fix, never a dead blank) and a
 * disabled-with-reason mode (disabled-over-hidden). Overlay-agnostic — the parent
 * wires `onOpen` to the right overlay.
 */
export function PickerField({
  label,
  value,
  stale,
  disabled,
  disabledReason,
  onOpen,
}: PickerFieldProps): JSX.Element {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      data-stale={stale ? 'true' : undefined}
      className="cs-picker-field"
      onClick={() => {
        if (!disabled && ref.current) onOpen(ref.current);
      }}
    >
      <span className="cs-picker-field-label">{label}</span>
      <span className="cs-picker-field-value">
        {stale ? <span className="cs-picker-field-stale">{stale.reason}</span> : value}
      </span>
      <span aria-hidden className="cs-picker-field-chevron">
        ›
      </span>
    </button>
  );
}
