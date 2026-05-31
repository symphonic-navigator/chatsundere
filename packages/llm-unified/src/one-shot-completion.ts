// SPDX-License-Identifier: LGPL-3.0-only
import type { CompletionTarget } from './catalogue/target.js';
import { NANO_GPT_PAIRS } from './providers/_nano-gpt-pairs.js';
import { type OnRetry, parseRetryAfter, shouldRetryStatus, withRetry } from './retry.js';
import { buildRequest } from './transport.js';
import type { ProviderConfig, ProviderDefinition, WireMessage } from './types.js';

const DEFAULT_ONE_SHOT_TIMEOUT_MS = 30_000;

export interface OneShotArgs {
  provider: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  target: CompletionTarget;
  messages: WireMessage[];
  bodyExtras: Record<string, unknown>;
  signal?: AbortSignal;
  /** Overall timeout for the whole call (default 30 000 ms). Background jobs must not hang forever. */
  timeoutMs?: number;
  /** Optional sink for retry decisions. Caller (apps/) wires the console line. */
  onRetry?: OnRetry;
}

interface OneShotResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * Internal helper for testing. Allows injection of a custom sleep function.
 * Not part of the public API.
 */
export async function runOneShotCompletionWithSleep(
  args: OneShotArgs,
  sleepFn: (ms: number) => Promise<void>,
): Promise<string> {
  let modelId = args.target.slug;
  const extras = { ...args.bodyExtras };
  if (args.provider.id === 'nano-gpt') {
    const pair = NANO_GPT_PAIRS[args.target.slug];
    if (pair && pair.switchingMode === 'slug') {
      const thinkingOn = extras.thinking === true;
      modelId = thinkingOn ? (pair.thinkingSlug ?? pair.nonThinkingSlug) : pair.nonThinkingSlug;
      extras.thinking = undefined;
    }
  }
  const timeoutMs = args.timeoutMs ?? DEFAULT_ONE_SHOT_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = args.signal ? AbortSignal.any([args.signal, timeoutSignal]) : timeoutSignal;

  return withRetry<string>(
    async () => {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      // Fresh Request each attempt: a Request's body is consumed on first fetch,
      // so reusing it on retry throws ERR_BODY_ALREADY_USED. buildRequest is pure.
      const request = buildRequest({
        provider: args.providerConfig,
        apiKey: args.apiKey,
        corsProxyUrl: args.corsProxyUrl,
        corsProxyKey: args.corsProxyKey,
        path: '/chat/completions',
        method: 'POST',
        body: { model: modelId, messages: args.messages, stream: false, ...extras },
      });
      const response = await fetch(request, { signal });
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
      const content = json.choices?.[0]?.message?.content;
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
