// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { register } from 'prom-client';
import { initialiseMetrics, recordLlmRequest, recordRequest } from '../src/metrics.js';

describe('metrics', () => {
  test('counters exist and carry no user label', async () => {
    initialiseMetrics();
    recordRequest({ kind: 'mcp', outcome: 'ok' });
    recordLlmRequest({ host: 'api.x.ai', outcome: 'ok' });
    const text = await register.metrics();
    expect(text).toContain('proxy_requests_total');
    expect(text).toContain('proxy_llm_requests_total');
    expect(text).not.toContain('sub=');
    expect(text).not.toContain('jti=');
  });
});
