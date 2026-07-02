// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, test } from 'bun:test';
import { createServer } from '../../src/server.js';

// tests/setup.ts sets PROXY_PUBLIC_URL=https://proxy.example and
// SYNC_PUBLIC_URL=https://sync.example.
const savedSync = process.env.SYNC_PUBLIC_URL;
const savedBlobs = process.env.SYNC_BLOBS_ENABLED;
afterEach(() => {
  if (savedSync === undefined) Reflect.deleteProperty(process.env, 'SYNC_PUBLIC_URL');
  else process.env.SYNC_PUBLIC_URL = savedSync;
  if (savedBlobs === undefined) Reflect.deleteProperty(process.env, 'SYNC_BLOBS_ENABLED');
  else process.env.SYNC_BLOBS_ENABLED = savedBlobs;
});

describe('GET /api/v1/config', () => {
  test('returns proxyUrl, syncUrl and both features when configured', async () => {
    const res = await createServer().request('/api/v1/config');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      proxyUrl: 'https://proxy.example',
      syncUrl: 'https://sync.example',
      features: ['proxy', 'sync'],
    });
  });

  test('omits syncUrl and the sync feature when SYNC_PUBLIC_URL is unset', async () => {
    Reflect.deleteProperty(process.env, 'SYNC_PUBLIC_URL');
    const res = await createServer().request('/api/v1/config');
    expect(await res.json()).toEqual({ proxyUrl: 'https://proxy.example', features: ['proxy'] });
  });

  test('is served with app-origin CORS headers (fetched cross-origin pre-login)', async () => {
    const res = await createServer().request('/api/v1/config', {
      headers: { Origin: 'http://localhost:3000' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });

  test('a non-https SYNC_PUBLIC_URL fails env-load', async () => {
    process.env.SYNC_PUBLIC_URL = 'http://insecure.example';
    expect(() => createServer()).toThrow();
  });

  test('includes "blobs" (after "sync") when SYNC_BLOBS_ENABLED and SYNC_PUBLIC_URL are set', async () => {
    process.env.SYNC_BLOBS_ENABLED = 'true';
    const res = await createServer().request('/api/v1/config');
    const body = (await res.json()) as { features: string[] };
    expect(body.features).toEqual(['proxy', 'sync', 'blobs']);
  });

  test('omits "blobs" when SYNC_BLOBS_ENABLED is unset', async () => {
    Reflect.deleteProperty(process.env, 'SYNC_BLOBS_ENABLED');
    const res = await createServer().request('/api/v1/config');
    const body = (await res.json()) as { features: string[] };
    expect(body.features).not.toContain('blobs');
  });

  test('omits "blobs" when the flag is true but SYNC_PUBLIC_URL is unset (blobs need sync)', async () => {
    process.env.SYNC_BLOBS_ENABLED = 'true';
    Reflect.deleteProperty(process.env, 'SYNC_PUBLIC_URL');
    const res = await createServer().request('/api/v1/config');
    const body = (await res.json()) as { features: string[] };
    expect(body.features).not.toContain('blobs');
    expect(body.features).not.toContain('sync');
  });
});
