// SPDX-License-Identifier: LGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import { formatAwayGap, formatGreetingNow, formatSentStamp } from './time-stamp.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatSentStamp', () => {
  it('renders the spec example', () => {
    expect(formatSentStamp(Date.parse('2026-11-18T20:14:00Z'), 60)).toBe(
      '<sent>Wed 18 Nov 2026, 21:14</sent>',
    );
  });

  it('applies a negative offset across a year boundary', () => {
    expect(formatSentStamp(Date.parse('2026-01-01T04:30:00Z'), -300)).toBe(
      '<sent>Wed 31 Dec 2025, 23:30</sent>',
    );
  });

  it('applies a +05:45 offset and drops the leading zero of a single-digit day', () => {
    expect(formatSentStamp(Date.parse('2026-07-05T23:15:00Z'), 345)).toBe(
      '<sent>Mon 6 Jul 2026, 05:00</sent>',
    );
  });

  it('renders either side of a DST boundary with the offset stored for each instant', () => {
    // Europe/Berlin springs forward at 01:00 UTC on 29 March 2026.
    expect(formatSentStamp(Date.parse('2026-03-29T00:59:00Z'), 60)).toBe(
      '<sent>Sun 29 Mar 2026, 01:59</sent>',
    );
    expect(formatSentStamp(Date.parse('2026-03-29T01:00:00Z'), 120)).toBe(
      '<sent>Sun 29 Mar 2026, 03:00</sent>',
    );
  });

  it('renders local midnight as 00:00', () => {
    expect(formatSentStamp(Date.parse('2026-12-31T23:30:00Z'), 30)).toBe(
      '<sent>Fri 1 Jan 2027, 00:00</sent>',
    );
  });
});

describe('formatGreetingNow', () => {
  it('renders full names and a zero-padded time', () => {
    expect(formatGreetingNow(Date.parse('2026-11-21T08:02:00Z'), 60)).toBe(
      'Saturday, 21 November 2026, 09:02',
    );
  });

  it('applies the offset with UTC arithmetic', () => {
    expect(formatGreetingNow(Date.parse('2026-01-01T04:30:00Z'), -300)).toBe(
      'Wednesday, 31 December 2025, 23:30',
    );
  });
});

describe('formatAwayGap', () => {
  it('is null under one hour', () => {
    expect(formatAwayGap(0)).toBeNull();
    expect(formatAwayGap(HOUR - 1)).toBeNull();
    expect(formatAwayGap(-DAY)).toBeNull();
  });

  it('counts whole hours under a day', () => {
    expect(formatAwayGap(HOUR)).toBe('1 hour');
    expect(formatAwayGap(2 * HOUR + 59 * MINUTE)).toBe('2 hours');
    expect(formatAwayGap(DAY - 1)).toBe('23 hours');
  });

  it('counts days under two weeks', () => {
    expect(formatAwayGap(DAY)).toBe('1 day');
    expect(formatAwayGap(2 * DAY + 5 * HOUR)).toBe('2 days');
    expect(formatAwayGap(14 * DAY - 1)).toBe('13 days');
  });

  it('counts weeks under sixty days', () => {
    expect(formatAwayGap(14 * DAY)).toBe('2 weeks');
    expect(formatAwayGap(60 * DAY - 1)).toBe('8 weeks');
  });

  it('counts months from sixty days on', () => {
    expect(formatAwayGap(60 * DAY)).toBe('2 months');
    expect(formatAwayGap(400 * DAY)).toBe('13 months');
  });
});
