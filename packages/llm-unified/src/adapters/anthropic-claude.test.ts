// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import type { CanonicalRequest, ParseState } from '../adapter-contract.js';
import type { ReasoningControl } from '../catalogue/types.js';
import type { WireContentPart, WireMessage } from '../types.js';
import { claudeAdapter, claudeEffortAdapter } from './anthropic-claude.js';

const TOGGLE: ReasoningControl = { mode: 'toggle', defaultOn: true };

const FABLE_STEPS: ReasoningControl = {
  mode: 'steps',
  steps: ['off', 'low', 'medium', 'high'],
  offStep: 'off',
  defaultStep: 'medium',
};

const OPTS = {
  vision: true,
  reasoning: TOGGLE,
  thinkingSlug: 'anthropic/claude-opus-4.8:thinking',
};

function req(partial: Partial<CanonicalRequest>): CanonicalRequest {
  return {
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ],
    reasoning: { enabled: false },
    ...partial,
  };
}

describe('claudeAdapter.buildRequest', () => {
  it('uses the base slug with reasoning off and streams with usage', () => {
    const wire = claudeAdapter('anthropic/claude-opus-4.8', OPTS).buildRequest(req({}));
    expect(wire.model).toBe('anthropic/claude-opus-4.8');
    expect(wire.body.model).toBe('anthropic/claude-opus-4.8');
    expect(wire.body.stream).toBe(true);
    expect(wire.body.stream_options).toEqual({ include_usage: true });
  });

  it('swaps to the thinking slug with reasoning on', () => {
    const wire = claudeAdapter('anthropic/claude-opus-4.8', OPTS).buildRequest(
      req({ reasoning: { enabled: true } }),
    );
    expect(wire.model).toBe('anthropic/claude-opus-4.8:thinking');
    expect(wire.body.model).toBe('anthropic/claude-opus-4.8:thinking');
  });

  it('honours a hyphen-style thinking slug (dated nano-gpt models)', () => {
    const wire = claudeAdapter('claude-haiku-4-5-20251001', {
      vision: true,
      reasoning: TOGGLE,
      thinkingSlug: 'claude-haiku-4-5-20251001-thinking',
    }).buildRequest(req({ reasoning: { enabled: true } }));
    expect(wire.model).toBe('claude-haiku-4-5-20251001-thinking');
  });

  it('injects cache_control on the system prefix and the rolling tail', () => {
    const wire = claudeAdapter('anthropic/claude-opus-4.8', OPTS).buildRequest(req({}));
    const messages = wire.body.messages as WireMessage[];
    const sysPart = (messages[0]?.content as WireContentPart[])[0];
    const tailPart = (messages[1]?.content as WireContentPart[])[0];
    expect(sysPart?.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(tailPart?.cache_control).toEqual({ type: 'ephemeral', ttl: '5m' });
  });
});

describe('claudeAdapter.parseChunk', () => {
  const a = claudeAdapter('anthropic/claude-opus-4.8', OPTS);

  it('emits reasoning then token events (delegated to the nano-gpt parser)', () => {
    const state: ParseState = {};
    const r1 = a.parseChunk({ choices: [{ delta: { reasoning: 'thinking…' } }] }, state);
    const r2 = a.parseChunk({ choices: [{ delta: { content: 'Hi' } }] }, r1.state);
    expect(r1.events).toEqual([{ type: 'reasoning', text: 'thinking…' }]);
    expect(r2.events).toEqual([{ type: 'token', text: 'Hi' }]);
  });

  it('surfaces cached prompt tokens from usage', () => {
    const state: ParseState = {};
    const r = a.parseChunk(
      {
        usage: {
          prompt_tokens: 9000,
          completion_tokens: 5,
          prompt_tokens_details: { cached_tokens: 8800 },
        },
      },
      state,
    );
    const usage = r.events.find((e) => e.type === 'usage');
    expect(usage).toEqual({
      type: 'usage',
      usage: { promptTokens: 9000, completionTokens: 5, totalTokens: 0, cachedTokens: 8800 },
    });
  });
});

describe('claudeAdapter.profile', () => {
  it('reports the offering reasoning control and defers reasoning replay', () => {
    const a = claudeAdapter('anthropic/claude-opus-4.8', OPTS);
    expect(a.profile.reasoning).toBe(TOGGLE);
    expect(a.profile.vision).toBe(true);
    // Signature replay is deferred (spec §5.2); no replay wired today.
    expect(a.profile.replayReasoning).toBe(false);
  });
});

describe('claudeEffortAdapter.buildRequest', () => {
  const FABLE_OPTS = { vision: true, reasoning: FABLE_STEPS };
  const a = claudeEffortAdapter('anthropic/claude-fable-5', FABLE_OPTS);

  it('keeps the single slug and sends an explicit reasoning-off flag', () => {
    const wire = a.buildRequest(req({}));
    expect(wire.model).toBe('anthropic/claude-fable-5');
    expect(wire.body.model).toBe('anthropic/claude-fable-5');
    expect(wire.body.reasoning).toEqual({ enabled: false });
    expect(wire.body.stream).toBe(true);
    expect(wire.body.stream_options).toEqual({ include_usage: true });
  });

  it('sends the chosen effort with reasoning on', () => {
    const wire = a.buildRequest(req({ reasoning: { enabled: true, effort: 'high' } }));
    expect(wire.body.reasoning).toEqual({ enabled: true, effort: 'high' });
  });

  it('falls back to medium effort — enabled alone is a silent no-op upstream', () => {
    const wire = a.buildRequest(req({ reasoning: { enabled: true } }));
    expect(wire.body.reasoning).toEqual({ enabled: true, effort: 'medium' });
  });

  it('injects cache_control on the system prefix and the rolling tail', () => {
    const wire = a.buildRequest(req({}));
    const messages = wire.body.messages as WireMessage[];
    const sysPart = (messages[0]?.content as WireContentPart[])[0];
    const tailPart = (messages[1]?.content as WireContentPart[])[0];
    expect(sysPart?.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(tailPart?.cache_control).toEqual({ type: 'ephemeral', ttl: '5m' });
  });

  it('maps tool definitions into the OpenAI-compatible shape', () => {
    const wire = a.buildRequest(
      req({
        tools: [{ name: 'ping', description: 'Ping.', parameters: { type: 'object' } }],
      }),
    );
    expect(wire.body.tools).toEqual([
      {
        type: 'function',
        function: { name: 'ping', description: 'Ping.', parameters: { type: 'object' } },
      },
    ]);
  });

  it('reports the steps control and reuses the nano-gpt parser', () => {
    expect(a.profile.reasoning).toBe(FABLE_STEPS);
    expect(a.profile.replayReasoning).toBe(false);
    const r = a.parseChunk({ choices: [{ delta: { reasoning: 'hm…' } }] }, {});
    expect(r.events).toEqual([{ type: 'reasoning', text: 'hm…' }]);
  });
});
