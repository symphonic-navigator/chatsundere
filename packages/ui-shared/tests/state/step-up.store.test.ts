// SPDX-License-Identifier: LGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import { requestStepUp, resolveStepUp, useStepUpStore } from '../../src/state/step-up.store.js';

describe('step-up store', () => {
  beforeEach(() => {
    useStepUpStore.setState({ pending: null });
  });

  it('opens one pending request and resolves true on confirm', async () => {
    const p = requestStepUp('t1');
    expect(useStepUpStore.getState().pending?.tier).toBe('t1');
    resolveStepUp(true);
    await expect(p).resolves.toBe(true);
    expect(useStepUpStore.getState().pending).toBeNull();
  });

  it('coalesces concurrent requests onto one pending gate', async () => {
    const a = requestStepUp('t1');
    const b = requestStepUp('t1');
    // Still exactly one pending request (spec §7.1).
    expect(useStepUpStore.getState().pending?.tier).toBe('t1');
    resolveStepUp(true);
    await expect(a).resolves.toBe(true);
    await expect(b).resolves.toBe(true);
  });

  it('resolves false on cancel and opens fresh afterwards', async () => {
    const a = requestStepUp('t3');
    resolveStepUp(false);
    await expect(a).resolves.toBe(false);
    const b = requestStepUp('t1');
    expect(useStepUpStore.getState().pending?.tier).toBe('t1');
    resolveStepUp(true);
    await expect(b).resolves.toBe(true);
  });
});
