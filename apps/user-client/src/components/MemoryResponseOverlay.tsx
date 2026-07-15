// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import { formatMemoryResponse, hasEmptyContent } from '../lib/memory-response-report.js';
import type { MemoryRawResponse } from '../memory/pipeline.js';
import { PickerOverlay } from './ui/PickerOverlay.js';

interface Props {
  open: boolean;
  response: MemoryRawResponse;
  onClose: () => void;
}

/**
 * A read-only view of the last model answer behind a failed memory action,
 * splitting the response into its reasoning and content channels. Its reason to
 * exist: a model that answers with a thinking block but empty content otherwise
 * surfaces only as an opaque "the model's answer couldn't be used". Seeing the
 * two channels side by side tells the user (and us) exactly what came back.
 */
export function MemoryResponseOverlay({ open, response, onClose }: Props): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const emptyContent = hasEmptyContent(response);

  async function copy(): Promise<void> {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(formatMemoryResponse(response));
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <PickerOverlay open={open} title="The model's answer" onClose={onClose}>
      <div className="flex flex-col gap-4 p-4" data-testid="memory-response">
        <p className="text-xs text-paper-soft">
          This is exactly what the model sent back for the last attempt, split into its thinking and
          its answer. Consolidation needs text in the answer.
        </p>

        {emptyContent ? (
          <p role="alert" className="text-xs text-danger">
            The model returned no usable text — only reasoning (or nothing) came back, so there was
            nothing to consolidate. Retrying usually helps; a different model can too.
          </p>
        ) : null}

        <p className="text-[11px] uppercase tracking-wider text-paper-soft">
          Finish reason:{' '}
          <span className="font-mono normal-case">{response.finishReason ?? '—'}</span>
        </p>

        <section className="flex flex-col gap-1">
          <h3 className="text-[11px] uppercase tracking-wider text-paper-soft">Reasoning</h3>
          <pre
            data-testid="memory-response-reasoning"
            className="max-h-[35vh] overflow-auto whitespace-pre-wrap rounded-md border border-paper-soft/30 bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-paper"
          >
            {response.reasoning.trim() === '' ? '(no reasoning returned)' : response.reasoning}
          </pre>
        </section>

        <section className="flex flex-col gap-1">
          <h3 className="text-[11px] uppercase tracking-wider text-paper-soft">Content</h3>
          <pre
            data-testid="memory-response-content"
            className="max-h-[35vh] overflow-auto whitespace-pre-wrap rounded-md border border-paper-soft/30 bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-paper"
          >
            {emptyContent ? '(empty — the model returned no content)' : response.content}
          </pre>
        </section>

        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => void copy()}
            className="self-start rounded-md bg-paper px-3 py-2 text-xs uppercase tracking-wider text-ink hover:bg-paper-soft"
          >
            <span aria-live="polite">{copied ? 'Copied ✓' : 'Copy for support'}</span>
          </button>
          {copyFailed ? (
            <p className="text-xs text-paper-soft/80">
              Couldn&apos;t copy automatically — select the text above and copy it.
            </p>
          ) : (
            <p className="text-xs text-paper-soft/80">
              Paste this into your reply to us if you ask for help.
            </p>
          )}
        </div>
      </div>
    </PickerOverlay>
  );
}
