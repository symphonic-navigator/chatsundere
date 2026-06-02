// SPDX-License-Identifier: AGPL-3.0-only
import { type ChangeEvent, type RefObject, useState } from 'react';
import { scorePassphrase } from '../lib/validators.js';

export interface PassphraseFieldProps {
  id: string;
  label: string;
  value: string;
  onChange(v: string): void;
  /** Show the inline strength metre below the field. */
  meter?: boolean;
  autoComplete?: 'new-password' | 'current-password';
  /** Forwarded to the underlying input so callers can focus it imperatively
   *  (e.g. the login screen claims focus once the cold-start intro finishes). */
  inputRef?: RefObject<HTMLInputElement>;
}

const scoreColour: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'text-danger',
  1: 'text-warning',
  2: 'text-paper-soft',
  3: 'text-success',
  4: 'text-success',
};

/** Password input with show/hide toggle and an optional informational strength metre. */
export function PassphraseField({
  id,
  label,
  value,
  onChange,
  meter = false,
  autoComplete = 'new-password',
  inputRef,
}: PassphraseFieldProps) {
  const [shown, setShown] = useState(false);
  const strength = meter && value.length > 0 ? scorePassphrase(value) : null;

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm text-paper-soft">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          id={id}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          className="w-full rounded-[var(--radius-card)] bg-ink-soft px-4 py-3 font-mono text-base text-paper outline-none ring-1 ring-inset ring-aurora-700/40 focus:ring-aurora-500"
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          className="shrink-0 font-mono text-xs uppercase tracking-wider text-paper-soft hover:text-paper"
          aria-label={shown ? 'Hide passphrase' : 'Show passphrase'}
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
      {strength !== null && (
        <p className={`text-xs ${scoreColour[strength.score]}`} aria-live="polite">
          {strength.hint}
        </p>
      )}
    </div>
  );
}
