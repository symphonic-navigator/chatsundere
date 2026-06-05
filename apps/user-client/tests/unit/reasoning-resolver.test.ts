import type { ReasoningControl } from '@chatsundere/llm-unified';
import { describe, expect, it } from 'vitest';
import {
  initialReasoningState,
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
});
