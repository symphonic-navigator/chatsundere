// SPDX-License-Identifier: AGPL-3.0-only
import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../ui/Button.js';

export interface DecryptPromptOverlayProps {
  onSubmit: (password: string) => void;
  onCancel: () => void;
  /** Non-null after a failed attempt; the typed password is preserved. */
  error: string | null;
  busy: boolean;
}

/** Password prompt shown when importing an encrypted transfer pack. */
export function DecryptPromptOverlay({
  onSubmit,
  onCancel,
  error,
  busy,
}: DecryptPromptOverlayProps): JSX.Element {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  // Extracted so the outer div fits on one line; the lint suppression below
  // must be on the line immediately preceding the opening tag.
  const dialogLabel = 'Enter export password';

  return (
    // biome-ignore lint/a11y/useSemanticElements: fixed stacking layer that drives the zoom animation; <dialog> requires showModal()
    <div className="cs-dialog-root" role="dialog" aria-modal="true" aria-label={dialogLabel}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop tap maps to cancel; Escape handled on document */}
      <div className="cs-dialog-backdrop" onClick={onCancel} aria-hidden="true" />
      <div className="cs-dialog-card cs-zoom-in">
        <div className="cs-dialog-title">This export is encrypted</div>
        <p className="mb-3 mt-1 text-[11px] text-paper-soft">
          Enter the password it was exported with.
        </p>
        <div className="relative">
          <input
            aria-label="Password"
            type={show ? 'text' : 'password'}
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full rounded-md border border-paper-soft/30 bg-transparent px-3 py-1.5 pr-9 text-sm text-paper"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
            aria-pressed={show}
            className="absolute inset-y-0 right-2 flex items-center text-paper-soft hover:text-paper"
          >
            {show ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          </button>
        </div>
        {error ? <p className="mt-2 text-[11px] text-amber-300/80">{error}</p> : null}
        <div className="cs-dialog-actions">
          <Button tone="neutral" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            tone="primary"
            priority
            disabled={busy || password.length === 0}
            onClick={() => onSubmit(password)}
          >
            Unlock
          </Button>
        </div>
      </div>
    </div>
  );
}
