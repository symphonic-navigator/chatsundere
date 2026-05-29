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

  it('forces a large tool-call argument so streaming is observable, not a false negative', () => {
    const probes = buildProbeSuite({ thinkingSlug: 't', bareSlug: 'b' });
    const tc = probes.find((p) => p.dimension === 'tool-call');
    const tools = tc?.body.tools as Array<{ function: { name: string } }>;
    expect(tools[0]?.function.name).toBe('save_note');
    const userText = (tc?.body.messages as Array<{ content: string }>)[0]?.content ?? '';
    // The prompt must demand a long payload — a tiny argument fits one delta and
    // would read as block even on a streaming model.
    expect(userText).toMatch(/\b80 words\b/);
  });
});
