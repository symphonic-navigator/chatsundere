// SPDX-License-Identifier: AGPL-3.0-only

import type { KnownModel } from '@chatsundere/llm-unified';
import { describe, expect, it } from 'vitest';
import {
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

  it('optional + bucket → reasoning intent with effort', () => {
    expect(resolveReasoningBodyExtras(optBucket, { mode: 'bucket', bucket: 'high' })).toEqual({
      reasoning: { enabled: true, effort: 'high' },
    });
  });

  it('optional + effort + off → reasoning intent disabled', () => {
    expect(resolveReasoningBodyExtras(optBucket, { mode: 'off' })).toEqual({
      reasoning: { enabled: false },
    });
  });

  it('optional bool on → reasoning intent enabled', () => {
    expect(resolveReasoningBodyExtras(optBool, { mode: 'on' })).toEqual({
      reasoning: { enabled: true },
    });
  });

  it('optional bool off → reasoning intent disabled', () => {
    expect(resolveReasoningBodyExtras(optBool, { mode: 'off' })).toEqual({
      reasoning: { enabled: false },
    });
  });

  it('always_on + bucket → empty (no toggling possible on always_on)', () => {
    expect(resolveReasoningBodyExtras(alwaysOnBucket, { mode: 'bucket', bucket: 'low' })).toEqual(
      {},
    );
  });

  // Phase-4 ReasoningIntent migration — these four cases use the new flat
  // `{ mode, effort? }` cockpit state shape and assert the resolver emits
  // the canonical `{ reasoning: ReasoningIntent }` extras the engine layer
  // and per-provider `applyReasoningToBody` consume.

  it('produces { reasoning: ReasoningIntent } in extras for capability-optional models with effort', () => {
    const model = {
      reasoning: { kind: 'optional', defaultOn: true, replayReasoning: false },
    } as unknown as KnownModel;
    const extras = resolveReasoningBodyExtras(model, { mode: 'on', effort: 'medium' });
    expect(extras.reasoning).toEqual({ enabled: true, effort: 'medium' });
  });

  it('produces { reasoning: { enabled: false } } when mode is off', () => {
    const model = {
      reasoning: { kind: 'optional', defaultOn: true, replayReasoning: false },
    } as unknown as KnownModel;
    const extras = resolveReasoningBodyExtras(model, { mode: 'off' });
    expect(extras.reasoning).toEqual({ enabled: false });
  });

  it('omits reasoning entirely for no_reasoning models', () => {
    const model = {
      reasoning: { kind: 'no_reasoning', defaultOn: false, replayReasoning: false },
    } as unknown as KnownModel;
    const extras = resolveReasoningBodyExtras(model, { mode: 'off' });
    expect(extras).not.toHaveProperty('reasoning');
  });

  it('omits reasoning entirely for always_on models', () => {
    const model = {
      reasoning: { kind: 'always_on', defaultOn: true, replayReasoning: false },
    } as unknown as KnownModel;
    const extras = resolveReasoningBodyExtras(model, { mode: 'on' });
    expect(extras).not.toHaveProperty('reasoning');
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
