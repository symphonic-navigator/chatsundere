// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { createOpsApp } from '../src/ops.js';

describe('two-port split', () => {
  test('ops app serves /metrics', async () => {
    const res = await createOpsApp().request('/metrics');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('# TYPE');
  });
  test('ops app serves /healthz', async () => {
    const res = await createOpsApp().request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
  test('ops app /readyz reports redis only (no database)', async () => {
    const res = await createOpsApp().request('/readyz');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; deps: Record<string, string> };
    expect(body.deps).toEqual({ redis: 'unknown' });
  });
  // Public-port behaviour: a /metrics request is treated as a proxy target path,
  // NOT served locally — covered by the proxy route test (no local /metrics handler).
});
