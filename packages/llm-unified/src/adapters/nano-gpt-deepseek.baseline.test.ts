// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import type { ParseState } from '../adapter-contract.js';
import { deepseekBaselineAdapter as a } from './nano-gpt-deepseek.baseline.js';

describe('baseline buildRequest', () => {
  it('swaps to the :thinking slug when reasoning is enabled', () => {
    const wire = a.buildRequest({
      messages: [{ role: 'user', content: 'hi' }],
      reasoning: { enabled: true, effort: 'high' },
    });
    expect(wire.model).toBe('deepseek/deepseek-v4-pro:thinking');
    expect(wire.body.reasoning_effort).toBe('high');
    expect(wire.body.stream).toBe(true);
  });

  it('uses the bare slug and omits effort when reasoning is disabled', () => {
    const wire = a.buildRequest({
      messages: [{ role: 'user', content: 'hi' }],
      reasoning: { enabled: false },
    });
    expect(wire.model).toBe('deepseek/deepseek-v4-pro');
    expect(wire.body.reasoning_effort).toBeUndefined();
  });

  it('maps tools to OpenAI function shape when present, and omits them otherwise', () => {
    const withTools = a.buildRequest({
      messages: [{ role: 'user', content: 'hi' }],
      reasoning: { enabled: false },
      tools: [
        { name: 'get_weather', description: 'Weather for a city.', parameters: { type: 'object' } },
      ],
    });
    expect(withTools.body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Weather for a city.',
          parameters: { type: 'object' },
        },
      },
    ]);

    const withoutTools = a.buildRequest({
      messages: [{ role: 'user', content: 'hi' }],
      reasoning: { enabled: false },
      tools: [],
    });
    expect(withoutTools.body.tools).toBeUndefined();
  });
});

describe('baseline parseChunk reassembles a fragmented streamed tool call', () => {
  it('emits one complete tool-call after arguments arrive across deltas', () => {
    const deltas: unknown[] = [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '' } },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Wien"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ];
    let state: ParseState = {};
    const events = [];
    for (const d of deltas) {
      const r = a.parseChunk(d, state);
      state = r.state;
      events.push(...r.events);
    }
    const toolCall = events.find((e) => e.type === 'tool-call');
    expect(toolCall).toEqual({
      type: 'tool-call',
      toolCallId: 'call_1',
      name: 'get_weather',
      argumentsJson: '{"city":"Wien"}',
    });
    expect(events.at(-1)).toEqual({ type: 'finish', reason: 'tool_calls' });
  });

  it('emits reasoning before content within a delta', () => {
    const r = a.parseChunk(
      { choices: [{ delta: { reasoning: 'let me think', content: 'answer' } }] },
      {},
    );
    expect(r.events).toEqual([
      { type: 'reasoning', text: 'let me think' },
      { type: 'token', text: 'answer' },
    ]);
  });

  it('reads reasoning from the legacy reasoning_content field', () => {
    const r = a.parseChunk({ choices: [{ delta: { reasoning_content: 'soft-CoT thought' } }] }, {});
    expect(r.events).toEqual([{ type: 'reasoning', text: 'soft-CoT thought' }]);
  });
});
