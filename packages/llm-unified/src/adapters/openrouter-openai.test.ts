import { describe, expect, it } from 'bun:test';
import type { CanonicalRequest } from '../adapter-contract.js';
import type { ReasoningControl } from '../catalogue/types.js';
import { openRouterAdapter } from './openrouter-openai.js';

const base: CanonicalRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  reasoning: { enabled: true, effort: 'low' },
};

const TOGGLE: ReasoningControl = { mode: 'toggle', defaultOn: true };
const MANDATORY_STEPS: ReasoningControl = {
  mode: 'steps',
  steps: ['low', 'medium', 'high'],
  offStep: null,
  defaultStep: 'low',
};

describe('openRouterAdapter reasoning steering', () => {
  it('emits a genuine off for a route that has one', () => {
    const a = openRouterAdapter('z-ai/glm-5', { vision: false, reasoning: TOGGLE });
    expect(a.buildRequest({ ...base, reasoning: { enabled: false } }).body.reasoning).toEqual({
      enabled: false,
    });
  });

  // Grok 4.5 answers `{enabled:false}` with HTTP 400 "Reasoning is mandatory for
  // this endpoint and cannot be disabled" (probed live 2026-07-15). A control
  // with no off step must therefore never produce the off branch.
  it('never disables reasoning on a steps route with no off step', () => {
    const a = openRouterAdapter('x-ai/grok-4.5', { vision: true, reasoning: MANDATORY_STEPS });
    expect(a.buildRequest({ ...base, reasoning: { enabled: false } }).body.reasoning).toEqual({
      enabled: true,
      effort: 'medium',
    });
  });

  it('never disables reasoning on a fixed-on route', () => {
    const a = openRouterAdapter('x-ai/grok-4.5', {
      vision: true,
      reasoning: { mode: 'fixed-on' },
    });
    expect(a.buildRequest({ ...base, reasoning: { enabled: false } }).body.reasoning).toEqual({
      enabled: true,
      effort: 'medium',
    });
  });

  it('sends no reasoning param at all for a non-reasoning offering', () => {
    const a = openRouterAdapter('openai/gpt-4o', { vision: true, reasoning: { mode: 'none' } });
    expect(
      a.buildRequest({ ...base, reasoning: { enabled: false } }).body.reasoning,
    ).toBeUndefined();
  });

  it('enforces ZDR on the wire only when the offering claims it', () => {
    const zdr = openRouterAdapter('x-ai/grok-4.5', {
      vision: true,
      reasoning: MANDATORY_STEPS,
      zdr: true,
    });
    expect(zdr.buildRequest(base).body.provider).toEqual({ zdr: true });
    const plain = openRouterAdapter('z-ai/glm-5', { vision: false, reasoning: TOGGLE });
    expect(plain.buildRequest(base).body.provider).toBeUndefined();
  });

  // include_reasoning is opt-in per offering; on a mandatory route it must ride
  // along even when the caller's intent says disabled, since reasoning happens.
  it('emits include_reasoning whenever reasoning is actually on', () => {
    const a = openRouterAdapter('x-ai/grok-4.5', {
      vision: true,
      reasoning: MANDATORY_STEPS,
      includeReasoning: true,
    });
    expect(a.buildRequest({ ...base, reasoning: { enabled: false } }).body.include_reasoning).toBe(
      true,
    );
  });
});
