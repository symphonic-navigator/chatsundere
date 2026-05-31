// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import type { CanonicalRequest, ParseState } from '../adapter-contract.js';
import type { ReasoningControl } from '../catalogue/types.js';
import { mistralAdapter } from './mistral-openai.js';

const TOGGLE: ReasoningControl = { mode: 'toggle', defaultOn: false };
const NONE: ReasoningControl = { mode: 'none' };

function req(partial: Partial<CanonicalRequest>): CanonicalRequest {
  return {
    messages: [{ role: 'user', content: 'hi' }],
    reasoning: { enabled: false },
    ...partial,
  };
}

describe('mistralAdapter.buildRequest', () => {
  test('reasoning toggle emits the binary high/none flag, never effort buckets', () => {
    const a = mistralAdapter('mistral-small-latest', { vision: true, reasoning: TOGGLE });
    // Even an explicit effort intent collapses to "high" — Mistral honours only
    // high/none (probed live 2026-05-31).
    const on = a.buildRequest(req({ reasoning: { enabled: true, effort: 'low' } }));
    expect(on.body.reasoning_effort).toBe('high');
    const off = a.buildRequest(req({ reasoning: { enabled: false } }));
    expect(off.body.reasoning_effort).toBe('none');
    expect(on.body.stream).toBe(true);
    expect(on.body.stream_options).toEqual({ include_usage: true });
  });

  test('a none-mode (Large 3) offering never emits reasoning_effort', () => {
    const a = mistralAdapter('mistral-large-latest', { vision: true, reasoning: NONE });
    const on = a.buildRequest(req({ reasoning: { enabled: true, effort: 'high' } }));
    const off = a.buildRequest(req({ reasoning: { enabled: false } }));
    expect(on.body.reasoning_effort).toBeUndefined();
    expect(off.body.reasoning_effort).toBeUndefined();
  });

  test('tools are mapped into the OpenAI function shape', () => {
    const a = mistralAdapter('mistral-small-latest', { vision: true, reasoning: TOGGLE });
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

  test('profile mirrors the supplied reasoning control and vision; soft-CoT', () => {
    const a = mistralAdapter('mistral-medium-3-5', { vision: true, reasoning: TOGGLE });
    expect(a.profile.reasoning).toEqual(TOGGLE);
    expect(a.profile.vision).toBe(true);
    expect(a.profile.replayReasoning).toBe(false);
  });
});

describe('mistralAdapter.parseChunk — polymorphic content', () => {
  const a = mistralAdapter('mistral-small-latest', { vision: true, reasoning: TOGGLE });

  test('plain-string content (reasoning off / Large 3) maps to a token event', () => {
    const state: ParseState = {};
    const r = a.parseChunk({ choices: [{ delta: { content: '91' } }] }, state);
    expect(r.events).toEqual([{ type: 'token', text: '91' }]);
  });

  test('typed-item thinking array maps to a reasoning event', () => {
    // The shape Mistral streams when reasoning is active (probed live).
    const state: ParseState = {};
    const r = a.parseChunk(
      {
        choices: [
          {
            delta: {
              content: [{ type: 'thinking', thinking: [{ type: 'text', text: 'Okay, the user' }] }],
            },
          },
        ],
      },
      state,
    );
    expect(r.events).toEqual([{ type: 'reasoning', text: 'Okay, the user' }]);
  });

  test('the thinking→text transition chunk (empty thinking + first text) splits cleanly', () => {
    // Observed live: a single chunk carries an empty `thinking:[]` item alongside
    // the first visible `text` item.
    const state: ParseState = {};
    const r = a.parseChunk(
      {
        choices: [
          {
            delta: {
              content: [
                { type: 'thinking', thinking: [] },
                { type: 'text', text: '3' },
              ],
            },
          },
        ],
      },
      state,
    );
    expect(r.events).toEqual([{ type: 'token', text: '3' }]);
  });

  test('reasoning_content is read only as a fallback (no double reasoning event)', () => {
    const state: ParseState = {};
    // When content already carries thinking, reasoning_content is NOT also emitted.
    const both = a.parseChunk(
      {
        choices: [
          {
            delta: {
              content: [{ type: 'thinking', thinking: [{ type: 'text', text: 'A' }] }],
              reasoning_content: 'A',
            },
          },
        ],
      },
      state,
    );
    expect(both.events).toEqual([{ type: 'reasoning', text: 'A' }]);
    // When content carries no thinking, reasoning_content is the source.
    const fallback = a.parseChunk({ choices: [{ delta: { reasoning_content: 'B' } }] }, state);
    expect(fallback.events).toEqual([{ type: 'reasoning', text: 'B' }]);
  });
});

describe('mistralAdapter.parseChunk — tool calls and usage', () => {
  const a = mistralAdapter('mistral-small-latest', { vision: true, reasoning: TOGGLE });

  test('single-block tool call is emitted on finish', () => {
    // Mistral delivers the whole tool call in one delta (probed live), but the
    // fragment buffer is kept for safety — exercised here as a single fragment.
    const state: ParseState = {};
    a.parseChunk(
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'cqGv3jtai',
                  function: { name: 'generate_image', arguments: '{"prompt":"a cat"}' },
                },
              ],
            },
          },
        ],
      },
      state,
    );
    const fin = a.parseChunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }, state);
    expect(fin.events).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'cqGv3jtai',
        name: 'generate_image',
        argumentsJson: '{"prompt":"a cat"}',
      },
      { type: 'finish', reason: 'tool_calls' },
    ]);
  });

  test('usage on the SAME terminal chunk as finish is emitted before the finish', () => {
    // Mistral attaches usage to the terminal `finish_reason` chunk (NOT a
    // separate choices:[] event) and reports no reasoning-token breakdown.
    const state: ParseState = {};
    const r = a.parseChunk(
      {
        choices: [{ delta: { content: '91' }, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 30,
          completion_tokens: 336,
          total_tokens: 366,
          prompt_tokens_details: { cached_tokens: 0 },
        },
      },
      state,
    );
    expect(r.events).toEqual([
      {
        type: 'usage',
        usage: { promptTokens: 30, completionTokens: 336, totalTokens: 366, cachedTokens: 0 },
      },
      { type: 'token', text: '91' },
      { type: 'finish', reason: 'stop' },
    ]);
  });
});
