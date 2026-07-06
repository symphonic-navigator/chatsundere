// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { type TargetError, parseTarget, pinnedFetch, resolveAndPin } from '../src/egress/target.js';

describe('parseTarget', () => {
  test('accepts a clean https origin', () => {
    expect(parseTarget('https://api.x.ai')).toEqual({
      origin: 'https://api.x.ai',
      host: 'api.x.ai',
      hostname: 'api.x.ai',
      port: '',
      protocol: 'https:',
    });
  });
  test('preserves an explicit non-default port (self-hosted endpoint)', () => {
    expect(parseTarget('https://example.com:8443')).toEqual({
      origin: 'https://example.com:8443',
      host: 'example.com:8443', // Host header keeps the port
      hostname: 'example.com', // DNS + SNI use the bare hostname
      port: '8443', // connection URL pins this port
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

describe('pinnedFetch port handling', () => {
  test('connects to the target on its explicit non-default port', async () => {
    // A local server on an ephemeral port echoes back the port it was reached
    // on. Before the fix, pinnedFetch dropped the port and connected on 80,
    // which would fail to reach this server at all.
    const server = Bun.serve({ port: 0, fetch: (req) => new Response(new URL(req.url).port) });
    try {
      const target = parseTarget(`http://example.com:${server.port}`);
      const res = await pinnedFetch(
        '127.0.0.1',
        target,
        new URL('http://placeholder/'),
        'GET',
        new Headers(),
        undefined,
      );
      expect(await res.text()).toBe(String(server.port));
    } finally {
      server.stop(true);
    }
  });
});
