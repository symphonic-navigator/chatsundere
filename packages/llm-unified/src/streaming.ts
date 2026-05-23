// SPDX-License-Identifier: LGPL-3.0-only
import type { StreamChunk } from './types.js';

export interface ParseOpts {
  signal?: AbortSignal;
}

/**
 * Parse an OpenAI-compatible SSE stream into a structured StreamChunk
 * AsyncIterable. Handles split chunks, comments, blank lines, the [DONE]
 * terminator, and abort signals.
 */
export async function* parseOpenAiSseStream(
  stream: ReadableStream<Uint8Array>,
  opts: ParseOpts = {},
): AsyncIterable<StreamChunk> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  opts.signal?.addEventListener('abort', onAbort);

  try {
    while (true) {
      if (opts.signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events end at \n\n. Process every complete event in the buffer.
      let sep = buffer.indexOf('\n\n');
      while (sep !== -1) {
        const event = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const chunks = parseEvent(event);
        for (const c of chunks) {
          if (c === DONE) return;
          yield c;
        }
        sep = buffer.indexOf('\n\n');
      }
    }
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

const DONE = Symbol('done');
type EventOut = StreamChunk | typeof DONE;

function parseEvent(event: string): EventOut[] {
  const out: EventOut[] = [];
  for (const line of event.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trimStart();
    if (data === '[DONE]') {
      out.push(DONE);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch (e) {
      out.push({ type: 'error', message: `malformed SSE payload: ${(e as Error).message}` });
      continue;
    }
    out.push(...openAiPayloadToChunks(parsed));
  }
  return out;
}

interface OpenAiDeltaPayload {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

function openAiPayloadToChunks(payload: unknown): StreamChunk[] {
  const p = payload as OpenAiDeltaPayload;
  const choice = p.choices?.[0];
  if (!choice) return [];
  const out: StreamChunk[] = [];
  if (choice.delta?.content) {
    out.push({ type: 'token', text: choice.delta.content });
  }
  if (choice.delta?.tool_calls) {
    for (const tc of choice.delta.tool_calls) {
      if (tc.id && tc.function?.name && typeof tc.function.arguments === 'string') {
        out.push({
          type: 'tool-call',
          toolCallId: tc.id,
          name: tc.function.name,
          argumentsJson: tc.function.arguments,
        });
      }
    }
  }
  if (choice.finish_reason) {
    out.push({ type: 'finish', reason: normaliseFinishReason(choice.finish_reason) });
  }
  return out;
}

function normaliseFinishReason(
  reason: string,
): 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'unknown' {
  switch (reason) {
    case 'stop':
    case 'length':
    case 'tool_calls':
    case 'content_filter':
      return reason;
    default:
      return 'unknown';
  }
}
