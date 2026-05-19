// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { copy } from '../lib/copy.js';

export interface RecoveryKeyRevealProps {
  /** The encoded recovery key string (Crockford base32 with dashes). */
  value: string;
}

/**
 * Renders the recovery key in a selectable monospace block with a copy-to-clipboard button.
 * Presentational only — the confirm-stored gate lives in the wizard step.
 */
export function RecoveryKeyReveal({ value }: RecoveryKeyRevealProps) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setCopyFailed(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Permission denied, insecure context, or unsupported API — fall back
      // to "select manually" so the user is never left silent.
      setCopyFailed(true);
      setCopied(false);
    }
  }

  // Split on existing dashes so callers can pass pre-formatted strings.
  const groups = value.split('-');

  return (
    <div className="space-y-3">
      <pre
        className="select-all whitespace-pre-wrap break-all rounded-[var(--radius-card)] bg-ink-soft p-5 font-mono text-base leading-[1.8] tracking-[0.15em] text-paper ring-1 ring-inset ring-aurora-700/40 lg:text-lg"
        style={{ animation: 'recovery-reveal 400ms ease-out both' }}
        aria-label="Recovery key"
      >
        {groups.join('-')}
      </pre>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="font-mono text-xs uppercase tracking-wider text-paper-soft hover:text-paper"
      >
        {copied ? copy.create.recoveryStep.copiedLabel : copy.create.recoveryStep.copyLabel}
      </button>
      {copyFailed && (
        <p className="text-xs text-warning" aria-live="polite">
          {copy.errors.copyFailed}
        </p>
      )}
    </div>
  );
}
