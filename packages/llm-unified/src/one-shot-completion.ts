// SPDX-License-Identifier: LGPL-3.0-only
import { type ProviderId, applyReasoningToBody } from './_reasoning-body.js';
import type { CanonicalRequest } from './adapter-contract.js';
import { getAdapter } from './adapter-registry.js';
import type { CompletionTarget } from './catalogue/target.js';
import { fetchWithProxyAuth } from './proxy-fetch.js';
import { type OnRetry, parseRetryAfter, shouldRetryStatus, withRetry } from './retry.js';
import { buildRequest } from './transport.js';
import type { ProviderConfig, ProviderDefinition, ReasoningIntent, WireMessage } from './types.js';

const DEFAULT_ONE_SHOT_TIMEOUT_MS = 30_000;

/**
 * The parsed assistant message from a one-shot call, split into its channels.
 * Surfaced via {@link OneShotArgs.onRawResponse} for diagnostics — notably the
 * memory-consolidation debug view, where a model that answers with reasoning
 * but empty `content` otherwise looks like an opaque "answer couldn't be used".
 */
export interface OneShotRawResponse {
  /** `message.content` verbatim, or '' when the model returned none. */
  content: string;
  /** `message.reasoning` (modern) or `message.reasoning_content` (legacy), or ''. */
  reasoning: string;
  /** The choice's `finish_reason`, or null when absent. */
  finishReason: string | null;
}

export interface OneShotArgs {
  provider: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  target: CompletionTarget;
  messages: WireMessage[];
  bodyExtras: Record<string, unknown>;
  signal?: AbortSignal;
  /** Overall timeout for the whole call (default 30 000 ms). Background jobs must not hang forever. */
  timeoutMs?: number;
  /** Optional sink for retry decisions. Caller (apps/) wires the console line. */
  onRetry?: OnRetry;
  /**
   * Optional diagnostics hook, fired once per attempt the moment a 2xx body is
   * parsed — before the empty-content guard throws — so a debug view can see a
   * response whose `content` is empty but whose `reasoning` is not. Fires only
   * for parsed 2xx responses; a non-2xx status or a timeout never calls it. On a
   * successful retry the last invocation wins.
   */
  onRawResponse?: (raw: OneShotRawResponse) => void;
}

interface OneShotResponse {
  choices?: Array<{
    message?: { content?: string; reasoning?: string; reasoning_content?: string };
    finish_reason?: string;
  }>;
}

/**
 * Compose the non-streaming wire body + headers for a one-shot call. Reuses the
 * same per-model adapter and reasoning translation as `streamCompletion`, so
 * background jobs (title generation, …) honour per-model reasoning-off and any
 * provider-required headers (e.g. wafer's `Wafer-ZDR`). Mirrors
 * stream-completion's buildBody/buildWire but pins `stream: false` and drops
 * the streaming-only `stream_options` rider.
 *
 * Without the adapter, reasoning-capable models reasoned by default and (under
 * the previous raw `{ model, messages, stream: false }` body) consumed the
 * whole `max_tokens` budget in their reasoning channel, leaving `content`
 * empty — title-gen then silently fell back to "New chat — …".
 */
function composeOneShotWire(args: OneShotArgs): {
  body: Record<string, unknown>;
  headers?: Record<string, string>;
} {
  const adapter = args.target.adapterId ? getAdapter(args.target.adapterId) : undefined;
  if (adapter) {
    const { thinking: _thinking, reasoning: rawReasoning, ...sampling } = args.bodyExtras;
    const intent = (rawReasoning as ReasoningIntent | undefined) ?? { enabled: false };
    // No `cacheKey` here by design: one-shot calls (title-gen, memory extraction)
    // deliberately forgo conversation-affinity caching (spec §6 — chat-only).
    const req: CanonicalRequest = { messages: args.messages, reasoning: intent };
    const wire = adapter.buildRequest(req);
    // Sampling first, adapter structural keys second (as in streamCompletion);
    // then force non-streaming and drop the streaming-only usage rider.
    const { stream_options: _streamOptions, ...adapterBody } = wire.body;
    return { body: { ...sampling, ...adapterBody, stream: false }, headers: wire.headers };
  }
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
  return { body: { model: modelId, messages: args.messages, stream: false, ...extras } };
}

/**
 * Internal helper for testing. Allows injection of a custom sleep function.
 * Not part of the public API.
 */
export async function runOneShotCompletionWithSleep(
  args: OneShotArgs,
  sleepFn: (ms: number) => Promise<void>,
): Promise<string> {
  const { body, headers } = composeOneShotWire(args);
  const timeoutMs = args.timeoutMs ?? DEFAULT_ONE_SHOT_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = args.signal ? AbortSignal.any([args.signal, timeoutSignal]) : timeoutSignal;

  return withRetry<string>(
    async () => {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      // Fresh Request each attempt: a Request's body is consumed on first fetch,
      // so reusing it on retry throws ERR_BODY_ALREADY_USED. buildRequest is pure.
      const proxied = args.providerConfig.routing.kind === 'cors-proxy';
      const response = await fetchWithProxyAuth(
        () =>
          buildRequest({
            provider: args.providerConfig,
            apiKey: args.apiKey,
            path: '/chat/completions',
            method: 'POST',
            body,
            extraHeaders: headers,
          }),
        { proxied, signal },
      );
      if (!response.ok) {
        const err = new Error(`one-shot upstream returned ${response.status}`) as Error & {
          status?: number;
          retryAfter?: number | null;
        };
        err.status = response.status;
        err.retryAfter = parseRetryAfter(response.headers);
        await response.body?.cancel();
        throw err;
      }
      const json = (await response.json()) as OneShotResponse;
      const choice = json.choices?.[0];
      const message = choice?.message;
      const content = message?.content;
      if (args.onRawResponse) {
        const reasoning =
          (typeof message?.reasoning === 'string' && message.reasoning) ||
          (typeof message?.reasoning_content === 'string' && message.reasoning_content) ||
          '';
        args.onRawResponse({
          content: typeof content === 'string' ? content : '',
          reasoning,
          finishReason: choice?.finish_reason ?? null,
        });
      }
      if (typeof content !== 'string' || content.length === 0) {
        throw new Error('one-shot returned empty content');
      }
      return content;
    },
    {
      signal,
      sleepFn,
      operation: 'one-shot',
      onRetry: args.onRetry,
      classifyError: (err) => {
        const e = err as { status?: number };
        return typeof e.status === 'number'
          ? { errorKind: 'status', status: e.status }
          : { errorKind: 'network' };
      },
      isRetriable: (err) => {
        if (err instanceof TypeError) return true;
        const e = err as { status?: number };
        return typeof e.status === 'number' && shouldRetryStatus(e.status);
      },
      extractRetryAfter: (err) => {
        const e = err as { retryAfter?: number | null };
        return e.retryAfter ?? null;
      },
    },
  );
}

/**
 * Non-streaming completion. Used by background jobs (title generation,
 * memory extraction, etc.) where streaming token-by-token is unnecessary.
 * Honours the same nano-gpt pair-map quirks as streamCompletion.
 */
export async function runOneShotCompletion(args: OneShotArgs): Promise<string> {
  const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  return runOneShotCompletionWithSleep(args, defaultSleep);
}
