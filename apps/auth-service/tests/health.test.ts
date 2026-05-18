// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, test } from 'bun:test';
import { createServer } from '../src/server.js';

describe('auth-service health endpoints', () => {
  test('GET /healthz returns 200 ok', async () => {
    const app = createServer();
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  test('GET /readyz returns 200 when env is valid', async () => {
    const app = createServer();
    const res = await app.request('/readyz');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; deps: Record<string, string> };
    expect(body.status).toBe('ok');
    expect(body.deps).toBeDefined();
  });

  test('GET /metrics returns Prometheus exposition', async () => {
    const app = createServer();
    const res = await app.request('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('# TYPE');
  });
});
