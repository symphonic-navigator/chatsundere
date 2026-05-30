// SPDX-License-Identifier: LGPL-3.0-only
import { type ProviderId, applyReasoningToBody } from './_reasoning-body.js';
import type { CanonicalRequest, ModelAdapter, ToolDef } from './adapter-contract.js';
import { getAdapter } from './adapter-registry.js';
import { parseWithAdapter } from './adapter-stream.js';
import type { CompletionTarget } from './catalogue/target.js';
import {
  MAX_RETRY_ATTEMPTS,
  computeRetryDelay,
  parseRetryAfter,
  shouldRetryStatus,
} from './retry.js';
import { parseOpenAiSseStream } from './streaming.js';
import { buildRequest } from './transport.js';
import type {
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
  target: CompletionTarget;
  messages: WireMessage[];
  bodyExtras: Record<string, unknown>;
  /**
   * Canonical tool definitions. Only the adapter path sends them (the generic
   * path ignores them). The client passes none today; the conversation-suite
   * populates this for verification.
   */
  tools?: ToolDef[];
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
 *   - `model` defaults to args.target.slug. nano-gpt slug-mode models may
 *     rewrite it when extras.reasoning is enabled.
 *   - bodyExtras is shallow-merged into the request body. The engine layer
 *     puts the unified `reasoning: ReasoningIntent` field plus things like
 *     temperature in here. Legacy boolean `thinking` is silently dropped.
 */
export async function* streamCompletion(args: StreamCompletionArgs): AsyncIterable<StreamChunk> {
  const adapter = args.target.adapterId ? getAdapter(args.target.adapterId) : undefined;
  const body = adapter ? buildAdapterBody(args, adapter) : buildBody(args);
  const request = buildRequest({
    provider: args.providerConfig,
    apiKey: args.apiKey,
    corsProxyUrl: args.corsProxyUrl,
    corsProxyKey: args.corsProxyKey,
    path: '/chat/completions',
    method: 'POST',
    body,
  });

  // TTFB timeout: cleared as soon as response headers arrive, so a long
  // generation never triggers it. Wraps every fetch attempt in the retry loop.
  const timeoutMs = args.initialResponseTimeoutMs ?? DEFAULT_INITIAL_RESPONSE_TIMEOUT_MS;

  let response: Response | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    if (args.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

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

    let attemptResponse: Response;
    try {
      attemptResponse = await fetch(request, { signal: fetchSignal });
    } catch (err) {
      clearTimeout(timeoutId);
      // Treat network-level failures (TypeError per WHATWG fetch spec) as
      // retryable; anything else (e.g. AbortError) propagates immediately.
      if (err instanceof TypeError && attempt < MAX_RETRY_ATTEMPTS && !args.signal?.aborted) {
        lastError = err;
        const delay = computeRetryDelay(attempt, null);
        await new Promise<void>((r) => setTimeout(r, delay * 1000));
        continue;
      }
      throw err;
    }
    clearTimeout(timeoutId);

    if (attemptResponse.ok) {
      response = attemptResponse;
      break;
    }
    // Non-2xx response: retry if the status is transient, else propagate.
    if (!shouldRetryStatus(attemptResponse.status) || attempt >= MAX_RETRY_ATTEMPTS) {
      response = attemptResponse;
      break;
    }
    const retryAfter = parseRetryAfter(attemptResponse.headers);
    // Consume the body so the connection can be reused.
    await attemptResponse.body?.cancel();
    const delay = computeRetryDelay(attempt, retryAfter);
    if (args.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await new Promise<void>((r) => setTimeout(r, delay * 1000));
  }
  if (!response) {
    throw lastError ?? new Error('streamCompletion: exhausted without response');
  }

  if (!response.ok) {
    throw new Error(`streamCompletion: upstream ${response.status}`);
  }
  if (!response.body) {
    throw new Error(`streamCompletion: upstream ${response.status} returned no body`);
  }
  if (adapter) {
    yield* parseWithAdapter(response.body, adapter, { signal: args.signal });
  } else {
    yield* parseOpenAiSseStream(response.body, { signal: args.signal });
  }
}

function buildBody(args: StreamCompletionArgs): Record<string, unknown> {
  // Strip the legacy boolean `thinking` flag (replaced by
  // `extras.reasoning: ReasoningIntent`) and the consumed `reasoning`
  // intent itself from the spread-into body — `applyReasoningToBody`
  // re-emits whatever the wire wants.
  const { thinking: _thinking, reasoning: rawReasoning, ...extras } = args.bodyExtras;

  let modelId = args.target.slug;
  const intent = rawReasoning as ReasoningIntent | undefined;
  if (intent) {
    const applied = applyReasoningToBody(
      args.provider.id as ProviderId,
      args.target.slug,
      intent,
      {},
    );
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

/**
 * Build the wire body via a ModelAdapter. The adapter owns model/messages/
 * stream/reasoning/tools; generic sampling params (e.g. temperature) carried in
 * bodyExtras are layered on afterwards so they are never lost, and never
 * override the adapter's keys.
 */
function buildAdapterBody(
  args: StreamCompletionArgs,
  adapter: ModelAdapter,
): Record<string, unknown> {
  const { thinking: _thinking, reasoning: rawReasoning, ...sampling } = args.bodyExtras;
  const intent = (rawReasoning as ReasoningIntent | undefined) ?? { enabled: false };
  const req: CanonicalRequest = {
    messages: args.messages,
    reasoning: intent,
    ...(args.tools && args.tools.length > 0 ? { tools: args.tools } : {}),
  };
  const wire = adapter.buildRequest(req);
  // Sampling first, adapter body second: the adapter's structural keys
  // (model/messages/stream/reasoning/tools) always win on any clash, while
  // generic sampling params (e.g. temperature) the adapter does not set survive.
  return { ...sampling, ...wire.body };
}

// Test-only re-export so unit tests can exercise body composition without
// running the full streaming fetch path.
export const buildBodyForTest = buildBody;

// Test-only re-export so unit tests can exercise adapter-body composition
// without the network.
export const buildAdapterBodyForTest = buildAdapterBody;
