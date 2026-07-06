// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useId, useRef, useState } from 'react';

export interface InlineEditRowProps {
  label: string;
  value: string;
  /** Shown when the field is empty (e.g. the username for an empty display name). */
  placeholder?: string;
  /** Return an error message to block the save, or null when the value is valid. */
  validate?: (next: string) => string | null;
  /** Persist the new value; throw to signal a failed save (value + focus kept). */
  onSave: (next: string) => Promise<void>;
}

/**
 * A save-as-you-go field (spec §2.3): persists on blur AND Enter, shows a
 * transient polite-live-region "Saved ✓", and — for validated fields — blocks
 * the save on invalid input, keeping the value and focus with an inline error.
 * Blur and Enter de-dupe to a single persist + single announcement.
 */
export function InlineEditRow({
  label,
  value,
  placeholder,
  validate,
  onSave,
}: InlineEditRowProps): JSX.Element {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const savingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Always reflects the latest `value` prop so the commit no-op guard is
  // closure-safe against a prop change while the component is mounted.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // Re-sync draft when the external value changes (e.g. async settings load,
  // post-save query refresh) — but never while the user is actively editing,
  // which would clobber an in-progress typed draft.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(value);
  }, [value]);

  const commit = async (): Promise<void> => {
    if (savingRef.current) return; // de-dupe blur+Enter
    if (draft === valueRef.current) return;
    const err = validate?.(draft) ?? null;
    if (err) {
      setError(err);
      return;
    }
    savingRef.current = true;
    setError(null);
    try {
      await onSave(draft);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      // Surface the thrown message so callers can give a constructive, specific
      // reason (e.g. "already taken on this server"); fall back to the generic
      // line when no message is carried.
      setError(e instanceof Error && e.message ? e.message : 'Could not save. Please try again.');
    } finally {
      savingRef.current = false;
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs uppercase tracking-wider text-paper-soft">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        className="rounded-lg border border-paper-soft/15 bg-white/5 px-3 py-2 text-paper"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError(null);
        }}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
      />
      <div aria-live="polite" className="min-h-[1rem] text-xs">
        {error ? <span style={{ color: 'var(--color-destructive-text)' }}>{error}</span> : null}
        {saved ? <span style={{ color: 'var(--color-nav-green-icon)' }}>Saved ✓</span> : null}
      </div>
    </div>
  );
}
