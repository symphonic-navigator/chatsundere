import { describe, expect, it } from 'bun:test';
import { buildProbeSuite } from './probe-suite.js';

describe('buildProbeSuite', () => {
  it('covers every behavioural dimension for the target', () => {
    const probes = buildProbeSuite({
      thinkingSlug: 'deepseek/deepseek-v4-pro:thinking',
      bareSlug: 'deepseek/deepseek-v4-pro',
    });
    const dims = new Set(probes.map((p) => p.dimension));
    expect(dims).toEqual(
      new Set([
        'reasoning-on',
        'reasoning-off',
        'effort-high',
        'effort-max',
        'tool-call',
        'reasoning-and-tools',
        'contradiction',
      ]),
    );
  });

  it('sends the bare slug with reasoning:false for the reasoning-off probe', () => {
    const probes = buildProbeSuite({ thinkingSlug: 't', bareSlug: 'b' });
    const off = probes.find((p) => p.dimension === 'reasoning-off');
    expect(off?.body.model).toBe('b');
    expect(off?.body.reasoning).toBe(false);
    expect(off?.body.stream).toBe(true);
  });

  it('attaches a tool schema to the tool-call probe', () => {
    const probes = buildProbeSuite({ thinkingSlug: 't', bareSlug: 'b' });
    const tc = probes.find((p) => p.dimension === 'tool-call');
    expect(Array.isArray(tc?.body.tools)).toBe(true);
  });
});
