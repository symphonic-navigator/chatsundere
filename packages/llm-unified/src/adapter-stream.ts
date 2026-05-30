// SPDX-License-Identifier: LGPL-3.0-only
import type { ModelAdapter, ParseState } from './adapter-contract.js';
import { type ParseOpts, eventToTokens, frameSseEvents } from './streaming.js';
import type { StreamChunk } from './types.js';

/**
 * Parse an SSE stream through a ModelAdapter, threading ParseState across
 * events so the adapter can reassemble fragmented tool calls and emit usage.
 * Reuses the generic SSE framing; only per-event interpretation differs from
 * parseOpenAiSseStream. Stops at [DONE]; malformed payloads become error chunks.
 */
export async function* parseWithAdapter(
  stream: ReadableStream<Uint8Array>,
  adapter: ModelAdapter,
  opts: ParseOpts = {},
): AsyncIterable<StreamChunk> {
  let state: ParseState = {};
  for await (const event of frameSseEvents(stream, opts)) {
    for (const tok of eventToTokens(event)) {
      if (tok.kind === 'done') return;
      if (tok.kind === 'malformed') {
        yield { type: 'error', message: `malformed SSE payload: ${tok.message}` };
        continue;
      }
      const { events, state: next } = adapter.parseChunk(tok.data, state);
      state = next;
      yield* events;
    }
  }
}
