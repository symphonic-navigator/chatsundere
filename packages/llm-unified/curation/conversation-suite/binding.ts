// SPDX-License-Identifier: LGPL-3.0-only
import type { ModelAdapter, ToolDef } from '../../src/adapter-contract.js';
import { parseWithAdapter, parseWithAdapterNdjson } from '../../src/adapter-stream.js';
import {
  type OnRetry,
  type RetryEvent,
  formatRetryEvent,
  withStreamingRetry,
} from '../../src/retry.js';
import { buildBodyForTest } from '../../src/stream-completion.js';
import { parseOpenAiSseStream } from '../../src/streaming.js';
import { buildRequest } from '../../src/transport.js';
import type { ProviderConfig, ProviderDefinition, StreamChunk } from '../../src/types.js';
import { type RunnerBinding, assembleOutcome } from './runner.js';

/** Default retry sink for suite runs: a structured CLI line. */
const logRetryToConsole: OnRetry = (e: RetryEvent) => console.warn(formatRetryEvent(e));

export interface LiveBindingArgs {
  offeringRef: string;
  providerConfig: ProviderConfig;
  apiKey: string;
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
            path: wire.path ?? '/chat/completions',
            method: 'POST',
            body: wire.body,
            extraHeaders: wire.headers,
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
      const parse =
        args.adapter.responseFraming === 'ndjson' ? parseWithAdapterNdjson : parseWithAdapter;
      for await (const c of parse(response.body, args.adapter)) chunks.push(c);
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

export interface GenericBindingArgs {
  offeringRef: string;
  provider: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  /** The offering's upstream slug. */
  target: string;
  tools?: ToolDef[];
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  onRetry?: OnRetry;
}

/**
 * Wire the suite to a `adapter.kind === 'generic'` offering — it exercises the
 * REAL generic production path (`buildBody` for tools + `applyReasoningToBody`,
 * `parseOpenAiSseStream` for the response), not a hand-written adapter. Used to
 * verify vanilla OpenAI-compatible providers (e.g. ollama-cloud).
 */
export function makeGenericLiveBinding(args: GenericBindingArgs): RunnerBinding {
  return {
    offeringRef: args.offeringRef,
    async runTurn(messages, reasoning) {
      const body = buildBodyForTest({
        provider: args.provider,
        providerConfig: args.providerConfig,
        apiKey: args.apiKey,
        target: { slug: args.target },
        messages,
        bodyExtras: { reasoning },
        tools: args.tools,
      });

      const response = await withStreamingRetry({
        buildRequest: () =>
          buildRequest({
            provider: args.providerConfig,
            apiKey: args.apiKey,
            path: '/chat/completions',
            method: 'POST',
            body,
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
      for await (const c of parseOpenAiSseStream(response.body)) chunks.push(c);
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
