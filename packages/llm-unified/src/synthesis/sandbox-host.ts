// SPDX-License-Identifier: LGPL-3.0-only
import { resolve } from 'node:path';
import type { CanonicalRequest, ParseState, WireRequest } from '../adapter-contract.js';
import type { StreamChunk } from '../types.js';

export interface AdapterHandle {
  profile: unknown;
  buildRequest(req: CanonicalRequest): Promise<WireRequest>;
  parseChunk(
    raw: unknown,
    state: ParseState,
  ): Promise<{ events: StreamChunk[]; state: ParseState }>;
  dispose(): void;
}

export interface SandboxOpts {
  timeoutMs?: number;
}

const WORKER_ENTRY = resolve(import.meta.dir, '_worker-entry.ts');

/**
 * Load an adapter module inside a Bun Worker and expose its pure functions over
 * postMessage. The Worker is a functional isolation stand-in for the spike —
 * NOT the production security boundary (that is a sandboxed iframe). Each call
 * is guarded by a watchdog that terminates the Worker on timeout, containing
 * infinite loops / resource abuse to the capsule.
 */
export async function loadAdapterInSandbox(
  modulePath: string,
  opts: SandboxOpts = {},
): Promise<AdapterHandle> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const worker = new Worker(WORKER_ENTRY);
  let nextId = 1;
  let terminated = false;

  /** Registry of all in-flight calls keyed by message id. */
  interface PendingEntry {
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    onMessage: (e: MessageEvent) => void;
  }
  const pending = new Map<number, PendingEntry>();

  /**
   * Settle and remove a single in-flight call.  Called on both the happy path
   * (message reply arrives) and the sad path (individual watchdog fires).
   */
  const cleanup = (id: number): void => {
    const entry = pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    worker.removeEventListener('message', entry.onMessage);
    pending.delete(id);
  };

  /**
   * Reject all pending calls, terminate the worker, and mark the sandbox as
   * disposed.  Idempotent — safe to call multiple times.
   */
  const teardown = (reason: string): void => {
    if (terminated) return;
    terminated = true;
    worker.terminate();
    const err = new Error(reason);
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      worker.removeEventListener('message', entry.onMessage);
      pending.delete(id);
      entry.reject(err);
    }
  };

  // Install the error listener BEFORE sending the init message so that any
  // worker crash during module loading is caught immediately.
  worker.addEventListener('error', (e: ErrorEvent) => {
    teardown(`worker error: ${e.message}`);
  });

  const call = <T>(cmd: string, payload: Record<string, unknown>): Promise<T> => {
    const id = nextId++;
    return new Promise<T>((resolvePromise, reject) => {
      if (terminated) {
        reject(new Error('sandbox already disposed'));
        return;
      }

      const timer = setTimeout(() => {
        // Settle this call first (removing it from the registry) so teardown
        // does not double-reject it when it drains the remaining pending map.
        cleanup(id);
        reject(new Error(`adapter ${cmd} timed out after ${timeoutMs}ms`));
        teardown(`adapter ${cmd} timed out after ${timeoutMs}ms`);
      }, timeoutMs);

      const onMessage = (e: MessageEvent) => {
        const data = e.data as { id: number; ok: boolean; result?: unknown; error?: string };
        if (data.id !== id) return;
        cleanup(id);
        if (data.ok) resolvePromise(data.result as T);
        else reject(new Error(data.error ?? 'sandbox error'));
      };

      pending.set(id, { reject, timer, onMessage });
      worker.addEventListener('message', onMessage);
      worker.postMessage({ id, cmd, ...payload });
    });
  };

  const profile = await call<unknown>('init', { modulePath });

  return {
    profile,
    buildRequest: (req) => call<WireRequest>('buildRequest', { arg1: req }),
    parseChunk: (raw, state) =>
      call<{ events: StreamChunk[]; state: ParseState }>('parseChunk', { arg1: raw, arg2: state }),
    dispose: () => {
      teardown('sandbox disposed');
    },
  };
}
