import { describe, expect, it } from 'bun:test';
import { NANO_GPT_PAIRS, type NanoGptPair, type SwitchingMode } from './_nano-gpt-pairs.js';

describe('NANO_GPT_PAIRS', () => {
  it('is a record keyed by model id', () => {
    expect(typeof NANO_GPT_PAIRS).toBe('object');
  });
  it('every entry has nonThinkingSlug and switchingMode', () => {
    for (const [, pair] of Object.entries(NANO_GPT_PAIRS)) {
      expect(typeof pair.nonThinkingSlug).toBe('string');
      expect(['slug', 'flag', 'none'] as SwitchingMode[]).toContain(pair.switchingMode);
    }
  });
  it('entries with switchingMode "none" have thinkingSlug null', () => {
    for (const [, p] of Object.entries(NANO_GPT_PAIRS)) {
      if (p.switchingMode === 'none') expect(p.thinkingSlug).toBeNull();
    }
  });
});
