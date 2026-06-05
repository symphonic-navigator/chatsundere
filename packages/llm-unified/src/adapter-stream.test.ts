// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, describe, expect, test } from 'bun:test';
import type {
  CanonicalRequest,
  ModelAdapter,
  ParseState,
  WireRequest,
} from './adapter-contract.js';
import { _resetAdapterRegistryForTests, getAdapter, registerAdapter } from './adapter-registry.js';
import { parseWithAdapter } from './adapter-stream.js';
import { deepseekBaselineAdapter } from './adapters/nano-gpt-deepseek.baseline.js';
import type { StreamChunk } from './types.js';

/** Build a ReadableStream<Uint8Array> from SSE text parts (arbitrary splits). */
function streamFrom(parts: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < parts.length) controller.enqueue(enc.encode(parts[i++]));
      else controller.close();
    },
  });
}

/**
 * Fake adapter that reassembles fragmented tool-call arguments via ParseState
 * (the case the generic parser drops). Flushes the tool call on finish_reason.
 */
const fakeAdapter: ModelAdapter = {
  profile: {
    reasoning: { mode: 'none' },
    toolCalls: { supported: true, streaming: true, concurrentWithReasoning: false },
    vision: false,
    replayReasoning: false,
  },
  buildRequest(_req: CanonicalRequest): WireRequest {
    return { model: 'fake', body: {} };
  },
  parseChunk(raw: unknown, state: ParseState): { events: StreamChunk[]; state: ParseState } {
    const events: StreamChunk[] = [];
    const p = raw as {
      choices?: Array<{
        delta?: {
          tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
        };
        finish_reason?: string | null;
      }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    if (p.usage) {
      events.push({
        type: 'usage',
        usage: {
          promptTokens: p.usage.prompt_tokens,
          completionTokens: p.usage.completion_tokens,
          totalTokens: p.usage.total_tokens,
        },
      });
    }
    const choice = p.choices?.[0];
    if (!choice) return { events, state };
    const acc = (state.tc as { id: string; name: string; args: string }) ?? {
      id: '',
      name: '',
      args: '',
    };
    for (const tc of choice.delta?.tool_calls ?? []) {
      if (tc.id) acc.id = tc.id;
      if (tc.function?.name) acc.name = tc.function.name;
      if (typeof tc.function?.arguments === 'string') acc.args += tc.function.arguments;
    }
    state.tc = acc;
    if (choice.finish_reason) {
      if (acc.id && acc.name) {
        events.push({
          type: 'tool-call',
          toolCallId: acc.id,
          name: acc.name,
          argumentsJson: acc.args,
        });
      }
      state.tc = { id: '', name: '', args: '' };
      events.push({ type: 'finish', reason: 'tool_calls' });
    }
    return { events, state };
  },
};

async function collect(it: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

describe('parseWithAdapter', () => {
  test('reassembles fragmented tool-call arguments across events', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","function":{"name":"generate_image","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"{\\"prompt\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"\\"a cat\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const chunks = await collect(parseWithAdapter(streamFrom(sse), fakeAdapter));
    const toolCall = chunks.find((c) => c.type === 'tool-call');
    expect(toolCall).toEqual({
      type: 'tool-call',
      toolCallId: 'call_1',
      name: 'generate_image',
      argumentsJson: '{"prompt":"a cat"}',
    });
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: 'tool_calls' });
  });

  test('emits a usage chunk', async () => {
    const sse = [
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}\n\n',
      'data: [DONE]\n\n',
    ];
    const chunks = await collect(parseWithAdapter(streamFrom(sse), fakeAdapter));
    expect(chunks).toContainEqual({
      type: 'usage',
      usage: { promptTokens: 3, completionTokens: 4, totalTokens: 7 },
    });
  });

  test('stops at [DONE] and surfaces malformed payloads as error chunks', async () => {
    const sse = ['data: not-json\n\n', 'data: [DONE]\n\n'];
    const chunks = await collect(parseWithAdapter(streamFrom(sse), fakeAdapter));
    expect(chunks.some((c) => c.type === 'error')).toBe(true);
  });
});

// Spec §7: prove the path with a PRODUCTION adapter routed via the registry,
// not just the purpose-built fake above.
describe('parseWithAdapter via the registry (real deepseekBaselineAdapter)', () => {
  afterEach(() => _resetAdapterRegistryForTests());

  test('reassembles a fragmented tool call routed through getAdapter', async () => {
    registerAdapter('deepseek-baseline', deepseekBaselineAdapter);
    const sse = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weather","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"Wien\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const adapter = getAdapter('deepseek-baseline');
    expect(adapter).toBeDefined();
    const chunks = await collect(parseWithAdapter(streamFrom(sse), adapter as ModelAdapter));
    expect(chunks.find((c) => c.type === 'tool-call')).toEqual({
      type: 'tool-call',
      toolCallId: 'call_1',
      name: 'get_weather',
      argumentsJson: '{"city":"Wien"}',
    });
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: 'tool_calls' });
  });
});
