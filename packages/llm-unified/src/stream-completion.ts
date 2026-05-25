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
  /**
   * Cap on how long we wait for the upstream to begin responding (TTFB).
   * Once the headers arrive the timer is cleared and the body stream can
   * run as long as it needs to. Defaults to 15 000 ms.
   */
  initialResponseTimeoutMs?: number;
}

const DEFAULT_INITIAL_RESPONSE_TIMEOUT_MS = 15_000;

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

  // Couple a TTFB timeout to the user-supplied abort signal. The timer
  // is cleared as soon as the response headers arrive, so a slow generation
  // (long reply, deep reasoning) never triggers it.
  const timeoutMs = args.initialResponseTimeoutMs ?? DEFAULT_INITIAL_RESPONSE_TIMEOUT_MS;
  const timeoutCtrl = new AbortController();
  const timeoutId = setTimeout(
    () =>
      timeoutCtrl.abort(
        new DOMException(`upstream did not respond within ${timeoutMs}ms`, 'TimeoutError'),
      ),
    timeoutMs,
  );
  const fetchSignal = args.signal
    ? AbortSignal.any([args.signal, timeoutCtrl.signal])
    : timeoutCtrl.signal;

  let response: Response;
  try {
    response = await fetch(request, { signal: fetchSignal });
  } finally {
    clearTimeout(timeoutId);
  }

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
  } else if (typeof extras.thinking === 'boolean') {
    // The boolean `thinking` flag is a nano-gpt convention. Other providers
    // reject it — Novita for example expects a struct
    // `{ type: 'enabled' | 'disabled' }` and 400s with
    // "cannot unmarshal bool into Go struct field …Thinking". Drop the
    // flag so the request goes through. Reasoning-OFF for non-nano-gpt
    // providers needs per-provider translation and is tracked as a
    // follow-up.
    extras.thinking = undefined;
  }
  return {
    model: modelId,
    messages: args.messages,
    stream: true,
    ...extras,
  };
}
