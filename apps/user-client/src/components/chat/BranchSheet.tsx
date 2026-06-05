// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

interface Props {
  /** Receives the trimmed, non-empty branch name. */
  onConfirm: (name: string) => void;
  onClose: () => void;
  /** Shown when a branch attempt failed; the typed name is preserved. */
  error?: string;
}

/** Bottom-sheet that collects a mandatory name for a forked chat session. */
export function BranchSheet(p: Props): JSX.Element {
  const [value, setValue] = useState('');
  const trimmed = value.trim();
  const canConfirm = trimmed !== '';

  const confirm = (): void => {
    if (canConfirm) p.onConfirm(trimmed);
  };

  return (
    <div className="branch-sheet-root">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is a dismiss surface; Cancel is the keyboard path */}
      <div className="branch-backdrop" data-testid="branch-backdrop" onClick={p.onClose} />
      <aside className="branch-sheet" aria-label="Branch this chat">
        <header className="branch-sheet-header">
          <span className="branch-sheet-title">Branch this chat</span>
        </header>
        <input
          className="branch-sheet-input"
          aria-label="Branch name"
          // biome-ignore lint/a11y/noAutofocus: naming the branch is the sole intent of this sheet
          autoFocus
          value={value}
          maxLength={80}
          placeholder="Name your branch"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') confirm();
            else if (e.key === 'Escape') p.onClose();
          }}
        />
        {p.error ? (
          <p className="branch-sheet-error" role="alert">
            {p.error}
          </p>
        ) : null}
        <div className="branch-sheet-actions">
          <button type="button" className="branch-cancel" onClick={p.onClose}>
            Cancel
          </button>
          <button type="button" className="branch-confirm" disabled={!canConfirm} onClick={confirm}>
            Branch
          </button>
        </div>
      </aside>
    </div>
  );
}
