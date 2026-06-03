// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import type { ReasoningControl } from '../catalogue/types.js';
import { ollamaNativeAdapter } from './ollama-native.js';

const FIXED_ON: ReasoningControl = { mode: 'fixed-on' };
const adapter = ollamaNativeAdapter('glm-5.1', { vision: false, reasoning: FIXED_ON });

describe('ollamaNativeAdapter.buildRequest', () => {
  it('targets /api/chat with native NDJSON framing', () => {
    const wire = adapter.buildRequest({ messages: [], reasoning: { enabled: true } });
    expect(wire.path).toBe('/api/chat');
    expect(adapter.responseFraming).toBe('ndjson');
    expect(wire.body.model).toBe('glm-5.1');
    expect(wire.body.stream).toBe(true);
    expect(wire.body.think).toBe(true);
  });

  it('translates an assistant tool_call to native shape (arguments as object, no id)', () => {
    const wire = adapter.buildRequest({
      reasoning: { enabled: true },
      messages: [
        {
          role: 'assistant',
          content: 'one moment',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'web_search', arguments: '{"query":"x"}' },
            },
          ],
        },
        { role: 'tool', content: 'results', tool_call_id: 'call_1' },
      ],
    });
    const msgs = wire.body.messages as Array<Record<string, unknown>>;
    expect(msgs[0]).toEqual({
      role: 'assistant',
      content: 'one moment',
      tool_calls: [{ function: { name: 'web_search', arguments: { query: 'x' } } }],
    });
    expect(msgs[1]).toEqual({ role: 'tool', content: 'results', tool_call_id: 'call_1' });
  });

  it('emits native function tools when provided', () => {
    const wire = adapter.buildRequest({
      reasoning: { enabled: true },
      messages: [],
      tools: [{ name: 'web_search', description: 'Search.', parameters: { type: 'object' } }],
    });
    expect(wire.body.tools).toEqual([
      {
        type: 'function',
        function: { name: 'web_search', description: 'Search.', parameters: { type: 'object' } },
      },
    ]);
  });

  it('splits multimodal content into text + raw base64 images', () => {
    const wire = adapter.buildRequest({
      reasoning: { enabled: false },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is this?' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
          ],
        },
      ],
    });
    const msgs = wire.body.messages as Array<Record<string, unknown>>;
    expect(msgs[0]).toEqual({ role: 'user', content: 'what is this?', images: ['QUJD'] });
  });
});

describe('ollamaNativeAdapter.parseChunk', () => {
  it('maps content, thinking and an atomic tool call', () => {
    const { events } = adapter.parseChunk(
      {
        message: {
          content: 'hi',
          thinking: 'pondering',
          tool_calls: [
            { id: 'call_9', function: { name: 'web_search', arguments: { query: 'eis' } } },
          ],
        },
      },
      {},
    );
    expect(events).toEqual([
      { type: 'reasoning', text: 'pondering' },
      { type: 'token', text: 'hi' },
      {
        type: 'tool-call',
        toolCallId: 'call_9',
        name: 'web_search',
        argumentsJson: '{"query":"eis"}',
      },
    ]);
  });

  it('emits usage + finish on the terminal done chunk', () => {
    const { events } = adapter.parseChunk(
      {
        message: { content: '' },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 14,
        eval_count: 10,
      },
      {},
    );
    expect(events).toEqual([
      { type: 'usage', usage: { promptTokens: 14, completionTokens: 10, totalTokens: 24 } },
      { type: 'finish', reason: 'stop' },
    ]);
  });

  it('synthesises a tool-call id when the chunk omits one', () => {
    const { events } = adapter.parseChunk(
      { message: { tool_calls: [{ function: { name: 'calc', arguments: {} } }] } },
      {},
    );
    expect(events[0]).toMatchObject({ type: 'tool-call', name: 'calc', toolCallId: 'call_calc_0' });
  });
});
