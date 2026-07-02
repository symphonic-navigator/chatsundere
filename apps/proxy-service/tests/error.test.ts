// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { onProxyError } from '../src/error.js';

describe('onProxyError', () => {
  test('never leaks the target URL from a fetch error message', async () => {
    const app = new Hono();
    app.onError(onProxyError);
    app.get('/x', () => { throw new Error('fetch failed https://mcp.secret-host.example/path'); });
    const res = await app.request('/x');
    const body = await res.text();
    expect(res.status).toBe(502);
    expect(body).not.toContain('secret-host');
    expect(body).not.toContain('/path');
  });
});
