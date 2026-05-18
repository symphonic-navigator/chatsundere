// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { bearerAuth } from '../../src/middleware/auth.js';
import { errorEnvelope } from '../../src/middleware/error-envelope.js';

describe('bearerAuth', () => {
  it('returns 401 without an Authorization header', async () => {
    const app = new Hono();
    app.onError(errorEnvelope);
    app.use('*', bearerAuth());
    app.get('/x', (c) => c.json({ ok: true }));

    const res = await app.request('/x');
    expect(res.status).toBe(401);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns 401 for a malformed Bearer token', async () => {
    const app = new Hono();
    app.onError(errorEnvelope);
    app.use('*', bearerAuth());
    app.get('/x', (c) => c.json({ ok: true }));

    const res = await app.request('/x', {
      headers: { Authorization: 'Bearer not-a-jwt' },
    });
    expect(res.status).toBe(401);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
  });
});
