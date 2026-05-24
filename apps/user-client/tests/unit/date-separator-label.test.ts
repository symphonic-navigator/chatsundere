import { describe, expect, it } from 'vitest';
import { formatDateSepLabel } from '../../src/lib/date-separator-label';

describe('formatDateSepLabel', () => {
  const now = new Date('2026-05-24T14:00:00');

  it('returns "Today" for same day', () => {
    const same = new Date('2026-05-24T08:00:00');
    expect(formatDateSepLabel(same, now)).toBe('Today');
  });

  it('returns "Yesterday" for previous day', () => {
    const yest = new Date('2026-05-23T22:00:00');
    expect(formatDateSepLabel(yest, now)).toBe('Yesterday');
  });

  it('returns "D MMM YYYY" for older dates', () => {
    const old = new Date('2026-04-12T09:00:00');
    expect(formatDateSepLabel(old, now)).toBe('12 Apr 2026');
  });

  it('returns "D MMM YYYY" for dates more than a day old but in same week', () => {
    const recent = new Date('2026-05-20T09:00:00');
    expect(formatDateSepLabel(recent, now)).toBe('20 May 2026');
  });
});
