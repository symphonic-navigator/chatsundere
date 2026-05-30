// SPDX-License-Identifier: LGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import type {
  KnownModel,
  NormalisedUsage,
  ReasoningCapability,
  ReasoningEffortSpec,
  StreamChunk,
} from './types.js';

describe('ReasoningCapability discriminator', () => {
  it('accepts no_reasoning kind', () => {
    const r: ReasoningCapability = {
      kind: 'no_reasoning',
      defaultOn: false,
      replayReasoning: false,
    };
    expect(r.kind).toBe('no_reasoning');
  });
  it('accepts optional + effort', () => {
    const effort: ReasoningEffortSpec = {
      buckets: ['low', 'medium', 'high'],
      defaultBucket: 'medium',
    };
    const r: ReasoningCapability = {
      kind: 'optional',
      effort,
      defaultOn: true,
      replayReasoning: false,
    };
    expect(r.effort?.defaultBucket).toBe('medium');
  });
  it('accepts always_on without effort', () => {
    const r: ReasoningCapability = { kind: 'always_on', defaultOn: true, replayReasoning: true };
    expect(r.kind).toBe('always_on');
  });

  it('accepts always_on with effort buckets', () => {
    const r: ReasoningCapability = {
      kind: 'always_on',
      effort: { buckets: ['medium', 'high'], defaultBucket: 'medium' },
      defaultOn: true,
      replayReasoning: true,
    };
    expect(r.effort?.buckets).toHaveLength(2);
  });

  it('accepts optional without effort (on/off only)', () => {
    const r: ReasoningCapability = { kind: 'optional', defaultOn: false, replayReasoning: false };
    expect(r.kind).toBe('optional');
    expect(r.effort).toBeUndefined();
  });
});

describe('KnownModel shape', () => {
  it('has contextWindow + reasoning + vision + tools fields', () => {
    const m: KnownModel = {
      id: 'x',
      displayName: 'X',
      contextWindow: 1000,
      reasoning: { kind: 'no_reasoning', defaultOn: false, replayReasoning: false },
      vision: false,
      tools: false,
    };
    expect(m.contextWindow).toBe(1000);
  });
});

describe('StreamChunk variants', () => {
  it('StreamChunk accepts a reasoning variant with text payload', () => {
    const chunk = { type: 'reasoning' as const, text: 'let me think …' } satisfies StreamChunk;
    expect(chunk.type).toBe('reasoning');
    expect(chunk.text).toBe('let me think …');
  });

  it('StreamChunk accepts a usage variant', () => {
    const chunk = {
      type: 'usage' as const,
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } satisfies NormalisedUsage,
    } satisfies StreamChunk;
    expect(chunk.usage.totalTokens).toBe(3);
  });
});
