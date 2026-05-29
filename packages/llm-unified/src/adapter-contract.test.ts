import { describe, expect, it } from 'bun:test';
import { conservativeProfile } from './adapter-contract.js';

describe('conservativeProfile', () => {
  it('defaults unknown capabilities to the safest, least-breaking choice', () => {
    const p = conservativeProfile({ toolsSupported: true });
    expect(p.reasoning).toEqual({ mode: 'fixed-on' });
    expect(p.toolCalls.streaming).toBe(false);
    expect(p.toolCalls.concurrentWithReasoning).toBe(false);
    expect(p.toolCalls.supported).toBe(true);
    expect(p.vision).toBe(false);
    expect(p.replayReasoning).toBe(true);
  });
});
