// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Frame a raw OpenAI-compatible SSE response body into its JSON delta
 * payloads. Comments (`:`-prefixed), blank lines and the `[DONE]` terminator
 * are dropped. Unlike the live parser this operates on a complete captured
 * string (fixtures are captured whole), so there is no split-chunk handling.
 * Malformed payloads throw — a corrupt fixture must fail loudly, not silently
 * vanish.
 */
export function frameSse(raw: string): unknown[] {
  const out: unknown[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trimEnd();
    if (trimmed === '' || trimmed.startsWith(':')) continue;
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trimStart();
    if (data === '[DONE]') continue;
    out.push(JSON.parse(data));
  }
  return out;
}
