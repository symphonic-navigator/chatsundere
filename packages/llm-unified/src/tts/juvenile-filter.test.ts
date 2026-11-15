// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { isJuvenileVoice } from './juvenile-filter.js';

describe('isJuvenileVoice', () => {
  const juvenile: Array<[string, string?]> = [
    ['Munni - Animated Kid Character'],
    ['Isabel - Soft Spoken Teen'],
    ['TEEN-Spirit'],
    ['Baby Doll'],
    ['Kinderstimme Lea'],
    ['schulmädchen'],
    ['Plain Name', 'a little girl voice'],
  ];
  const adult: Array<[string, string?]> = [
    ['Jessica - Playful, Bright, Warm'],
    ['Sweet girl next door'],
    ['Young and confident'],
    ['Kind & Warm'],
    ['Kidd Rock'],
  ];

  for (const [name, description] of juvenile) {
    test(`flags ${name}`, () => {
      expect(isJuvenileVoice({ name, description })).toBe(true);
    });
  }
  for (const [name, description] of adult) {
    test(`keeps ${name}`, () => {
      expect(isJuvenileVoice({ name, description })).toBe(false);
    });
  }

  test('checks the descriptive label', () => {
    expect(isJuvenileVoice({ name: 'Lea', descriptive: 'childish' })).toBe(true);
    expect(isJuvenileVoice({ name: 'Lea', descriptive: 'warm' })).toBe(false);
  });
});
