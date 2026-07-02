// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { createServer } from '../../src/server.js';

// The test env (tests/setup.ts) sets PROXY_PUBLIC_URL=https://proxy.example.
describe('GET /api/v1/config', () => {
  test('returns the configured proxyUrl and features, unauthenticated', async () => {
    const app = createServer();
    const res = await app.request('/api/v1/config');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ proxyUrl: 'https://proxy.example', features: ['proxy'] });
  });

  test('is served with app-origin CORS headers (fetched cross-origin pre-login)', async () => {
    const app = createServer();
    const res = await app.request('/api/v1/config', {
      headers: { Origin: 'http://localhost:3000' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });
});
