// SPDX-License-Identifier: AGPL-3.0-only
import type { Offering } from '@chatsundere/llm-unified';
import { useEffect, useState } from 'react';
import type { DiagnosticReport } from '../lib/model-debug.js';
import { ModelDebugReport } from './ModelDebugReport.js';
import { PickerOverlay } from './ui/PickerOverlay.js';

interface Props {
  open: boolean;
  providerDisplayName: string;
  offerings: Offering[];
  onClose: () => void;
  /**
   * Runs the test for one offering and returns the report. The provider page
   * supplies this (it resolves the decrypted key + proxy + a 60 s-timeout
   * AbortController); the overlay stays crypto-free and easily testable.
   */
  runTest: (offering: Offering) => Promise<DiagnosticReport>;
}

/** Overall test timeout (ms); the provider page arms an AbortController with this. */
export const MODEL_DEBUG_TIMEOUT_MS = 60_000;

/**
 * Provider-scoped model debugger: pick an LLM offering, run the real stream,
 * see and copy the report. Decryption and proxy resolution are injected via
 * `runTest` so this component is crypto-free and fully unit-testable.
 */
export function ModelDebugOverlay({
  open,
  providerDisplayName,
  offerings,
  onClose,
  runTest,
}: Props): JSX.Element {
  // `offerings` is always an array from a real ProviderDefinition, but guard
  // against a malformed/absent list so the overlay never crashes on mount.
  const llmOfferings = (offerings ?? []).filter((o) => o.serviceKind === 'llm');
  const [selected, setSelected] = useState<Offering | null>(null);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reopening after a failed test must start clean — never show a stale report
  // or error without a fresh run.
  useEffect(() => {
    if (!open) {
      setSelected(null);
      setReport(null);
      setError(null);
    }
  }, [open]);

  async function run(): Promise<void> {
    if (!selected) return;
    setRunning(true);
    setReport(null);
    setError(null);
    try {
      setReport(await runTest(selected));
    } catch (err) {
      // runTest can reject before the real stream begins (decryption, a bad
      // endpoint URL); surface it so the diagnostic tool never dead-ends.
      setError(err instanceof Error ? err.message : 'Unexpected error — check the console.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <PickerOverlay open={open} title={`Test a model · ${providerDisplayName}`} onClose={onClose}>
      <div className="flex flex-col gap-4 p-4">
        <p className="text-xs text-paper-soft">
          Pick a model and run a real streaming test. If it fails, copy the report and send it to
          us.
        </p>
        <ul className="flex flex-col gap-1" aria-label="Models">
          {llmOfferings.map((o) => (
            <li key={o.upstreamSlug}>
              <button
                type="button"
                aria-pressed={selected?.upstreamSlug === o.upstreamSlug}
                onClick={() => setSelected(o)}
                className={`w-full rounded-md border px-3 py-2 text-left font-mono text-xs ${
                  selected?.upstreamSlug === o.upstreamSlug
                    ? 'border-paper bg-paper/10 text-paper'
                    : 'border-paper-soft/20 text-paper-soft hover:bg-paper-soft/5'
                }`}
              >
                {o.upstreamSlug}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => void run()}
          disabled={!selected || running}
          className="self-start rounded-md bg-paper px-3 py-2 text-xs uppercase tracking-wider text-ink hover:bg-paper-soft disabled:opacity-50"
        >
          {running ? 'Running…' : 'Run streaming test'}
        </button>
        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
        {report ? <ModelDebugReport report={report} /> : null}
      </div>
    </PickerOverlay>
  );
}
