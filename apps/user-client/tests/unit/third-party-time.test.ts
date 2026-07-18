// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { chatGptSecondsToMs, parseGrokTimestamp } from '../../src/lib/third-party-import/time.js';

describe('chatGptSecondsToMs', () => {
  it('converts float unix seconds to ms', () => {
    expect(chatGptSecondsToMs(1721300000.5)).toBe(1721300000500);
  });
  it('returns null for non-numbers', () => {
    expect(chatGptSecondsToMs('1721300000')).toBeNull();
    expect(chatGptSecondsToMs(null)).toBeNull();
    expect(chatGptSecondsToMs(Number.NaN)).toBeNull();
  });
});

describe('parseGrokTimestamp', () => {
  it('accepts epoch milliseconds as a number', () => {
    expect(parseGrokTimestamp(1721300000000)).toBe(1721300000000);
  });
  it('accepts ISO-8601 strings', () => {
    expect(parseGrokTimestamp('2026-07-18T12:00:00.000Z')).toBe(
      Date.parse('2026-07-18T12:00:00.000Z'),
    );
  });
  it('accepts numeric strings as epoch ms', () => {
    expect(parseGrokTimestamp('1721300000000')).toBe(1721300000000);
  });
  it('accepts Mongo $date string notation', () => {
    expect(parseGrokTimestamp({ $date: '2026-07-18T12:00:00.000Z' })).toBe(
      Date.parse('2026-07-18T12:00:00.000Z'),
    );
  });
  it('accepts Mongo $date/$numberLong notation', () => {
    expect(parseGrokTimestamp({ $date: { $numberLong: '1721300000000' } })).toBe(1721300000000);
    expect(parseGrokTimestamp({ $date: { $numberLong: 1721300000000 } })).toBe(1721300000000);
  });
  it('returns null for garbage', () => {
    expect(parseGrokTimestamp(undefined)).toBeNull();
    expect(parseGrokTimestamp('not a date')).toBeNull();
    expect(parseGrokTimestamp({})).toBeNull();
  });
});
