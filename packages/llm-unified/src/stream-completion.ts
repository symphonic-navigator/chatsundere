// SPDX-License-Identifier: LGPL-3.0-only
import { type ProviderId, applyReasoningToBody } from './_reasoning-body.js';
import { parseOpenAiSseStream } from './streaming.js';
import { buildRequest } from './transport.js';
import type {
  KnownModel,
  ProviderConfig,
  ProviderDefinition,
  ReasoningIntent,
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
 * High-level streaming completion. Picks the right wire-body, delegates the
 * per-provider reasoning translation to `applyReasoningToBody`, and yields
 * parsed StreamChunks.
 *
 * Body composition rules:
 *   - `model` defaults to args.model.id. nano-gpt slug-mode models may
 *     rewrite it when extras.reasoning is enabled.
 *   - bodyExtras is shallow-merged into the request body. The engine layer
 *     puts the unified `reasoning: ReasoningIntent` field plus things like
 *     temperature in here. Legacy boolean `thinking` is silently dropped.
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
  // Strip the legacy boolean `thinking` flag (replaced by
  // `extras.reasoning: ReasoningIntent`) and the consumed `reasoning`
  // intent itself from the spread-into body — `applyReasoningToBody`
  // re-emits whatever the wire wants.
  const { thinking: _thinking, reasoning: rawReasoning, ...extras } = args.bodyExtras;

  let modelId = args.model.id;
  const intent = rawReasoning as ReasoningIntent | undefined;
  if (intent) {
    const applied = applyReasoningToBody(args.provider.id as ProviderId, args.model.id, intent, {});
    modelId = applied.modelId;
    Object.assign(extras, applied.body);
  }

  return {
    model: modelId,
    messages: args.messages,
    stream: true,
    ...extras,
  };
}

// Test-only re-export so unit tests can exercise body composition without
// running the full streaming fetch path.
export const buildBodyForTest = buildBody;
