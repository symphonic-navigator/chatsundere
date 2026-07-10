// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { ipKey } from '../../src/middleware/rate-limit.js';

// Builds a one-route app that echoes ipKey(c), then drives it with a given
// X-Forwarded-For header and an injected socket IP (Hono env bindings), exactly
// as index.ts supplies `{ ip }` from server.requestIP() in production.
async function resolveIpKey(opts: {
  xForwardedFor?: string;
  socketIp?: string;
  trustProxyHops?: string;
}): Promise<string> {
  // A true delete (not `= undefined`, which process.env coerces to the string
  // "undefined") so valibot's optional default of 1 governs the unset case.
  if (opts.trustProxyHops === undefined) Reflect.deleteProperty(process.env, 'TRUST_PROXY_HOPS');
  else process.env.TRUST_PROXY_HOPS = opts.trustProxyHops;

  const app = new Hono<{ Bindings: { ip?: string } }>();
  app.get('/x', (c) => c.text(ipKey(c)));
  const headers: Record<string, string> = {};
  if (opts.xForwardedFor !== undefined) headers['X-Forwarded-For'] = opts.xForwardedFor;
  const res = await app.request('/x', { headers }, { ip: opts.socketIp });
  return res.text();
}

afterEach(() => {
  Reflect.deleteProperty(process.env, 'TRUST_PROXY_HOPS');
});

describe('ipKey', () => {
  it('reads the closest hop from X-Forwarded-For under the default single trusted hop', async () => {
    expect(
      await resolveIpKey({ xForwardedFor: '9.9.9.9, 8.8.8.8, 5.5.5.5', socketIp: '10.0.0.1' }),
    ).toBe('5.5.5.5');
  });

  it('ignores client-prepended spoof entries in X-Forwarded-For', async () => {
    // Attacker prepends a victim address; the trusted front proxy still appends the true peer.
    expect(
      await resolveIpKey({ xForwardedFor: '1.2.3.4, 198.51.100.42', socketIp: '10.0.0.1' }),
    ).toBe('198.51.100.42');
  });

  it('uses the direct socket IP when no X-Forwarded-For is present', async () => {
    expect(await resolveIpKey({ socketIp: '203.0.113.9' })).toBe('203.0.113.9');
  });

  it('trusts only the socket IP when TRUST_PROXY_HOPS is 0, ignoring X-Forwarded-For', async () => {
    expect(
      await resolveIpKey({
        xForwardedFor: '9.9.9.9',
        socketIp: '203.0.113.9',
        trustProxyHops: '0',
      }),
    ).toBe('203.0.113.9');
  });

  it("falls back to the 'unknown' sentinel when neither a socket IP nor a forwarded hop is available", async () => {
    expect(await resolveIpKey({})).toBe('unknown');
  });
});
