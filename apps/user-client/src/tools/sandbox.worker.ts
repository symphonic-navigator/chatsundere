// SPDX-License-Identifier: AGPL-3.0-only
import { DANGEROUS_GLOBALS, type SandboxRun, executeCode } from './sandbox-exec.js';

// Strip dangerous globals from the Worker scope before any user code runs.
// This is the real isolation boundary; executeCode's function-local shadowing
// is the defence-in-depth layer that also makes it testable.
for (const name of DANGEROUS_GLOBALS) {
  try {
    (self as unknown as Record<string, unknown>)[name] = undefined;
  } catch {
    // best-effort — a defineProperty-protected global must not crash bootstrap
  }
}

self.addEventListener(
  'message',
  (event: MessageEvent<{ code: string; maxOutputBytes: number }>) => {
    const { code, maxOutputBytes } = event.data;
    const result: SandboxRun = executeCode(code, maxOutputBytes);
    (self as unknown as { postMessage: (data: SandboxRun) => void }).postMessage(result);
  },
);
