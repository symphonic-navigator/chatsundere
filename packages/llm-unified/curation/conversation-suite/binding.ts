// SPDX-License-Identifier: LGPL-3.0-only
import type { ModelAdapter, ToolDef } from '../../src/adapter-contract.js';
import { parseWithAdapter } from '../../src/adapter-stream.js';
import {
  type OnRetry,
  type RetryEvent,
  formatRetryEvent,
  withStreamingRetry,
} from '../../src/retry.js';
import { buildRequest } from '../../src/transport.js';
import type { ProviderConfig, StreamChunk } from '../../src/types.js';
import { type RunnerBinding, assembleOutcome } from './runner.js';

/** Default retry sink for suite runs: a structured CLI line. */
const logRetryToConsole: OnRetry = (e: RetryEvent) => console.warn(formatRetryEvent(e));

export interface LiveBindingArgs {
  offeringRef: string;
  providerConfig: ProviderConfig;
  apiKey: string;
  corsProxyUrl?: string | null;
  corsProxyKey?: string | null;
  adapter: ModelAdapter;
  tools?: ToolDef[];
  /** Injectable for key-free unit tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable backoff (ms); defaults to a real setTimeout. Lets tests run instantly. */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Optional retry sink; defaults to a structured console line. */
  onRetry?: OnRetry;
}

/**
 * Wire the conversation-suite to a live provider. Does its OWN fetch (not
 * streamCompletion) so the HTTP status is captured rather than thrown — the
 * MiMo/chutes 400 case must become a checkable outcome, not an exception.
 * Retries transient statuses (429 / 5xx) with backoff so a live run under load
 * is not derailed by rate-limiting; a non-retryable status (e.g. 400) is
 * captured immediately, and an exhausted retry returns the final status.
 */
export function makeLiveBinding(args: LiveBindingArgs): RunnerBinding {
  return {
    offeringRef: args.offeringRef,
    async runTurn(messages, reasoning) {
      const wire = args.adapter.buildRequest({
        messages,
        reasoning,
        ...(args.tools && args.tools.length > 0 ? { tools: args.tools } : {}),
      });

      const response = await withStreamingRetry({
        buildRequest: () =>
          buildRequest({
            provider: args.providerConfig,
            apiKey: args.apiKey,
            corsProxyUrl: args.corsProxyUrl ?? null,
            corsProxyKey: args.corsProxyKey ?? null,
            path: '/chat/completions',
            method: 'POST',
            body: wire.body,
          }),
        doFetch: args.fetchImpl,
        operation: `suite-binding:${args.offeringRef}`,
        initialResponseTimeoutMs: null,
        sleepFn: args.sleepImpl,
        onRetry: args.onRetry ?? logRetryToConsole,
      });

      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => {});
        return assembleOutcome(response.status, []);
      }
      const chunks: StreamChunk[] = [];
      for await (const c of parseWithAdapter(response.body, args.adapter)) chunks.push(c);
      return assembleOutcome(response.status, chunks);
    },
    toolResultFor(call): ReturnType<RunnerBinding['toolResultFor']> {
      return {
        role: 'tool',
        tool_call_id: call.id,
        name: call.name,
        content: JSON.stringify({ ok: true }),
      };
    },
  };
}
