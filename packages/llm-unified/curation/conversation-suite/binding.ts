// SPDX-License-Identifier: LGPL-3.0-only
import type { ModelAdapter, ToolDef } from '../../src/adapter-contract.js';
import { parseWithAdapter, parseWithAdapterNdjson } from '../../src/adapter-stream.js';
import type { CompletionTarget } from '../../src/catalogue/target.js';
import { runOneShotCompletion } from '../../src/one-shot-completion.js';
import {
  type OnRetry,
  type RetryEvent,
  formatRetryEvent,
  withStreamingRetry,
} from '../../src/retry.js';
import { UpstreamHttpError, buildBodyForTest, composeWire } from '../../src/stream-completion.js';
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
  /**
   * Sampling params in canonical OpenAI shape (e.g. `{ max_tokens: 8 }`),
   * translated by the adapter's `mapSampling`. The suite sent none until
   * 2026-07-17, which is why a provider silently ignoring a cap went unseen.
   */
  sampling?: Record<string, unknown>;
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
      // Share the production composer so the harness verifies the pipe production
      // uses rather than a reimplementation of it. The fetch stays ours: the
      // suite must capture a non-2xx status as a checkable outcome, not an
      // exception (the MiMo/chutes 400 case).
      const wire = composeWire(
        {
          messages,
          bodyExtras: { ...(args.sampling ?? {}), reasoning },
          ...(args.tools ? { tools: args.tools } : {}),
        },
        args.adapter,
      );

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

export interface OneShotBindingArgs {
  offeringRef: string;
  provider: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  target: CompletionTarget;
  sampling?: Record<string, unknown>;
  onRetry?: OnRetry;
}

/**
 * Wire the suite to the BACKGROUND-JOB path (`runOneShotCompletion`) rather than
 * the chat path. Mirrors what title generation sends. A non-2xx becomes a
 * checkable outcome (like `makeLiveBinding`), not an exception, by unwrapping
 * `UpstreamHttpError`.
 */
export function makeOneShotBinding(args: OneShotBindingArgs): RunnerBinding {
  return {
    offeringRef: args.offeringRef,
    async runTurn(messages, reasoning) {
      try {
        const text = await runOneShotCompletion({
          provider: args.provider,
          providerConfig: args.providerConfig,
          apiKey: args.apiKey,
          target: args.target,
          messages,
          bodyExtras: { ...(args.sampling ?? {}), reasoning },
          onRetry: args.onRetry ?? logRetryToConsole,
        });
        return { ...assembleOutcome(200, []), text };
      } catch (e) {
        const status = e instanceof UpstreamHttpError ? e.status : 0;
        // A non-UpstreamHttpError (ProxyRedirectError, a network TypeError, a bug)
        // collapses to status 0 below with no message of its own — log it here or
        // the operator sees only "HTTP 0 (expected 2xx)" and has to re-run to learn
        // anything.
        if (status === 0) console.error(`one-shot ${args.offeringRef} failed:`, e);
        return assembleOutcome(status, []);
      }
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
