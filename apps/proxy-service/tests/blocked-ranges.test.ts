// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { isBlockedIp } from '../src/egress/blocked-ranges.js';

describe('isBlockedIp', () => {
  test.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '192.0.0.1',
    '198.18.0.1',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
  ])('blocks IPv4 %s', (ip) => expect(isBlockedIp(ip)).toBe(true));

  test.each([
    '::1',
    'fc00::1',
    'fe80::1',
    'fec0::1',
    'ff02::1',
    '::',
    '::ffff:127.0.0.1',
    '::7f00:1',
    '64:ff9b::7f00:1',
    '2002:7f00:0001::',
  ])('blocks IPv6 %s', (ip) => expect(isBlockedIp(ip)).toBe(true));

  test.each(['1.1.1.1', '104.20.23.154', '2606:4700::1'])('allows public %s', (ip) =>
    expect(isBlockedIp(ip)).toBe(false),
  );
});
