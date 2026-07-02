// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { deriveClientIp } from '../src/net/client-ip.js';

describe('deriveClientIp', () => {
  test('one trusted hop takes the right-most XFF entry', () => {
    // attacker spoofs the left; Traefik appended the real IP on the right
    expect(deriveClientIp('9.9.9.9, 8.8.8.8, 203.0.113.7', '10.0.0.1', 1)).toBe('203.0.113.7');
  });
  test('a spoofed value further left cannot change the key', () => {
    expect(deriveClientIp('evil, evil, 203.0.113.7', '10.0.0.1', 1)).toBe('203.0.113.7');
  });
  test('no XFF falls back to the direct socket IP', () => {
    expect(deriveClientIp(null, '203.0.113.9', 1)).toBe('203.0.113.9');
  });
  test('trustHops 0 always uses the direct IP', () => {
    expect(deriveClientIp('1.2.3.4', '203.0.113.9', 0)).toBe('203.0.113.9');
  });
});
