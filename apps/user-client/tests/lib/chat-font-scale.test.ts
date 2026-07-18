import { describe, expect, it } from 'vitest';
import { chatFontScaleValue } from '../../src/lib/chat-font-scale.js';

describe('chatFontScaleValue', () => {
  it('maps each step to its multiplier', () => {
    expect(chatFontScaleValue('standard')).toBe(1);
    expect(chatFontScaleValue('large')).toBe(1.15);
    expect(chatFontScaleValue('larger')).toBe(1.3);
  });

  it("defaults an absent scale to 1 (today's baseline)", () => {
    expect(chatFontScaleValue(undefined)).toBe(1);
  });
});
