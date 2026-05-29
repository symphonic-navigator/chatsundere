// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { loadAdapterInSandbox } from './sandbox-host.js';

const baselinePath = resolve(import.meta.dir, '../adapters/nano-gpt-deepseek.baseline.sandbox.ts');
const runawayPath = resolve(import.meta.dir, '__fixtures__/runaway-adapter.ts');
const brokenPath = resolve(import.meta.dir, '__fixtures__/broken-adapter.ts');

describe('loadAdapterInSandbox', () => {
  it('round-trips buildRequest through the worker boundary', async () => {
    const handle = await loadAdapterInSandbox(baselinePath);
    const wire = await handle.buildRequest({
      messages: [{ role: 'user', content: 'hi' }],
      reasoning: { enabled: true, effort: 'high' },
    });
    expect((wire as { model: string }).model).toBe('deepseek/deepseek-v4-pro:thinking');
    handle.dispose();
  });

  it('terminates a runaway module via the watchdog', async () => {
    const handle = await loadAdapterInSandbox(runawayPath, { timeoutMs: 200 });
    await expect(
      handle.buildRequest({ messages: [], reasoning: { enabled: false } }),
    ).rejects.toThrow(/timed out/);
    handle.dispose();
  });

  it('rejects fast when the adapter module throws at import time', async () => {
    // The worker entry wraps import() in try/catch and sends { ok: false } back, so
    // loadAdapterInSandbox rejects via the message reply — well under the watchdog.
    // timeoutMs: 4000 ensures the assertion proves the error path fires, not the watchdog.
    await expect(loadAdapterInSandbox(brokenPath, { timeoutMs: 4000 })).rejects.toThrow();
  });

  it('rejects a pending call immediately when dispose is called', async () => {
    // Fire buildRequest against the runaway adapter with a long timeout so the
    // watchdog will not fire during this test, then dispose while the call is in
    // flight — the pending promise must reject with a "disposed" message.
    const handle = await loadAdapterInSandbox(runawayPath, { timeoutMs: 5_000 });
    const p = handle.buildRequest({ messages: [], reasoning: { enabled: false } });
    handle.dispose();
    await expect(p).rejects.toThrow(/disposed/);
  });
});
