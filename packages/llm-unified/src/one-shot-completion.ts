// SPDX-License-Identifier: LGPL-3.0-only
import type { CompletionTarget } from './catalogue/target.js';
import type { OnRetry } from './retry.js';
import { streamCompletion } from './stream-completion.js';
import type { ProviderConfig, ProviderDefinition, WireMessage } from './types.js';

/**
 * The assistant message folded from a one-shot call's stream, split into its
 * channels. Surfaced via {@link OneShotArgs.onRawResponse} for diagnostics —
 * notably the memory-consolidation debug view, where a model that answers with
 * reasoning but empty `content` otherwise looks like an opaque "answer
 * couldn't be used".
 */
export interface OneShotRawResponse {
  /** Concatenation of all `token` chunks, or '' when the stream had none. */
  content: string;
  /** Concatenation of all `reasoning` chunks, or ''. */
  reasoning: string;
  /** The `finish` chunk's reason, or null when the stream never emitted one. */
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
   * Optional diagnostics hook, fired exactly once after the stream is
   * exhausted — before either the error-chunk throw or the empty-content
   * guard throws — so a debug view can see a response whose `content` is
   * empty but whose `reasoning` is not.
   */
  onRawResponse?: (raw: OneShotRawResponse) => void;
}

const DEFAULT_ONE_SHOT_TIMEOUT_MS = 30_000;

/**
 * Non-streaming completion for background jobs (title generation, memory
 * extraction, compaction, vision substitution). A thin fold over
 * `streamCompletion`: it is the ONLY wire path, so background jobs automatically
 * inherit every adapter hook — endpoint path, response framing, sampling
 * translation, headers. A parallel implementation drifted from those hooks once
 * already and 404'd every Ollama background job (see the 2026-07-17 spec).
 */
export async function runOneShotCompletion(args: OneShotArgs): Promise<string> {
  return _runOneShotWith(args, streamCompletion);
}

/** Internal seam for tests: injects the stream producer. Not part of the public API. */
export async function _runOneShotWith(
  args: OneShotArgs,
  streamFn: typeof streamCompletion,
): Promise<string> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_ONE_SHOT_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = args.signal ? AbortSignal.any([args.signal, timeoutSignal]) : timeoutSignal;

  let content = '';
  let reasoning = '';
  let finishReason: string | null = null;
  let errorMessage: string | null = null;

  // No `cacheKey` and no `tools` by design: one-shot calls forgo
  // conversation-affinity caching (spec §6 — chat-only) and never call tools.
  // `initialResponseTimeoutMs` is the caller's overall budget, NOT the 15 s
  // streaming default: dreaming (180 s, 40-memory batches) and compaction have
  // no time-to-first-byte constraint today, and inheriting one would break them.
  for await (const chunk of streamFn({
    provider: args.provider,
    providerConfig: args.providerConfig,
    apiKey: args.apiKey,
    target: args.target,
    messages: args.messages,
    bodyExtras: args.bodyExtras,
    signal,
    initialResponseTimeoutMs: timeoutMs,
    operation: 'one-shot',
    onRetry: args.onRetry,
  })) {
    // `usage` and `tool-call` chunks are ignored: one-shot sends no tools, and
    // usage is not part of its contract.
    if (chunk.type === 'token') content += chunk.text;
    else if (chunk.type === 'reasoning') reasoning += chunk.text;
    else if (chunk.type === 'finish') finishReason = chunk.reason;
    // A mid-stream error inside a 200 response (e.g. openrouter-openai.ts)
    // must win over the generic empty-content error below, or the upstream's
    // real message is destroyed.
    else if (chunk.type === 'error') errorMessage = chunk.message;
  }

  args.onRawResponse?.({ content, reasoning, finishReason });
  if (errorMessage !== null) throw new Error(errorMessage);
  if (content.length === 0) throw new Error('one-shot returned empty content');
  return content;
}
