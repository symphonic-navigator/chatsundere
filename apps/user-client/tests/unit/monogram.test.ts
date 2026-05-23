// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { monogramFor } from '../../src/lib/monogram.js';

describe('monogramFor', () => {
  it('takes the first two characters of a single word', () => {
    expect(monogramFor('Aurum')).toBe('AU');
  });

  it('takes the first letter of each of the first two words', () => {
    expect(monogramFor('Vincent Aldwyn')).toBe('VA');
  });

  it('uppercases the result', () => {
    expect(monogramFor('verdan')).toBe('VE');
  });

  it('handles a single character name', () => {
    expect(monogramFor('A')).toBe('A');
  });

  it('returns "??" for empty input', () => {
    expect(monogramFor('')).toBe('??');
  });

  it('trims leading/trailing whitespace', () => {
    expect(monogramFor('  Aurum  ')).toBe('AU');
  });
});
