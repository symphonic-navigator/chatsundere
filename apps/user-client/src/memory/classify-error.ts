// SPDX-License-Identifier: AGPL-3.0-only
import { MemoryInvalidOutputError } from './pipeline.js';

export type MemoryActionError =
  | 'no-credentials'
  | 'timeout'
  | 'upstream-busy'
  | 'invalid-output'
  | 'failed';

const BUSY_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

/** Map a memory-action failure to an honest, user-facing error code. Both
 *  timeout-signal shapes (TimeoutError, the pre-flight AbortError) mean the
 *  overall time budget ran out — there is no user-initiated abort on this path. */
export function classifyMemoryActionError(e: unknown): MemoryActionError {
  if (e instanceof Error && e.message.includes('master key')) return 'no-credentials';
  if (e instanceof MemoryInvalidOutputError) return 'invalid-output';
  if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError'))
    return 'timeout';
  const status = (e as { status?: unknown }).status;
  if (typeof status === 'number' && BUSY_STATUSES.has(status)) return 'upstream-busy';
  return 'failed';
}
