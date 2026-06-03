// SPDX-License-Identifier: LGPL-3.0-only
import type { ModelAdapter, ParseState } from './adapter-contract.js';
import { type ParseOpts, eventToTokens, frameNdjsonLines, frameSseEvents } from './streaming.js';
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

/**
 * Parse an NDJSON stream (ollama-native `/api/chat`) through a ModelAdapter.
 * Each line is one JSON object handed straight to `parseChunk`; there is no
 * `[DONE]` sentinel — the adapter emits its `finish` event from the upstream
 * `done: true` chunk. Malformed lines become error chunks.
 */
export async function* parseWithAdapterNdjson(
  stream: ReadableStream<Uint8Array>,
  adapter: ModelAdapter,
  opts: ParseOpts = {},
): AsyncIterable<StreamChunk> {
  let state: ParseState = {};
  for await (const line of frameNdjsonLines(stream, opts)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      yield { type: 'error', message: `malformed NDJSON payload: ${(e as Error).message}` };
      continue;
    }
    const { events, state: next } = adapter.parseChunk(parsed, state);
    state = next;
    yield* events;
  }
}
