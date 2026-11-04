// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { Env } from '../src/env.js';
import { registerProxyRoute } from '../src/routes/proxy.js';

const env = {
  JWT_ISSUER: 'chatsundere-auth-v1',
  TRUST_PROXY_HOPS: 1,
  RATE_LIMIT_USER_PER_MIN: 120,
  RATE_LIMIT_IP_PER_MIN: 600,
  MAX_BODY_BYTES: 52428800,
  MAX_CONCURRENT_PER_USER: 6,
  CORS_ALLOWED_ORIGINS: ['https://app.chatsundere.me'],
} as unknown as Env;

function build(overrides: Partial<Parameters<typeof registerProxyRoute>[1]> = {}) {
  const app = new Hono();
  registerProxyRoute(app, {
    env,
    verifyToken: async (t: string) => {
      if (t !== 'GOOD') throw new Error('bad');
      return { sub: 'user-1' };
    },
    allow: async () => true,
    // seam: skip real DNS/fetch — echo the request the proxy built
    pinnedFetch: async (req: Request) =>
      new Response('ok', {
        status: 200,
        headers: { 'x-fwd-auth': req.headers.get('authorization') ?? '' },
      }),
    ...overrides,
  });
  return app;
}

describe('proxy route', () => {
  test('401 without a valid account token', async () => {
    const res = await build().request('/v1/chat', {
      method: 'POST',
      headers: { 'x-cors-proxy-target': 'https://api.x.ai', authorization: 'Bearer UP' },
    });
    expect(res.status).toBe(401);
  });
  test('forwards with a valid token and strips the account header', async () => {
    const res = await build().request('/v1/chat', {
      method: 'POST',
      headers: {
        'x-chatsundere-authorization': 'Bearer GOOD',
        'x-cors-proxy-target': 'https://api.x.ai',
        authorization: 'Bearer UP',
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-fwd-auth')).toBe('Bearer UP');
  });
  test('429 when the per-user limiter denies', async () => {
    const res = await build({ allow: async () => false }).request('/v1/chat', {
      method: 'POST',
      headers: {
        'x-chatsundere-authorization': 'Bearer GOOD',
        'x-cors-proxy-target': 'https://api.x.ai',
      },
    });
    expect(res.status).toBe(429);
  });
  test('OPTIONS preflight from an allowed origin echoes headers', async () => {
    const res = await build().request('/v1/chat', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://app.chatsundere.me',
        'access-control-request-headers': 'x-cors-proxy-target, authorization',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.chatsundere.me');
    expect(res.headers.get('access-control-allow-headers')).toBe(
      'x-cors-proxy-target, authorization',
    );
  });
  test('400 when the target header is missing', async () => {
    const res = await build().request('/v1/chat', {
      method: 'POST',
      headers: { 'x-chatsundere-authorization': 'Bearer GOOD' },
    });
    expect(res.status).toBe(400);
  });
  test('reflects the allowed origin on a forwarded response', async () => {
    const res = await build().request('/v1/chat', {
      method: 'POST',
      headers: {
        origin: 'https://app.chatsundere.me',
        'x-chatsundere-authorization': 'Bearer GOOD',
        'x-cors-proxy-target': 'https://api.x.ai',
      },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.chatsundere.me');
  });
  const mcpUpstream = async () =>
    new Response('unauthorised', {
      status: 401,
      headers: {
        'www-authenticate': 'Bearer resource_metadata="https://mcp.example.com/m"',
        'mcp-session-id': 'S',
      },
    });
  test('exposes WWW-Authenticate and Mcp-Session-Id on a forwarded response', async () => {
    const res = await build({ pinnedFetch: mcpUpstream }).request('/mcp', {
      method: 'POST',
      headers: {
        origin: 'https://app.chatsundere.me',
        'x-chatsundere-authorization': 'Bearer GOOD',
        'x-cors-proxy-target': 'https://mcp.example.com',
      },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata');
    expect(res.headers.get('access-control-expose-headers')).toBe(
      'Mcp-Session-Id, WWW-Authenticate',
    );
  });
  test('does not add expose headers for an unmatched origin', async () => {
    const res = await build({ pinnedFetch: mcpUpstream }).request('/mcp', {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        'x-chatsundere-authorization': 'Bearer GOOD',
        'x-cors-proxy-target': 'https://mcp.example.com',
      },
    });
    expect(res.headers.get('access-control-expose-headers')).toBeNull();
  });
});
