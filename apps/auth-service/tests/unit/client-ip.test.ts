// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { deriveClientIp } from '../../src/net/client-ip.js';

describe('deriveClientIp', () => {
  it('returns the direct socket IP when trustHops is 0, ignoring any X-Forwarded-For', () => {
    expect(deriveClientIp('9.9.9.9, 8.8.8.8', '203.0.113.7', 0)).toBe('203.0.113.7');
  });

  it('returns the direct socket IP when no X-Forwarded-For header is present', () => {
    expect(deriveClientIp(null, '203.0.113.7', 1)).toBe('203.0.113.7');
  });

  it('reads the entry trustHops positions from the right for a single trusted hop', () => {
    expect(deriveClientIp('1.1.1.1, 2.2.2.2, 3.3.3.3', '10.0.0.1', 1)).toBe('3.3.3.3');
  });

  it('reads further left as trustHops grows (two trusted hops)', () => {
    expect(deriveClientIp('1.1.1.1, 2.2.2.2, 3.3.3.3', '10.0.0.1', 2)).toBe('2.2.2.2');
  });

  it('ignores client-prepended spoof entries — only the hop the trusted proxy set counts', () => {
    // Attacker prepends two fake addresses; the real front proxy appends the true peer.
    const spoofed = '9.9.9.9, 8.8.8.8, 198.51.100.42';
    expect(deriveClientIp(spoofed, '10.0.0.1', 1)).toBe('198.51.100.42');
  });

  it('falls back to the direct socket IP when trustHops exceeds the number of hops', () => {
    // Fewer forwarded entries than the operator claims to trust — never fabricate.
    expect(deriveClientIp('198.51.100.42', '10.0.0.1', 3)).toBe('10.0.0.1');
  });

  it('trims whitespace and skips empty entries', () => {
    expect(deriveClientIp('1.1.1.1, , 2.2.2.2', '10.0.0.1', 1)).toBe('2.2.2.2');
  });
});
