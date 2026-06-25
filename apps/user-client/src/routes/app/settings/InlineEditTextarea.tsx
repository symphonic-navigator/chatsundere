// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useId, useRef, useState } from 'react';

export interface InlineEditTextareaProps {
  label: string;
  value: string;
  placeholder?: string;
  /** Sub-label helper copy under the field. */
  helper?: string;
  minRows?: number;
  /** Persist the new value; throw to signal a failed save (value + focus kept). */
  onSave: (next: string) => Promise<void>;
}

/**
 * Multi-line always-save field (spec §3): persists on blur (Enter inserts a
 * newline, so blur is the commit), with a transient polite-live-region
 * "Saved ✓". Mirrors `InlineEditRow`'s de-dupe and external-resync discipline.
 * Leaving the page blurs the field first, so the dispatched save survives
 * unmount (spec §3 blur-flush, Laura SOFT-4).
 */
export function InlineEditTextarea({
  label,
  value,
  placeholder,
  helper,
  minRows = 4,
  onSave,
}: InlineEditTextareaProps): JSX.Element {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const savingRef = useRef(false);
  const focusedRef = useRef(false);
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // Re-sync the draft on external change, but never while the user is editing.
  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  const commit = async (): Promise<void> => {
    if (savingRef.current) return;
    if (draft === valueRef.current) return;
    savingRef.current = true;
    setError(null);
    try {
      await onSave(draft);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch {
      setError('Could not save. Please try again.');
    } finally {
      savingRef.current = false;
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs uppercase tracking-wider text-paper-soft">
        {label}
      </label>
      <textarea
        id={id}
        aria-label={label}
        rows={minRows}
        className="resize-y rounded-lg border border-paper-soft/15 bg-white/5 px-3 py-2 text-paper"
        value={draft}
        placeholder={placeholder}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          focusedRef.current = false;
          void commit();
        }}
      />
      {helper ? <p className="text-[11px] text-paper-soft">{helper}</p> : null}
      <div aria-live="polite" className="min-h-[1rem] text-xs">
        {error ? <span style={{ color: 'var(--color-destructive-text)' }}>{error}</span> : null}
        {saved ? <span style={{ color: 'var(--color-nav-green-icon)' }}>Saved ✓</span> : null}
      </div>
    </div>
  );
}
