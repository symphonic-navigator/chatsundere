// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useId, useState } from 'react';
import { Button } from '../../../components/ui/Button.js';
import { type InvalidPathReason, isProjectFsError } from '../../../projects/errors.js';
import { withMarkdownExtension } from '../../../projects/path.js';

const REASON_COPY: Record<InvalidPathReason, string> = {
  extension: 'Projects hold Markdown files (.md) for now.',
  'into-self': "A folder can't be moved into itself.",
  'too-long': 'That path is too long.',
  'not-absolute': 'Paths start with "/", e.g. /notes/plan.md.',
  'control-character': 'That path contains characters that cannot be used.',
  root: 'Choose a path inside the project.',
};

/** Quota copy shared by every project surface (spec §6.4). */
export const QUOTA_COPY =
  'This device is out of space for projects — export a project to keep a copy, then free some space.';

/** Plain-words text for a project filesystem error, or null when `e` is not one. */
export function describeProjectError(e: unknown): string | null {
  if (!isProjectFsError(e)) return null;
  switch (e.code) {
    case 'InvalidPath':
      return e.detail.reason ? REASON_COPY[e.detail.reason] : 'That path cannot be used.';
    case 'AlreadyExists':
      return 'A file already exists at that path.';
    case 'EscapesRoot':
      return 'That path leaves the project.';
    case 'IsDirectory':
      return 'That path is a folder.';
    case 'NotDirectory':
      return 'Part of that path is a file, not a folder.';
    case 'NotFound':
      return 'That no longer exists.';
    case 'VersionConflict':
      return 'This file changed elsewhere.';
    case 'QuotaExceeded':
      return QUOTA_COPY;
  }
}

export interface PathDialogProps {
  title: string;
  initial: string;
  placeholder?: string;
  confirmLabel: string;
  /** Receives the normalised path; a thrown error is shown inline and the dialog stays open. */
  onSubmit: (path: string) => Promise<void>;
  onClose: () => void;
  /** Canonicalises the typed path before `onSubmit`; defaults to {@link withMarkdownExtension}. */
  normalise?: (input: string) => string;
}

/**
 * Path prompt for project files (spec §6.3): normalises the input, appending
 * `.md` where the name has no extension, and shows any failure in plain words
 * while keeping the dialog open with the input intact.
 */
export function PathDialog({
  title,
  initial,
  placeholder,
  confirmLabel,
  onSubmit,
  onClose,
  normalise = withMarkdownExtension,
}: PathDialogProps): JSX.Element {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  async function submit(): Promise<void> {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await onSubmit(normalise(value));
    } catch (e) {
      const text = describeProjectError(e);
      if (text === null) console.warn('Project path action failed', e);
      setError(text ?? 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: fixed stacking layer that drives the zoom animation; <dialog> requires showModal()
    <div className="cs-dialog-root" role="dialog" aria-modal="true" aria-label={title}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop tap maps to cancel; Escape handled on document */}
      <div className="cs-dialog-backdrop" onClick={onClose} aria-hidden="true" />
      <form
        className="cs-dialog-card cs-zoom-in"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="cs-dialog-title" htmlFor={inputId}>
          {title}
        </label>
        <input
          id={inputId}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          className="mt-2 w-full rounded-md border border-paper-soft/30 bg-transparent px-3 py-1.5 text-sm text-paper"
        />
        {error ? (
          <p role="alert" className="mt-2 text-[11px] text-amber-300/80">
            {error}
          </p>
        ) : null}
        <div className="cs-dialog-actions">
          <Button tone="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button tone="primary" priority type="submit" disabled={busy || value.trim() === ''}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </div>
  );
}
