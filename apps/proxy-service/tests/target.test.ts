// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { type TargetError, parseTarget, resolveAndPin } from '../src/egress/target.js';

describe('parseTarget', () => {
  test('accepts a clean https origin', () => {
    expect(parseTarget('https://api.x.ai')).toEqual({
      origin: 'https://api.x.ai',
      host: 'api.x.ai',
      protocol: 'https:',
    });
  });
  test('accepts http (self-hosted MCP)', () => {
    expect(parseTarget('http://mcp.local.example').protocol).toBe('http:');
  });
  test.each([
    'ftp://api.x.ai', // bad scheme
    'https://user:pass@api.x.ai', // userinfo
    'https://api.x.ai/v1/chat', // path in target
    'https://api.x.ai?x=1', // query in target
    'not-a-url',
  ])('rejects %s with 400', (raw) => {
    try {
      parseTarget(raw);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as TargetError).status).toBe(400);
    }
  });
});

describe('resolveAndPin', () => {
  test('a host that resolves only to a public IP returns an IP', async () => {
    const ip = await resolveAndPin('example.com');
    expect(ip).toMatch(/\d+\.\d+\.\d+\.\d+|:/);
  });
  test('localhost is blocked with 403', async () => {
    try {
      await resolveAndPin('localhost');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as TargetError).status).toBe(403);
    }
  });
});
