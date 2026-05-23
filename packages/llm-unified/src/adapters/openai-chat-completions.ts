// SPDX-License-Identifier: LGPL-3.0-only
import { parseOpenAiSseStream } from '../streaming.js';
import { buildRequest } from '../transport.js';
import type { ProviderConfig, StreamChunk, WireMessage } from '../types.js';

export interface StreamCompletionArgs {
  provider: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  messages: WireMessage[];
  modelId: string;
  signal?: AbortSignal;
  /** Override for testing — defaults to globalThis.fetch. */
  fetchFn?: typeof fetch;
}

/**
 * Stream a chat completion through an OpenAI-chat-completions-compatible
 * provider. The provider's transport (direct or cors-proxy) is honoured
 * by `buildRequest`. The SSE stream is parsed by `parseOpenAiSseStream`.
 * Errors at the HTTP layer are surfaced as an `error` StreamChunk so the
 * caller can render them inline on the in-flight message.
 */
export async function* streamCompletion(args: StreamCompletionArgs): AsyncIterable<StreamChunk> {
  const fetchFn = args.fetchFn ?? globalThis.fetch.bind(globalThis);
  const request = buildRequest({
    provider: args.provider,
    apiKey: args.apiKey,
    corsProxyUrl: args.corsProxyUrl,
    corsProxyKey: args.corsProxyKey,
    path: '/chat/completions',
    method: 'POST',
    body: {
      model: args.modelId,
      messages: args.messages,
      stream: true,
    },
  });

  let response: Response;
  try {
    response = await fetchFn(request, { signal: args.signal });
  } catch (e) {
    yield { type: 'error', message: `fetch failed: ${(e as Error).message}` };
    return;
  }

  if (!response.ok) {
    const text = await safeReadText(response);
    yield {
      type: 'error',
      message: `upstream returned ${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 200)}` : ''}`,
    };
    return;
  }

  if (!response.body) {
    yield { type: 'error', message: 'upstream returned no body' };
    return;
  }

  yield* parseOpenAiSseStream(response.body, { signal: args.signal });
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
