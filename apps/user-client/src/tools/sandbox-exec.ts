// SPDX-License-Identifier: AGPL-3.0-only

/** Result of one sandboxed run. `stdout` is captured `console.*` output;
 *  `value` is the stringified completion value of the final statement (or
 *  `undefined` when there is none); `error` is `Name: message` on a throw. */
export interface SandboxRun {
  stdout: string;
  value: string | undefined;
  error: string | null;
}

/** Globals nulled inside the eval scope so user code cannot reach the network,
 *  storage, or schedule work. The Worker entry (sandbox.worker.ts) also nulls
 *  these on `self`; nulling them here as function-locals keeps `executeCode`
 *  self-contained and testable in Node/jsdom without polluting real globals. */
export const DANGEROUS_GLOBALS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'importScripts',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'Worker',
  'SharedWorker',
  'EventSource',
  'BroadcastChannel',
  'indexedDB',
  'caches',
] as const;

function safeStringify(value: unknown): string {
  try {
    if (typeof value === 'string') return JSON.stringify(value);
    const json = JSON.stringify(value);
    return json ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Execute user-supplied JavaScript, capturing `console.*` output and the
 * completion value of the final statement.
 *
 * `new Function` gives a fresh function scope: the `var` nullers and the
 * `console` mock shadow the real globals function-locally (no global
 * pollution — safe to call directly in tests). A *direct* `eval(__code__)`
 * runs in that same scope, so user code sees the shadowed globals, and `eval`
 * returns the completion value of the program's final statement (`2 + 2` → 4).
 */
export function executeCode(code: string, maxOutputBytes: number): SandboxRun {
  const lines: string[] = [];
  let totalBytes = 0;
  let truncated = false;
  const encoder = new TextEncoder();

  const captureLine = (...args: unknown[]): void => {
    if (truncated) return;
    const line = args.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' ');
    const lineBytes = encoder.encode(`${line}\n`).length;
    if (totalBytes + lineBytes > maxOutputBytes) {
      truncated = true;
      const remaining = maxOutputBytes - totalBytes;
      if (remaining > 0) {
        lines.push(line.slice(0, remaining));
        totalBytes = maxOutputBytes;
      }
      return;
    }
    lines.push(line);
    totalBytes += lineBytes;
  };

  const consoleMock = {
    log: captureLine,
    error: captureLine,
    warn: captureLine,
    info: captureLine,
    debug: captureLine,
  };

  const nulledDeclarations = DANGEROUS_GLOBALS.map((n) => `var ${n} = undefined;`).join('\n');
  let value: unknown;
  let error: string | null = null;
  try {
    // new Function gives a fresh scope; var nullers and the console mock shadow real globals
    // function-locally. eval(__code__) inside that scope returns the final-statement value.
    const body = `${nulledDeclarations}\nvar console = __console__;\nreturn eval(__code__);`;
    value = new Function('__console__', '__code__', body)(consoleMock, code);
  } catch (e) {
    value = undefined;
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }

  let stdout = lines.join('\n');
  if (truncated) stdout += ' ... (output truncated)';

  return { stdout, value: value === undefined ? undefined : safeStringify(value), error };
}
