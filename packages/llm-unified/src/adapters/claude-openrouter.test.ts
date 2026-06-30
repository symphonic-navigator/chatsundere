// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import type { CanonicalRequest } from '../adapter-contract.js';
import type { ReasoningControl } from '../catalogue/types.js';
import type { WireContentPart, WireMessage } from '../types.js';
import { claudeOpenRouterAdapter } from './claude-openrouter.js';

const STEPS: ReasoningControl = {
  mode: 'steps',
  steps: ['off', 'low', 'medium', 'high'],
  offStep: 'off',
  defaultStep: 'medium',
};

const OPTS = { vision: true, reasoning: STEPS };

function req(
  messages: WireMessage[],
  reasoning: CanonicalRequest['reasoning'] = { enabled: false },
): CanonicalRequest {
  return { messages, reasoning };
}

/** The leading message's content parts (cache_control lands on the last part). */
function leadingParts(wire: { body: Record<string, unknown> }): WireContentPart[] {
  const messages = wire.body.messages as WireMessage[];
  const first = messages[0] as WireMessage;
  return Array.isArray(first.content) ? first.content : [];
}

describe('claudeOpenRouterAdapter.buildRequest', () => {
  const adapter = claudeOpenRouterAdapter('anthropic/claude-sonnet-5', OPTS);

  it('carries the OpenRouter shape (slug, stream, usage)', () => {
    const wire = adapter.buildRequest(req([{ role: 'user', content: 'Hi' }]));
    expect(wire.body.model).toBe('anthropic/claude-sonnet-5');
    expect(wire.body.stream).toBe(true);
    expect(wire.body.stream_options).toEqual({ include_usage: true });
  });

  it('steers reasoning via the unified object — off, then on with effort', () => {
    const off = adapter.buildRequest(req([{ role: 'user', content: 'Hi' }]));
    expect(off.body.reasoning).toEqual({ enabled: false });

    const on = adapter.buildRequest(
      req([{ role: 'user', content: 'Hi' }], { enabled: true, effort: 'high' }),
    );
    expect(on.body.reasoning).toEqual({ enabled: true, effort: 'high' });
  });

  it('exposes a steps reasoning profile', () => {
    expect(adapter.profile.reasoning).toEqual(STEPS);
    expect(adapter.profile.vision).toBe(true);
  });

  it('leaves a system-less conversation without a hoisted system message', () => {
    const wire = adapter.buildRequest(req([{ role: 'user', content: 'Hi' }]));
    const messages = wire.body.messages as WireMessage[];
    expect(messages.every((m) => m.role !== 'system')).toBe(true);
  });

  it('hoists a mid-conversation system message to the front and drops the original', () => {
    const wire = adapter.buildRequest(
      req([
        { role: 'user', content: 'Draw a cat.' },
        { role: 'assistant', content: 'Done.' },
        { role: 'system', content: 'Known fact: the user is a cat lover.' },
        { role: 'user', content: 'What do you know about me?' },
      ]),
    );
    const messages = wire.body.messages as WireMessage[];
    expect((messages[0] as WireMessage).role).toBe('system');
    // Only one system message survives, and it is the leading one.
    expect(messages.filter((m) => m.role === 'system')).toHaveLength(1);
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('merges multiple system messages into one leading message', () => {
    const wire = adapter.buildRequest(
      req([
        { role: 'system', content: 'First rule.' },
        { role: 'user', content: 'Hi' },
        { role: 'system', content: 'Second rule.' },
      ]),
    );
    const parts = leadingParts(wire);
    const text = parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
    expect(text).toContain('First rule.');
    expect(text).toContain('Second rule.');
  });

  it('injects an Anthropic cache_control breakpoint on the leading system message', () => {
    const wire = adapter.buildRequest(
      req([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi' },
      ]),
    );
    const parts = leadingParts(wire);
    const last = parts[parts.length - 1];
    expect(last?.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });
});
