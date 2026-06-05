// SPDX-License-Identifier: LGPL-3.0-only
import type { NormalisedUsage, StreamChunk } from './types.js';

export interface ParseOpts {
  signal?: AbortSignal;
}

/**
 * Frame an SSE byte stream into raw event strings (the text between `\n\n`
 * separators). Generic — no payload interpretation. Shared by the generic
 * and adapter parse paths.
 */
export async function* frameSseEvents(
  stream: ReadableStream<Uint8Array>,
  opts: ParseOpts = {},
): AsyncIterable<string> {
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

      let sep = buffer.indexOf('\n\n');
      while (sep !== -1) {
        yield buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        sep = buffer.indexOf('\n\n');
      }
    }
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

/**
 * Frame an NDJSON byte stream into raw single-line JSON strings (each upstream
 * object is one `\n`-terminated line). The ollama-native `/api/chat` framing.
 */
export async function* frameNdjsonLines(
  stream: ReadableStream<Uint8Array>,
  opts: ParseOpts = {},
): AsyncIterable<string> {
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

      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        if (line) yield line;
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
      }
    }
    const tail = buffer.trim();
    if (tail) yield tail;
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

/** One SSE `data:` line, interpreted up to (but not including) payload shape. */
export type SsePayloadToken =
  | { kind: 'data'; data: unknown }
  | { kind: 'done' }
  | { kind: 'malformed'; message: string };

/** Split one SSE event into its payload tokens (data lines, [DONE], malformed). */
export function eventToTokens(event: string): SsePayloadToken[] {
  const out: SsePayloadToken[] = [];
  for (const line of event.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trimStart();
    if (data === '[DONE]') {
      out.push({ kind: 'done' });
      continue;
    }
    try {
      out.push({ kind: 'data', data: JSON.parse(data) });
    } catch (e) {
      out.push({ kind: 'malformed', message: (e as Error).message });
    }
  }
  return out;
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
  for await (const event of frameSseEvents(stream, opts)) {
    for (const tok of eventToTokens(event)) {
      if (tok.kind === 'done') return;
      if (tok.kind === 'malformed') {
        yield { type: 'error', message: `malformed SSE payload: ${tok.message}` };
        continue;
      }
      yield* openAiPayloadToChunks(tok.data);
    }
  }
}

interface OpenAiDeltaPayload {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number | null };
    prompt_tokens_details?: { cached_tokens?: number | null };
  } | null;
}

function openAiPayloadToChunks(payload: unknown): StreamChunk[] {
  const p = payload as OpenAiDeltaPayload;
  const out: StreamChunk[] = [];

  // Usage arrives in a final chunk whose `choices` is empty, when the request
  // set `stream_options.include_usage` — handle it before the choice guard so
  // the generic path surfaces usage like the catalogue adapters do.
  if (p.usage) {
    const usage: NormalisedUsage = {
      promptTokens: p.usage.prompt_tokens ?? 0,
      completionTokens: p.usage.completion_tokens ?? 0,
      totalTokens: p.usage.total_tokens ?? 0,
    };
    const reasoning = p.usage.completion_tokens_details?.reasoning_tokens;
    if (reasoning != null) usage.reasoningTokens = reasoning;
    const cached = p.usage.prompt_tokens_details?.cached_tokens;
    if (cached != null) usage.cachedTokens = cached;
    out.push({ type: 'usage', usage });
  }

  const choice = p.choices?.[0];
  if (!choice) return out;

  // Reasoning emits *before* the token in the same event — matches
  // upstream temporal ordering (the model thinks, then speaks).
  const reasoningModern = choice.delta?.reasoning ?? '';
  const reasoningLegacy = choice.delta?.reasoning_content ?? '';
  const reasoning = reasoningModern + reasoningLegacy;
  if (reasoning) {
    out.push({ type: 'reasoning', text: reasoning });
  }

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
