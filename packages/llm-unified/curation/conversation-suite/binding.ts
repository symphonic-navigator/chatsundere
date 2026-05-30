// SPDX-License-Identifier: LGPL-3.0-only
import type { ModelAdapter, ToolDef } from '../../src/adapter-contract.js';
import { parseWithAdapter } from '../../src/adapter-stream.js';
import {
  MAX_RETRY_ATTEMPTS,
  computeRetryDelay,
  parseRetryAfter,
  shouldRetryStatus,
} from '../../src/retry.js';
import { buildRequest } from '../../src/transport.js';
import type { ProviderConfig, StreamChunk } from '../../src/types.js';
import { type RunnerBinding, assembleOutcome } from './runner.js';

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
  const doFetch = args.fetchImpl ?? fetch;
  const sleep = args.sleepImpl ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return {
    offeringRef: args.offeringRef,
    async runTurn(messages, reasoning) {
      const wire = args.adapter.buildRequest({
        messages,
        reasoning,
        ...(args.tools && args.tools.length > 0 ? { tools: args.tools } : {}),
      });
      const request = buildRequest({
        provider: args.providerConfig,
        apiKey: args.apiKey,
        corsProxyUrl: args.corsProxyUrl ?? null,
        corsProxyKey: args.corsProxyKey ?? null,
        path: '/chat/completions',
        method: 'POST',
        body: wire.body,
      });

      let response: Response | null = null;
      for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
        response = await doFetch(request);
        if (response.ok) break;
        if (!shouldRetryStatus(response.status) || attempt >= MAX_RETRY_ATTEMPTS) break;
        const retryAfter = parseRetryAfter(response.headers);
        await response.body?.cancel().catch(() => {});
        await sleep(computeRetryDelay(attempt, retryAfter) * 1000);
      }
      if (!response) return assembleOutcome(0, []);

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
