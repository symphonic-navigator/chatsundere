import { describe, expect, it } from 'bun:test';
import { conservativeProfile } from './adapter-contract.js';

describe('conservativeProfile', () => {
  it('defaults unknown capabilities to the safest, least-breaking choice', () => {
    const p = conservativeProfile({ contextWindow: 200_000, toolsSupported: true });
    expect(p.confidence).toBe('heuristic');
    expect(p.toolCalls.streaming).toBe(false); // assume block — never break a request
    expect(p.toolCalls.concurrentWithReasoning).toBe(false); // assume legacy limitation
    expect(p.reasoning.kind).toBe('always_on'); // hidden-reasoning safe default
    expect(p.vision).toBe(false);
  });
});
