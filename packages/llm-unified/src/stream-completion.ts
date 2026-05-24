// SPDX-License-Identifier: LGPL-3.0-only
import { NANO_GPT_PAIRS } from './providers/_nano-gpt-pairs.js';
import { parseOpenAiSseStream } from './streaming.js';
import { buildRequest } from './transport.js';
import type {
  KnownModel,
  ProviderConfig,
  ProviderDefinition,
  StreamChunk,
  WireMessage,
} from './types.js';

export interface StreamCompletionArgs {
  provider: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  model: KnownModel;
  messages: WireMessage[];
  bodyExtras: Record<string, unknown>;
  signal?: AbortSignal;
}

/**
 * High-level streaming completion. Picks the right wire-body, handles
 * nano-gpt's pair-map quirk inline, and yields parsed StreamChunks.
 *
 * Body composition rules:
 *   - `model` defaults to args.model.id, but the nano-gpt pre-flight may
 *     swap it for the thinking slug when bodyExtras carries thinking=true.
 *   - bodyExtras is shallow-merged into the request body; the engine layer
 *     puts reasoning params, temperature, and similar in here.
 */
export async function* streamCompletion(args: StreamCompletionArgs): AsyncIterable<StreamChunk> {
  const body = buildBody(args);
  const request = buildRequest({
    provider: args.providerConfig,
    apiKey: args.apiKey,
    corsProxyUrl: args.corsProxyUrl,
    corsProxyKey: args.corsProxyKey,
    path: '/chat/completions',
    method: 'POST',
    body,
  });
  const response = await fetch(request, { signal: args.signal });
  if (!response.ok || !response.body) {
    yield { type: 'error', message: `upstream ${response.status}` };
    return;
  }
  yield* parseOpenAiSseStream(response.body, { signal: args.signal });
}

function buildBody(args: StreamCompletionArgs): Record<string, unknown> {
  let modelId = args.model.id;
  const extras = { ...args.bodyExtras };
  if (args.provider.id === 'nano-gpt') {
    const pair = NANO_GPT_PAIRS[args.model.id];
    if (pair && pair.switchingMode === 'slug') {
      const thinkingOn = extras.thinking === true;
      modelId = thinkingOn ? (pair.thinkingSlug ?? pair.nonThinkingSlug) : pair.nonThinkingSlug;
      extras.thinking = undefined; // slug-swap consumes the flag
    }
    // 'flag' mode keeps `extras.thinking` on the body; 'none' leaves it untouched.
  }
  return {
    model: modelId,
    messages: args.messages,
    stream: true,
    ...extras,
  };
}
