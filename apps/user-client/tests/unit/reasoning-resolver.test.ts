// SPDX-License-Identifier: AGPL-3.0-only

import type { KnownModel } from '@chatsundere/llm-unified';
import { describe, expect, it } from 'vitest';
import {
  type ReasoningState,
  initialReasoningState,
  resolveReasoningBodyExtras,
} from '../../src/lib/reasoning-resolver';

const noReason: KnownModel = {
  id: 'x',
  displayName: 'X',
  contextWindow: 1000,
  reasoning: { kind: 'no_reasoning', defaultOn: false, replayReasoning: false },
  vision: false,
  tools: false,
};

const optBucket: KnownModel = {
  id: 'y',
  displayName: 'Y',
  contextWindow: 1000,
  reasoning: {
    kind: 'optional',
    effort: { buckets: ['low', 'medium', 'high'], defaultBucket: 'medium' },
    defaultOn: true,
    replayReasoning: false,
  },
  vision: false,
  tools: false,
};

const optBool: KnownModel = {
  id: 'z',
  displayName: 'Z',
  contextWindow: 1000,
  reasoning: { kind: 'optional', defaultOn: true, replayReasoning: false },
  vision: false,
  tools: false,
};

const alwaysOnBucket: KnownModel = {
  id: 'q',
  displayName: 'Q',
  contextWindow: 1000,
  reasoning: {
    kind: 'always_on',
    effort: { buckets: ['low', 'high'], defaultBucket: 'high' },
    defaultOn: true,
    replayReasoning: true,
  },
  vision: false,
  tools: false,
};

const alwaysOnPlain: KnownModel = {
  id: 'r',
  displayName: 'R',
  contextWindow: 1000,
  reasoning: { kind: 'always_on', defaultOn: true, replayReasoning: true },
  vision: false,
  tools: false,
};

describe('resolveReasoningBodyExtras', () => {
  it('no_reasoning → empty object', () => {
    expect(resolveReasoningBodyExtras(noReason, { mode: 'off' })).toEqual({});
  });
  it('optional + bucket → reasoning_effort key', () => {
    expect(resolveReasoningBodyExtras(optBucket, { mode: 'bucket', bucket: 'high' })).toEqual({
      reasoning_effort: 'high',
    });
  });
  it('optional + effort + off → thinking false', () => {
    expect(resolveReasoningBodyExtras(optBucket, { mode: 'off' })).toEqual({ thinking: false });
  });
  it('optional bool on → thinking true', () => {
    expect(resolveReasoningBodyExtras(optBool, { mode: 'on' })).toEqual({ thinking: true });
  });
  it('optional bool off → thinking false', () => {
    expect(resolveReasoningBodyExtras(optBool, { mode: 'off' })).toEqual({ thinking: false });
  });
  it('always_on + bucket → reasoning_effort key, no off-state', () => {
    expect(resolveReasoningBodyExtras(alwaysOnBucket, { mode: 'bucket', bucket: 'low' })).toEqual({
      reasoning_effort: 'low',
    });
  });
});

describe('initialReasoningState', () => {
  it('no_reasoning → off', () => {
    expect(initialReasoningState(noReason)).toEqual({ mode: 'off' });
  });
  it('optional + effort, defaultOn → bucket at defaultBucket', () => {
    expect(initialReasoningState(optBucket)).toEqual({ mode: 'bucket', bucket: 'medium' });
  });
  it('optional bool, defaultOn → on', () => {
    expect(initialReasoningState(optBool)).toEqual({ mode: 'on' });
  });
  it('always_on plain → on', () => {
    expect(initialReasoningState(alwaysOnPlain)).toEqual({ mode: 'on' });
  });
});
