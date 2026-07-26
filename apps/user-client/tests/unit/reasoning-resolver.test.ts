import type { ReasoningControl } from '@chatsundere/llm-unified';
import { describe, expect, it } from 'vitest';
import {
  initialReasoningState,
  maxReasoningIntent,
  reasoningChoiceOf,
  reasoningStateFromChoice,
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

describe('reasoning choice persistence', () => {
  const ladder: ReasoningControl = {
    mode: 'steps',
    steps: ['off', 'on', 'max'],
    offStep: 'off',
    defaultStep: 'on',
  };

  it('round-trips every state through a stored choice', () => {
    for (const state of [
      { kind: 'off' as const },
      { kind: 'on' as const },
      { kind: 'step' as const, step: 'max' },
    ]) {
      const stored = reasoningChoiceOf(state);
      const control = state.kind === 'on' ? ({ mode: 'toggle', defaultOn: true } as const) : ladder;
      expect(reasoningStateFromChoice(stored, control)).toEqual(state);
    }
  });

  it('falls back to the control default when nothing was stored', () => {
    expect(reasoningStateFromChoice(null, ladder)).toEqual({ kind: 'step', step: 'on' });
    expect(reasoningStateFromChoice(undefined, ladder)).toEqual({ kind: 'step', step: 'on' });
  });

  // The load-bearing case: a chat carries its stored choice across a model
  // change. `max` exists on GLM 5.2 and on nothing else, so pointing the chat at
  // another model must not resurrect a step that model has never heard of.
  it('falls back when the stored choice does not exist on the new control', () => {
    const other: ReasoningControl = {
      mode: 'steps',
      steps: ['off', 'low', 'medium', 'high'],
      offStep: 'off',
      defaultStep: 'medium',
    };
    expect(reasoningStateFromChoice('max', other)).toEqual({ kind: 'step', step: 'medium' });
    expect(reasoningStateFromChoice('nonsense', ladder)).toEqual({ kind: 'step', step: 'on' });
  });

  // A stored Off must not survive onto a model that cannot be silenced — that
  // would send an off the adapter has to refuse anyway (the Grok-4.5 guard).
  it('refuses a stored Off on a control that has no off', () => {
    expect(reasoningStateFromChoice('off', { mode: 'fixed-on' })).toEqual({ kind: 'on' });
    expect(
      reasoningStateFromChoice('off', {
        mode: 'steps',
        steps: ['low', 'high'],
        offStep: null,
        defaultStep: 'low',
      }),
    ).toEqual({ kind: 'step', step: 'low' });
  });

  it('honours a stored Off where the control offers one', () => {
    expect(reasoningStateFromChoice('off', ladder)).toEqual({ kind: 'off' });
    expect(reasoningStateFromChoice('off', { mode: 'toggle', defaultOn: true })).toEqual({
      kind: 'off',
    });
  });
});
