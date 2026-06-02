// SPDX-License-Identifier: AGPL-3.0-only
import type { SandboxRun } from './sandbox-exec.js';

/** Output cap handed to the sandbox (bytes of captured console output). */
export const SANDBOX_MAX_OUTPUT_BYTES = 4096;
/** Wall-clock cap for one run. 10 s leaves headroom for Worker spin-up on
 *  slower mobile devices (chatsune ran 60 s under server dispatch). */
export const SANDBOX_TIMEOUT_MS = 10_000;

/**
 * Run code in a fresh Web Worker and return its result. A new Worker per call
 * is the strongest state isolation; it is terminated unconditionally after the
 * reply or on timeout. An external `signal` abort also terminates it.
 */
export async function runSandbox(code: string, signal?: AbortSignal): Promise<SandboxRun> {
  const worker = new Worker(new URL('./sandbox.worker.ts', import.meta.url), { type: 'module' });

  const result = await new Promise<SandboxRun>((resolve) => {
    let settled = false;
    const settle = (value: SandboxRun): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timeout = setTimeout(() => {
      worker.terminate();
      settle({ stdout: '', value: undefined, error: `Timed out after ${SANDBOX_TIMEOUT_MS}ms` });
    }, SANDBOX_TIMEOUT_MS);

    const onAbort = (): void => {
      clearTimeout(timeout);
      worker.terminate();
      settle({ stdout: '', value: undefined, error: 'Aborted' });
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    worker.addEventListener('message', (event: MessageEvent<SandboxRun>) => {
      clearTimeout(timeout);
      settle(event.data);
    });
    worker.addEventListener('error', (event: ErrorEvent) => {
      clearTimeout(timeout);
      settle({
        stdout: '',
        value: undefined,
        error: `Sandbox crash: ${event.message || 'unknown error'}`,
      });
    });

    worker.postMessage({ code, maxOutputBytes: SANDBOX_MAX_OUTPUT_BYTES });
  });

  worker.terminate();
  return result;
}
