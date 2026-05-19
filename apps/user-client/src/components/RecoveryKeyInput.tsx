// SPDX-License-Identifier: AGPL-3.0-only
import { type ChangeEvent, useId } from 'react';
import { copy } from '../lib/copy.js';

export interface RecoveryKeyInputProps {
  /** The normalised (uppercase, no separators) key value. */
  value: string;
  onChange(normalised: string): void;
  disabled?: boolean;
}

/**
 * Paste-friendly input for the Crockford base32 recovery key.
 *
 * Normalisation on every change:
 *   - Strip all whitespace and dash characters.
 *   - Uppercase the result.
 *
 * Display formatting:
 *   - Re-groups the normalised string into 4-character blocks separated by
 *     dashes (e.g. "ABCD-1234-EFGH-5678-…").
 *   - The displayed value is derived purely from `value`; the controlled input
 *     always reflects the latest normalised string so paste-then-clear works.
 */
export function RecoveryKeyInput({ value, onChange, disabled = false }: RecoveryKeyInputProps) {
  const inputId = useId();

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    // Strip dashes and spaces, uppercase — this is the canonical internal form.
    const normalised = raw.toUpperCase().replace(/[\s-]+/g, '');
    onChange(normalised);
  }

  // Format the internal value for display: 4-char groups joined by dashes.
  const displayValue = value.match(/.{1,4}/g)?.join('-') ?? value;

  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-sm text-paper-soft">
        {copy.recovery.recoveryKeyLabel}
      </label>
      <input
        id={inputId}
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        disabled={disabled}
        value={displayValue}
        onChange={handleChange}
        placeholder="XXXX-XXXX-XXXX-XXXX"
        className="w-full rounded-[var(--radius-card)] bg-ink-soft px-4 py-3 font-mono text-base tracking-[0.12em] text-paper outline-none ring-1 ring-inset ring-aurora-700/40 focus:ring-aurora-500 disabled:opacity-50"
      />
    </div>
  );
}
