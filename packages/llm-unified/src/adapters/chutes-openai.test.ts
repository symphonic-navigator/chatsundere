// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import type { ParseState } from '../adapter-contract.js';
import { chutesAdapter } from './chutes-openai.js';

const a = chutesAdapter('deepseek-ai/DeepSeek-V3.2-TEE', false);

describe('chutesAdapter buildRequest', () => {
  it('disables thinking via chat_template_kwargs (NOT reasoning_effort:none) when off', () => {
    const wire = a.buildRequest({
      messages: [{ role: 'user', content: 'hi' }],
      reasoning: { enabled: false },
    });
    expect(wire.model).toBe('deepseek-ai/DeepSeek-V3.2-TEE');
    expect(wire.body.model).toBe('deepseek-ai/DeepSeek-V3.2-TEE');
    expect(wire.body.stream).toBe(true);
    expect(wire.body.stream_options).toEqual({ include_usage: true });
    // The off switch is chat_template_kwargs.enable_thinking, not
    // reasoning_effort:'none' (which 400s Kimi-K2.6-TEE). Probed live 2026-05-30.
    expect(wire.body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect('reasoning_effort' in wire.body).toBe(false);
  });

  it('sets reasoning_effort (not chat_template_kwargs) from the intent when on', () => {
    const wire = a.buildRequest({ messages: [], reasoning: { enabled: true, effort: 'high' } });
    expect(wire.body.reasoning_effort).toBe('high');
    expect('chat_template_kwargs' in wire.body).toBe(false);
  });

  it('defaults reasoning_effort to medium when on without an explicit effort', () => {
    const wire = a.buildRequest({ messages: [], reasoning: { enabled: true } });
    expect(wire.body.reasoning_effort).toBe('medium');
  });

  it('uses the same off switch on an image turn (the case that 400d Kimi)', () => {
    const wire = a.buildRequest({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'colour?' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
          ],
        },
      ],
      reasoning: { enabled: false },
    });
    expect(wire.body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect('reasoning_effort' in wire.body).toBe(false);
  });

  it('maps tools to the OpenAI function shape, omits when empty', () => {
    const withTools = a.buildRequest({
      messages: [],
      reasoning: { enabled: false },
      tools: [
        { name: 'generate_image', description: 'make an image', parameters: { type: 'object' } },
      ],
    });
    expect(withTools.body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'generate_image',
          description: 'make an image',
          parameters: { type: 'object' },
        },
      },
    ]);
    const noTools = a.buildRequest({ messages: [], reasoning: { enabled: false }, tools: [] });
    expect(noTools.body.tools).toBeUndefined();
  });
});

describe('chutesAdapter parseChunk', () => {
  it('emits reasoning_content as reasoning and content as token', () => {
    const r = a.parseChunk(
      { choices: [{ delta: { reasoning_content: 'thinking', content: 'answer' } }] },
      {},
    );
    expect(r.events).toEqual([
      { type: 'reasoning', text: 'thinking' },
      { type: 'token', text: 'answer' },
    ]);
  });

  it('reassembles a fragmented tool call across deltas, flushing on finish', () => {
    const deltas: unknown[] = [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', function: { name: 'generate_image', arguments: '' } },
              ],
            },
          },
        ],
      },
      {
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"prompt":' } }] } }],
      },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"a cat"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ];
    let state: ParseState = {};
    const events = [];
    for (const d of deltas) {
      const res = a.parseChunk(d, state);
      state = res.state;
      events.push(...res.events);
    }
    expect(events.find((e) => e.type === 'tool-call')).toEqual({
      type: 'tool-call',
      toolCallId: 'call_1',
      name: 'generate_image',
      argumentsJson: '{"prompt":"a cat"}',
    });
    expect(events.at(-1)).toEqual({ type: 'finish', reason: 'tool_calls' });
  });

  it('normalises usage from a final choices:[] event, reading top-level reasoning_tokens', () => {
    const r = a.parseChunk(
      {
        choices: [],
        usage: {
          prompt_tokens: 14,
          completion_tokens: 9,
          total_tokens: 23,
          reasoning_tokens: 5,
          prompt_tokens_details: { cached_tokens: 4 },
        },
      },
      {},
    );
    expect(r.events).toEqual([
      {
        type: 'usage',
        usage: {
          promptTokens: 14,
          completionTokens: 9,
          totalTokens: 23,
          reasoningTokens: 5,
          cachedTokens: 4,
        },
      },
    ]);
  });

  it('ignores a null usage on the finish event', () => {
    const r = a.parseChunk({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: null }, {});
    expect(r.events).toEqual([{ type: 'finish', reason: 'stop' }]);
  });
});
