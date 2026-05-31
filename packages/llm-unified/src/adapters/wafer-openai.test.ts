// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import type { CanonicalRequest, ParseState } from '../adapter-contract.js';
import type { ReasoningControl } from '../catalogue/types.js';
import { waferAdapter } from './wafer-openai.js';

const TOGGLE: ReasoningControl = { mode: 'toggle', defaultOn: true };
const NONE: ReasoningControl = { mode: 'none' };

function req(partial: Partial<CanonicalRequest>): CanonicalRequest {
  return {
    messages: [{ role: 'user', content: 'hi' }],
    reasoning: { enabled: false },
    ...partial,
  };
}

describe('waferAdapter.buildRequest', () => {
  test('ZDR offering sends the Wafer-ZDR header; reasoning-on emits reasoning_effort', () => {
    const a = waferAdapter('GLM-5.1', { vision: false, zdr: true, reasoning: TOGGLE });
    const wire = a.buildRequest(req({ reasoning: { enabled: true, effort: 'high' } }));
    expect(wire.model).toBe('GLM-5.1');
    expect(wire.headers).toEqual({ 'Wafer-ZDR': 'required' });
    expect(wire.body.reasoning_effort).toBe('high');
    expect(wire.body.stream).toBe(true);
    expect(wire.body.stream_options).toEqual({ include_usage: true });
  });

  test('reasoning-on without an explicit effort defaults to medium', () => {
    const a = waferAdapter('GLM-5.1', { vision: false, zdr: true, reasoning: TOGGLE });
    const wire = a.buildRequest(req({ reasoning: { enabled: true } }));
    expect(wire.body.reasoning_effort).toBe('medium');
  });

  test('reasoning-off emits reasoning_effort:none', () => {
    const a = waferAdapter('GLM-5.1', { vision: false, zdr: true, reasoning: TOGGLE });
    const wire = a.buildRequest(req({ reasoning: { enabled: false } }));
    expect(wire.body.reasoning_effort).toBe('none');
  });

  test('a none-mode offering never emits reasoning_effort', () => {
    // Models the adapter's mode:'none' path. (No wafer offering currently uses
    // it — Qwen3.5 turned out to reason despite /models claiming otherwise — but
    // the path must stay correct for any genuinely non-reasoning model.)
    const a = waferAdapter('some/non-reasoning-model', {
      vision: true,
      zdr: true,
      reasoning: NONE,
    });
    const on = a.buildRequest(req({ reasoning: { enabled: true, effort: 'high' } }));
    const off = a.buildRequest(req({ reasoning: { enabled: false } }));
    expect(on.body.reasoning_effort).toBeUndefined();
    expect(off.body.reasoning_effort).toBeUndefined();
    // still ZDR-capable, so the header is present
    expect(on.headers).toEqual({ 'Wafer-ZDR': 'required' });
  });

  test('a non-ZDR offering sends no Wafer-ZDR header', () => {
    const a = waferAdapter('deepseek-v4-flash', { vision: false, zdr: false, reasoning: TOGGLE });
    const wire = a.buildRequest(req({ reasoning: { enabled: true } }));
    expect(wire.headers).toBeUndefined();
  });

  test('tools are mapped into the OpenAI function shape', () => {
    const a = waferAdapter('GLM-5.1', { vision: false, zdr: true, reasoning: TOGGLE });
    const wire = a.buildRequest(
      req({
        tools: [
          { name: 'generate_image', description: 'make an image', parameters: { type: 'object' } },
        ],
      }),
    );
    expect(wire.body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'generate_image',
          description: 'make an image',
          parameters: { type: 'object' },
        },
      },
    ]);
  });

  test('adapter profile mirrors the supplied reasoning control and vision', () => {
    const a = waferAdapter('Kimi-K2.6', { vision: true, zdr: true, reasoning: TOGGLE });
    expect(a.profile.reasoning).toEqual(TOGGLE);
    expect(a.profile.vision).toBe(true);
    expect(a.profile.replayReasoning).toBe(false);
  });
});

describe('waferAdapter.parseChunk', () => {
  const a = waferAdapter('GLM-5.1', { vision: false, zdr: true, reasoning: TOGGLE });

  test('reasoning_content and content deltas map to reasoning/token events', () => {
    const state: ParseState = {};
    const r1 = a.parseChunk({ choices: [{ delta: { reasoning_content: 'think' } }] }, state);
    expect(r1.events).toEqual([{ type: 'reasoning', text: 'think' }]);
    const r2 = a.parseChunk({ choices: [{ delta: { content: 'PONG' } }] }, r1.state);
    expect(r2.events).toEqual([{ type: 'token', text: 'PONG' }]);
  });

  test('fragmented tool call is reassembled and emitted on finish', () => {
    const state: ParseState = {};
    a.parseChunk(
      {
        choices: [
          { delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'generate_image' } }] } },
        ],
      },
      state,
    );
    a.parseChunk(
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":' } }] } }] },
      state,
    );
    a.parseChunk(
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] } }] },
      state,
    );
    const fin = a.parseChunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }, state);
    expect(fin.events).toEqual([
      { type: 'tool-call', toolCallId: 'c1', name: 'generate_image', argumentsJson: '{"a":1}' },
      { type: 'finish', reason: 'tool_calls' },
    ]);
  });

  test('usage uses completion_tokens_details.reasoning_tokens and cached prompt tokens', () => {
    const state: ParseState = {};
    const r = a.parseChunk(
      {
        choices: [],
        usage: {
          prompt_tokens: 13,
          completion_tokens: 96,
          total_tokens: 109,
          prompt_tokens_details: { cached_tokens: 5 },
          completion_tokens_details: { reasoning_tokens: 93 },
        },
      },
      state,
    );
    expect(r.events).toEqual([
      {
        type: 'usage',
        usage: {
          promptTokens: 13,
          completionTokens: 96,
          totalTokens: 109,
          reasoningTokens: 93,
          cachedTokens: 5,
        },
      },
    ]);
  });
});
