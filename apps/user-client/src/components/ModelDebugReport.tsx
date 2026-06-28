// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import { type DiagnosticReport, formatReport } from '../lib/model-debug.js';

interface Props {
  report: DiagnosticReport;
}

/**
 * Screenshot-friendly, copyable diagnostic report. Opens with a warm line so a
 * failure reads as the user helping, and closes the loop with a "what next"
 * line under the copy button.
 */
export function ModelDebugReport({ report }: Props): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const text = formatReport(report);

  // This block renders inside overlays, so the "Copied ✓" reset timer must be
  // cancellable to avoid a setState after unmount.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  async function copy(): Promise<void> {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-paper-soft">
        Thanks for this — copy it and paste it into your reply to us; it tells us exactly what your
        device saw.
      </p>
      <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-md border border-paper-soft/30 bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-paper">
        {text}
      </pre>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => void copy()}
          className="self-start rounded-md bg-paper px-3 py-2 text-xs uppercase tracking-wider text-ink hover:bg-paper-soft"
        >
          <span aria-live="polite">{copied ? 'Copied ✓' : 'Copy report'}</span>
        </button>
        {copyFailed ? (
          <p className="text-xs text-paper-soft/80">
            Couldn&apos;t copy automatically — select the text above and copy it.
          </p>
        ) : (
          <p className="text-xs text-paper-soft/80">Paste this into your reply to us.</p>
        )}
      </div>
    </div>
  );
}
