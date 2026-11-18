// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import {
  deviceOffsetMinutes,
  messageOffsetMinutes,
  prependStamp,
  resolveTimeAwareness,
} from '../../src/lib/time-awareness.js';

const realTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = realTz;
});

describe('resolveTimeAwareness', () => {
  it('follows roleplay while unset', () => {
    expect(resolveTimeAwareness({ roleplay: false })).toBe(true);
    expect(resolveTimeAwareness({ roleplay: true })).toBe(false);
  });

  it('honours an explicit choice either way', () => {
    expect(resolveTimeAwareness({ roleplay: true, timeAwareness: true })).toBe(true);
    expect(resolveTimeAwareness({ roleplay: false, timeAwareness: false })).toBe(false);
  });
});

describe('messageOffsetMinutes', () => {
  const at = Date.parse('2026-07-01T12:00:00Z');

  it('prefers the stored offset whatever the device zone', () => {
    process.env.TZ = 'America/New_York';
    expect(messageOffsetMinutes({ createdAt: at, utcOffsetMinutes: 345 })).toBe(345);
  });

  it("falls back to the device's offset for the row's own instant", () => {
    process.env.TZ = 'Europe/Berlin';
    expect(messageOffsetMinutes({ createdAt: at })).toBe(120);
    expect(messageOffsetMinutes({ createdAt: Date.parse('2026-01-01T12:00:00Z') })).toBe(60);
  });

  it('reports a UTC device as a plain zero', () => {
    process.env.TZ = 'UTC';
    expect(Object.is(deviceOffsetMinutes(at), 0)).toBe(true);
  });
});

describe('prependStamp', () => {
  it('puts the stamp on its own line in front of string content', () => {
    expect(prependStamp('hi', '<sent>X</sent>')).toBe('<sent>X</sent>\nhi');
  });

  it('adds the stamp as a leading text part ahead of attachments', () => {
    const img = { type: 'image_url' as const, image_url: { url: 'data:x' } };
    expect(prependStamp([img, { type: 'text', text: 'look' }], '<sent>X</sent>')).toEqual([
      { type: 'text', text: '<sent>X</sent>\n' },
      img,
      { type: 'text', text: 'look' },
    ]);
  });
});
