// SPDX-License-Identifier: AGPL-3.0-only

import type { ParseResult } from './types.js';

export type ParseErrorKind = 'unrecognised' | 'parse-failed' | 'worker-crashed' | 'cancelled';

/** Typed failure from the parse worker; `kind` drives the UI copy (spec §9). */
export class ParseExportError extends Error {
  readonly kind: ParseErrorKind;
  constructor(kind: ParseErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface ParseHandle {
  result: Promise<ParseResult>;
  /** Terminates the worker; `result` rejects with kind 'cancelled'. */
  cancel: () => void;
}

function defaultSpawn(): Worker {
  return new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
}

/**
 * Parse a picked export file off the main thread (spec §3): unzip + JSON.parse
 * + flatten all run in a dedicated worker, so Cancel genuinely works and an
 * out-of-memory kill hits the worker, not the tab (spec §9).
 */
export function parseThirdPartyExport(
  file: Blob,
  spawnWorker: () => Worker = defaultSpawn,
): ParseHandle {
  const worker = spawnWorker();
  let settled = false;
  let rejectFn: (e: Error) => void = () => undefined;

  const result = new Promise<ParseResult>((resolve, reject) => {
    rejectFn = reject;
    worker.onmessage = (e: MessageEvent) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      const d = e.data as
        | { ok: true; result: ParseResult }
        | { ok: false; kind: 'unrecognised' | 'parse-failed'; message: string };
      if (d.ok) resolve(d.result);
      else reject(new ParseExportError(d.kind, d.message));
    };
    worker.onerror = () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new ParseExportError('worker-crashed', 'The import worker crashed.'));
    };
    file
      .arrayBuffer()
      .then((buf) => {
        if (!settled) worker.postMessage(buf, [buf]);
      })
      .catch((e: unknown) => {
        if (settled) return;
        settled = true;
        worker.terminate();
        reject(
          new ParseExportError('parse-failed', e instanceof Error ? e.message : 'read failed'),
        );
      });
  });
  // A cancelled parse is an expected, handled outcome — never an unhandled rejection.
  result.catch(() => undefined);

  return {
    result,
    cancel: () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      rejectFn(new ParseExportError('cancelled', 'Cancelled.'));
    },
  };
}
