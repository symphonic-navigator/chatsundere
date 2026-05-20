// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { formatRelative } from '../../src/lib/format.js';

const now = new Date('2026-05-20T12:00:00.000Z');

describe('formatRelative', () => {
  it('returns "Never" for null', () => {
    expect(formatRelative(null, now)).toBe('Never');
  });

  it('returns "Just now" for timestamps within 60 seconds', () => {
    const iso = new Date(now.getTime() - 30_000).toISOString();
    expect(formatRelative(iso, now)).toBe('Just now');
  });

  it('returns singular minute', () => {
    const iso = new Date(now.getTime() - 90_000).toISOString();
    expect(formatRelative(iso, now)).toBe('1 minute ago');
  });

  it('returns plural minutes', () => {
    const iso = new Date(now.getTime() - 5 * 60_000).toISOString();
    expect(formatRelative(iso, now)).toBe('5 minutes ago');
  });

  it('returns singular hour', () => {
    const iso = new Date(now.getTime() - 60 * 60_000).toISOString();
    expect(formatRelative(iso, now)).toBe('1 hour ago');
  });

  it('returns plural hours', () => {
    const iso = new Date(now.getTime() - 3 * 60 * 60_000).toISOString();
    expect(formatRelative(iso, now)).toBe('3 hours ago');
  });

  it('returns singular day', () => {
    const iso = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
    expect(formatRelative(iso, now)).toBe('1 day ago');
  });

  it('returns plural days', () => {
    const iso = new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString();
    expect(formatRelative(iso, now)).toBe('7 days ago');
  });

  it('falls back to en-GB date for timestamps older than 30 days', () => {
    const iso = new Date(now.getTime() - 31 * 24 * 60 * 60_000).toISOString();
    expect(formatRelative(iso, now)).toBe('19/04/2026');
  });
});
