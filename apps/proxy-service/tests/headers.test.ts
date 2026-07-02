// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { buildForwardHeaders, filterResponseHeaders } from '../src/proxy/headers.js';

describe('buildForwardHeaders', () => {
  const incoming = new Headers({
    'x-chatsundere-authorization': 'Bearer ACCOUNT',
    'x-cors-proxy-target': 'https://api.x.ai',
    authorization: 'Bearer UPSTREAM',
    'x-api-key': 'K',
    'mcp-session-id': 'S',
    'last-event-id': '42',
    'mcp-protocol-version': '2025-06-18',
    'x-title': 'custom',
    connection: 'keep-alive',
    host: 'proxy.chatsundere.me',
  });
  const out = buildForwardHeaders(incoming, 'api.x.ai');

  test('account token never forwarded', () =>
    expect(out.get('x-chatsundere-authorization')).toBeNull());
  test('proxy target header never forwarded', () =>
    expect(out.get('x-cors-proxy-target')).toBeNull());
  test('hop-by-hop stripped', () => expect(out.get('connection')).toBeNull());
  test('Host rewritten to target', () => expect(out.get('host')).toBe('api.x.ai'));
  test('upstream key forwarded', () => expect(out.get('authorization')).toBe('Bearer UPSTREAM'));
  test.each(['x-api-key', 'mcp-session-id', 'last-event-id', 'mcp-protocol-version', 'x-title'])(
    'forwards %s',
    (h) => expect(out.get(h)).not.toBeNull(),
  );
});

describe('filterResponseHeaders', () => {
  const up = new Headers({
    'content-type': 'text/event-stream',
    location: 'https://api.x.ai/v2',
    'set-cookie': 'sess=1',
    'access-control-allow-origin': '*',
    connection: 'close',
  });
  const out = filterResponseHeaders(up);
  test('keeps content-type', () => expect(out.get('content-type')).toBe('text/event-stream'));
  test('keeps Location', () => expect(out.get('location')).toBe('https://api.x.ai/v2'));
  test('drops Set-Cookie', () => expect(out.get('set-cookie')).toBeNull());
  test('drops upstream CORS', () => expect(out.get('access-control-allow-origin')).toBeNull());
  test('drops hop-by-hop', () => expect(out.get('connection')).toBeNull());
});
