// SPDX-License-Identifier: LGPL-3.0-only
import { type ProviderId, applyReasoningToBody } from './_reasoning-body.js';
import type { CanonicalRequest, ModelAdapter, ToolDef } from './adapter-contract.js';
import { getAdapter } from './adapter-registry.js';
import { parseWithAdapter, parseWithAdapterNdjson } from './adapter-stream.js';
import type { CompletionTarget } from './catalogue/target.js';
import { type OnRetry, withStreamingRetry } from './retry.js';
import { parseOpenAiSseStream } from './streaming.js';
import { type StreamDiagnosticsSink, buildRequest, pickResponseHeaders } from './transport.js';
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
  target: CompletionTarget;
  messages: WireMessage[];
  bodyExtras: Record<string, unknown>;
  /**
   * Canonical tool definitions. Only the adapter path sends them (the generic
   * path ignores them). The client passes none today; the conversation-suite
   * populates this for verification.
   */
  tools?: ToolDef[];
  /**
   * Stable per-conversation key for providers with conversation-affinity prompt
   * caching (xAI's `x-grok-conv-id`). Threaded into `CanonicalRequest` so
   * adapters can emit it as a per-request header without touching the body.
   */
  cacheKey?: string;
  signal?: AbortSignal;
  /**
   * Cap on how long we wait for the upstream to begin responding (TTFB).
   * Once the headers arrive the timer is cleared and the body stream can
   * run as long as it needs to. Defaults to 15 000 ms.
   */
  initialResponseTimeoutMs?: number;
  /** Optional sink for retry decisions. Caller (apps/) wires the console line. */
  onRetry?: OnRetry;
  /** Optional sink for observing the resolved request and response for debugging purposes. */
  onDiagnostics?: StreamDiagnosticsSink;
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
  let body: Record<string, unknown>;
  let extraHeaders: Record<string, string> | undefined;
  let path = '/chat/completions';
  if (adapter) {
    const wire = buildWire(args, adapter);
    body = wire.body;
    extraHeaders = wire.headers;
    if (wire.path) path = wire.path;
  } else {
    body = buildBody(args);
  }
  const timeoutMs = args.initialResponseTimeoutMs ?? DEFAULT_INITIAL_RESPONSE_TIMEOUT_MS;

  const response = await withStreamingRetry({
    buildRequest: () =>
      buildRequest({
        provider: args.providerConfig,
        apiKey: args.apiKey,
        path,
        method: 'POST',
        body,
        extraHeaders,
        onDiagnostics: args.onDiagnostics,
      }),
    operation: 'stream-completion',
    initialResponseTimeoutMs: timeoutMs,
    signal: args.signal,
    onRetry: args.onRetry,
  });

  args.onDiagnostics?.onResponse({
    status: response.status,
    statusText: response.statusText,
    headers: pickResponseHeaders(response.headers),
  });

  if (!response.ok) {
    throw new Error(`streamCompletion: upstream ${response.status}`);
  }
  if (!response.body) {
    throw new Error(`streamCompletion: upstream ${response.status} returned no body`);
  }
  if (adapter) {
    yield* adapter.responseFraming === 'ndjson'
      ? parseWithAdapterNdjson(response.body, adapter, { signal: args.signal })
      : parseWithAdapter(response.body, adapter, { signal: args.signal });
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
    // Ask for usage on the final stream chunk — the catalogue adapters do this
    // too; without it the generic path never surfaces normalised usage.
    stream_options: { include_usage: true },
    // Generic OpenAI-compatible providers (adapter.kind === 'generic') get tool
    // definitions injected here — the catalogue path does this in `buildWire`,
    // and without it a generic offering that declares `toolCalls.supported`
    // silently never receives the tools, so the model never calls them.
    ...(args.tools && args.tools.length > 0
      ? {
          tools: args.tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        }
      : {}),
    ...extras,
  };
}

/**
 * Build the wire body AND any adapter-supplied headers via a ModelAdapter. The
 * adapter owns model/messages/stream/reasoning/tools and its own headers (e.g.
 * wafer's `Wafer-ZDR: required`); generic sampling params (e.g. temperature)
 * carried in bodyExtras are layered on afterwards so they are never lost, and
 * never override the adapter's keys.
 */
function buildWire(
  args: StreamCompletionArgs,
  adapter: ModelAdapter,
): { body: Record<string, unknown>; headers?: Record<string, string>; path?: string } {
  const { thinking: _thinking, reasoning: rawReasoning, ...sampling } = args.bodyExtras;
  const intent = (rawReasoning as ReasoningIntent | undefined) ?? { enabled: false };
  const req: CanonicalRequest = {
    messages: args.messages,
    reasoning: intent,
    ...(args.tools && args.tools.length > 0 ? { tools: args.tools } : {}),
    ...(args.cacheKey ? { cacheKey: args.cacheKey } : {}),
  };
  const wire = adapter.buildRequest(req);
  // Sampling first, adapter body second: the adapter's structural keys
  // (model/messages/stream/reasoning/tools) always win on any clash, while
  // generic sampling params (e.g. temperature) the adapter does not set survive.
  return { body: { ...sampling, ...wire.body }, headers: wire.headers, path: wire.path };
}

/** The wire body via a ModelAdapter (headers dropped). Retained for tests. */
function buildAdapterBody(
  args: StreamCompletionArgs,
  adapter: ModelAdapter,
): Record<string, unknown> {
  return buildWire(args, adapter).body;
}

// Test-only re-export so unit tests can exercise body composition without
// running the full streaming fetch path.
export const buildBodyForTest = buildBody;

// Test-only re-export so unit tests can exercise adapter-body composition
// without the network.
export const buildAdapterBodyForTest = buildAdapterBody;

/** Test hook — exposes buildWire so cacheKey/header threading can be asserted. */
export function _buildWireForTests(args: StreamCompletionArgs, adapter: ModelAdapter) {
  return buildWire(args, adapter);
}
