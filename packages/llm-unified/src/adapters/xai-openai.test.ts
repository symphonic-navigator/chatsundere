import { describe, expect, it } from 'bun:test';
import type { CanonicalRequest } from '../adapter-contract.js';
import { xaiAdapter } from './xai-openai.js';

const base: CanonicalRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  reasoning: { enabled: true, effort: 'low' },
};

describe('xaiAdapter buildRequest', () => {
  it('targets the grok-4.3 slug with no swap, streaming + usage', () => {
    const wire = xaiAdapter('grok-4.3', { vision: true }).buildRequest(base);
    expect(wire.model).toBe('grok-4.3');
    expect(wire.body.model).toBe('grok-4.3');
    expect(wire.body.stream).toBe(true);
    expect(wire.body.stream_options).toEqual({ include_usage: true });
  });

  it('maps reasoning effort: off->none, on->effort, default low', () => {
    const a = xaiAdapter('grok-4.3', { vision: true });
    expect(a.buildRequest({ ...base, reasoning: { enabled: false } }).body.reasoning_effort).toBe(
      'none',
    );
    expect(
      a.buildRequest({ ...base, reasoning: { enabled: true, effort: 'high' } }).body
        .reasoning_effort,
    ).toBe('high');
    expect(a.buildRequest({ ...base, reasoning: { enabled: true } }).body.reasoning_effort).toBe(
      'low',
    );
  });

  it('emits x-grok-conv-id header only when cacheKey is set', () => {
    const a = xaiAdapter('grok-4.3', { vision: true });
    expect(a.buildRequest(base).headers).toBeUndefined();
    expect(a.buildRequest({ ...base, cacheKey: 'c1' }).headers).toEqual({ 'x-grok-conv-id': 'c1' });
  });

  it('passes tools through in OpenAI function shape', () => {
    const wire = xaiAdapter('grok-4.3', { vision: true }).buildRequest({
      ...base,
      tools: [{ name: 't', description: 'd', parameters: { type: 'object' } }],
    });
    expect(wire.body.tools).toEqual([
      {
        type: 'function',
        function: { name: 't', description: 'd', parameters: { type: 'object' } },
      },
    ]);
  });

  it('carries the steps reasoning profile with vision', () => {
    const p = xaiAdapter('grok-4.3', { vision: true }).profile;
    expect(p.reasoning).toEqual({
      mode: 'steps',
      steps: ['low', 'medium', 'high'],
      offStep: 'none',
      defaultStep: 'low',
    });
    expect(p.vision).toBe(true);
    expect(p.replayReasoning).toBe(false);
  });
});

describe('xaiAdapter parseChunk', () => {
  const a = xaiAdapter('grok-4.3', { vision: true });

  it('splits reasoning_content and content', () => {
    const r = a.parseChunk({ choices: [{ delta: { reasoning_content: 'th' } }] }, {});
    expect(r.events).toEqual([{ type: 'reasoning', text: 'th' }]);
    const c = a.parseChunk({ choices: [{ delta: { content: 'hi' } }] }, {});
    expect(c.events).toEqual([{ type: 'token', text: 'hi' }]);
  });

  it('extracts usage incl. reasoning + cached tokens', () => {
    const r = a.parseChunk(
      {
        choices: [],
        usage: {
          prompt_tokens: 163,
          completion_tokens: 64,
          total_tokens: 497,
          prompt_tokens_details: { cached_tokens: 128 },
          completion_tokens_details: { reasoning_tokens: 270 },
        },
      },
      {},
    );
    expect(r.events).toEqual([
      {
        type: 'usage',
        usage: {
          promptTokens: 163,
          completionTokens: 64,
          totalTokens: 497,
          reasoningTokens: 270,
          cachedTokens: 128,
        },
      },
    ]);
  });

  it('reassembles fragmented tool calls and emits finish', () => {
    let state = {};
    ({ state } = a.parseChunk(
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'gen' } }] } }] },
      state,
    ));
    ({ state } = a.parseChunk(
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"p":1}' } }] } }] },
      state,
    ));
    const fin = a.parseChunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }, state);
    expect(fin.events).toEqual([
      { type: 'tool-call', toolCallId: 'c', name: 'gen', argumentsJson: '{"p":1}' },
      { type: 'finish', reason: 'tool_calls' },
    ]);
  });
});
