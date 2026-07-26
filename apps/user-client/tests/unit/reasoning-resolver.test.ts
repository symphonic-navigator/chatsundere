import type { ReasoningControl } from '@chatsundere/llm-unified';
import { describe, expect, it } from 'vitest';
import {
  initialReasoningState,
  maxReasoningIntent,
  resolveReasoningBodyExtras,
} from '../../src/lib/reasoning-resolver.js';

const NONE: ReasoningControl = { mode: 'none' };
const FIXED: ReasoningControl = { mode: 'fixed-on' };
const TOGGLE_ON: ReasoningControl = { mode: 'toggle', defaultOn: true };
const TOGGLE_OFF: ReasoningControl = { mode: 'toggle', defaultOn: false };
const STEPS: ReasoningControl = {
  mode: 'steps',
  steps: ['low', 'medium', 'high'],
  offStep: 'off',
  defaultStep: 'medium',
};

describe('initialReasoningState', () => {
  it('none → off', () => expect(initialReasoningState(NONE)).toEqual({ kind: 'off' }));
  it('fixed-on → on', () => expect(initialReasoningState(FIXED)).toEqual({ kind: 'on' }));
  it('toggle defaultOn → on', () =>
    expect(initialReasoningState(TOGGLE_ON)).toEqual({ kind: 'on' }));
  it('toggle !defaultOn → off', () =>
    expect(initialReasoningState(TOGGLE_OFF)).toEqual({ kind: 'off' }));
  it('steps → step at defaultStep', () =>
    expect(initialReasoningState(STEPS)).toEqual({ kind: 'step', step: 'medium' }));
});

describe('resolveReasoningBodyExtras', () => {
  it('none → empty', () => expect(resolveReasoningBodyExtras(NONE, { kind: 'off' })).toEqual({}));
  it('fixed-on → empty', () =>
    expect(resolveReasoningBodyExtras(FIXED, { kind: 'on' })).toEqual({}));
  it('toggle on → enabled true', () =>
    expect(resolveReasoningBodyExtras(TOGGLE_ON, { kind: 'on' })).toEqual({
      reasoning: { enabled: true },
    }));
  it('toggle off → enabled false', () =>
    expect(resolveReasoningBodyExtras(TOGGLE_ON, { kind: 'off' })).toEqual({
      reasoning: { enabled: false },
    }));
  it('steps step → enabled true + effort', () =>
    expect(resolveReasoningBodyExtras(STEPS, { kind: 'step', step: 'high' })).toEqual({
      reasoning: { enabled: true, effort: 'high' },
    }));
  it('steps off → enabled false', () =>
    expect(resolveReasoningBodyExtras(STEPS, { kind: 'off' })).toEqual({
      reasoning: { enabled: false },
    }));
  // `max` is ollama's level above `high` (GLM 5.2 on ollama-cloud). It must
  // survive as an effort — collapsing it to a bare enabled intent would send a
  // plain `think:true` and silently drop the level the user picked.
  it('steps max → enabled true + effort max', () =>
    expect(
      resolveReasoningBodyExtras(
        { mode: 'steps', steps: ['off', 'high', 'max'], offStep: 'off', defaultStep: 'high' },
        { kind: 'step', step: 'max' },
      ),
    ).toEqual({ reasoning: { enabled: true, effort: 'max' } }));
});

describe('maxReasoningIntent', () => {
  it('none → disabled', () => {
    expect(maxReasoningIntent({ mode: 'none' })).toEqual({ enabled: false });
  });
  it('fixed-on → enabled', () => {
    expect(maxReasoningIntent({ mode: 'fixed-on' })).toEqual({ enabled: true });
  });
  it('toggle → enabled', () => {
    expect(maxReasoningIntent({ mode: 'toggle', defaultOn: false })).toEqual({ enabled: true });
  });
  it('steps → highest standard effort, offStep excluded', () => {
    const c: ReasoningControl = {
      mode: 'steps',
      steps: ['none', 'low', 'medium', 'high'],
      offStep: 'none',
      defaultStep: 'low',
    };
    expect(maxReasoningIntent(c)).toEqual({ enabled: true, effort: 'high' });
  });
  it('steps with non-standard labels → bare enabled', () => {
    const c: ReasoningControl = {
      mode: 'steps',
      steps: ['quick', 'deep'],
      offStep: null,
      defaultStep: 'quick',
    };
    expect(maxReasoningIntent(c)).toEqual({ enabled: true });
  });
});
