import { describe, expect, it } from 'bun:test';
import { NANO_GPT_PAIRS, type NanoGptPair, type SwitchingMode } from './_nano-gpt-pairs.js';

describe('NANO_GPT_PAIRS', () => {
  it('routes the September GLM and DeepSeek reasoning siblings by slug', () => {
    expect(NANO_GPT_PAIRS['z-ai/glm-5.3']).toEqual({
      nonThinkingSlug: 'z-ai/glm-5.3',
      thinkingSlug: 'z-ai/glm-5.3:thinking',
      switchingMode: 'slug',
    });
    expect(NANO_GPT_PAIRS['deepseek/deepseek-v4.1-flash']).toEqual({
      nonThinkingSlug: 'deepseek/deepseek-v4.1-flash',
      thinkingSlug: 'deepseek/deepseek-v4.1-flash:thinking',
      switchingMode: 'slug',
    });
  });

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
