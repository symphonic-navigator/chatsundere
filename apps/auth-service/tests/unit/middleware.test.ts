// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { createServer } from '../../src/server.js';

describe('middleware', () => {
  it('rejects POST without Origin header', async () => {
    const app = createServer();
    const res = await app.request('/healthz', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('rejects requests with a disallowed Origin', async () => {
    const app = createServer();
    const res = await app.request('/healthz', {
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(res.status).toBe(403);
  });

  it('emits security headers on the response', async () => {
    const app = createServer();
    const res = await app.request('/healthz');
    expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('exposes /metrics in Prometheus exposition format', async () => {
    const app = createServer();
    const res = await app.request('/metrics');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('auth_links_total');
  });
});
