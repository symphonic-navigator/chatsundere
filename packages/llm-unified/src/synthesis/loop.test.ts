import { describe, expect, it } from 'bun:test';
import { runSynthesisLoop } from './loop.js';
import type { Verdict } from './validate.js';

describe('runSynthesisLoop', () => {
  it('accepts on first pass and reports verified', async () => {
    const result = await runSynthesisLoop({
      generate: async () => 'export const adapter = {};',
      validate: async (): Promise<Verdict> => ({ passed: true, failures: [] }),
      maxRounds: 3,
    });
    expect(result.outcome).toBe('verified');
    expect(result.rounds).toBe(1);
  });

  it('self-repairs then falls back to heuristic after maxRounds failures', async () => {
    let calls = 0;
    const result = await runSynthesisLoop({
      generate: async () => {
        calls += 1;
        return `attempt ${calls}`;
      },
      validate: async (): Promise<Verdict> => ({ passed: false, failures: ['nope'] }),
      maxRounds: 3,
    });
    expect(result.outcome).toBe('heuristic-fallback');
    expect(calls).toBe(3);
    expect(result.rounds).toBe(3);
  });
});
