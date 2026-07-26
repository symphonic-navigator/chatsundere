// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import type { ReasoningControl } from '../catalogue/types.js';
import { ollamaNativeAdapter } from './ollama-native.js';

const FIXED_ON: ReasoningControl = { mode: 'fixed-on' };
const adapter = ollamaNativeAdapter('glm-5.1', { vision: false, reasoning: FIXED_ON });

const STEPS: ReasoningControl = {
  mode: 'steps',
  steps: ['off', 'low', 'medium', 'high', 'max'],
  offStep: 'off',
  defaultStep: 'medium',
};
const TOGGLE: ReasoningControl = { mode: 'toggle', defaultOn: true };

describe('ollamaNativeAdapter reasoning value', () => {
  const stepped = ollamaNativeAdapter('glm-5.2:cloud', { vision: false, reasoning: STEPS });

  it('puts an effort on the wire as an ollama think level', () => {
    for (const effort of ['low', 'medium', 'high', 'max'] as const) {
      const wire = stepped.buildRequest({ messages: [], reasoning: { enabled: true, effort } });
      expect(wire.body.think).toBe(effort);
    }
  });

  it('sends a plain on when enabled without an effort', () => {
    const wire = stepped.buildRequest({ messages: [], reasoning: { enabled: true } });
    expect(wire.body.think).toBe(true);
  });

  it('sends a real off when the control offers one', () => {
    const wire = stepped.buildRequest({ messages: [], reasoning: { enabled: false } });
    expect(wire.body.think).toBe(false);
    const toggled = ollamaNativeAdapter('glm-5.1', { vision: false, reasoning: TOGGLE });
    expect(toggled.buildRequest({ messages: [], reasoning: { enabled: false } }).body.think).toBe(
      false,
    );
  });

  // The 2026-07-26 field defect: a `fixed-on` control makes the cockpit emit no
  // intent, so `composeWire` defaults to `{enabled:false}`. Once ollama made
  // `think:false` a genuine off, forwarding that verbatim silently stopped the
  // model reasoning. A control with no off must never put one on the wire.
  it('never sends an off for a control that offers none', () => {
    const fixedOn = ollamaNativeAdapter('some-model', { vision: false, reasoning: FIXED_ON });
    expect(fixedOn.buildRequest({ messages: [], reasoning: { enabled: false } }).body.think).toBe(
      true,
    );
    const noOffStep = ollamaNativeAdapter('some-model', {
      vision: false,
      reasoning: { mode: 'steps', steps: ['low', 'high'], offStep: null, defaultStep: 'low' },
    });
    expect(noOffStep.buildRequest({ messages: [], reasoning: { enabled: false } }).body.think).toBe(
      true,
    );
  });
});

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

describe('ollamaNativeAdapter mapSampling', () => {
  const adapter = ollamaNativeAdapter('glm-5.2:cloud', {
    vision: false,
    reasoning: { mode: 'fixed-on' },
  });

  it('nests temperature and renames max_tokens to num_predict', () => {
    // Ollama reads sampling ONLY under `options`; top-level keys are silently
    // ignored (measured 2026-07-17), which is why this rename is load-bearing.
    expect(adapter.mapSampling?.({ temperature: 0.3, max_tokens: 256 })).toEqual({
      options: { temperature: 0.3, num_predict: 256 },
    });
  });

  it('passes through the other documented options fields', () => {
    expect(adapter.mapSampling?.({ top_p: 0.9, seed: 42, stop: ['\n\n'] })).toEqual({
      options: { top_p: 0.9, seed: 42, stop: ['\n\n'] },
    });
  });

  it('maps only the params we deliberately send, dropping the rest', () => {
    // `frequency_penalty`/`presence_penalty` are not unmapped because ollama
    // rejects them — they are simply not among the params we choose to send.
    expect(adapter.mapSampling?.({ frequency_penalty: 1, presence_penalty: 1 })).toEqual({});
  });

  it('returns an empty fragment for empty sampling', () => {
    expect(adapter.mapSampling?.({})).toEqual({});
  });
});
