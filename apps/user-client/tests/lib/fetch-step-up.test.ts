// SPDX-License-Identifier: AGPL-3.0-only
import { resolveStepUp, useStepUpStore } from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError, apiFetch } from '../../src/lib/fetch.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const STEP_UP_403 = {
  error: { code: 'step_up_required', message: 'Step-up confirmation required', tier: 1 },
};

describe('apiFetch step-up interceptor', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    useStepUpStore.setState({ pending: null });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gates on 403 step_up_required, retries once after confirm', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(403, STEP_UP_403))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const call = apiFetch<{ ok: boolean }>({
      baseUrl: 'https://srv.example',
      path: '/api/v1/me/pairing-codes',
      method: 'POST',
      authMode: 'bearer',
    });

    // The gate is now pending with the mapped tier.
    await vi.waitFor(() => expect(useStepUpStore.getState().pending?.tier).toBe('t1'));
    resolveStepUp(true);

    await expect(call).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps numeric tiers 3 and 4', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(403, { error: { code: 'step_up_required', message: 'x', tier: 4 } }),
    );
    const call = apiFetch({ baseUrl: 'https://srv.example', path: '/x', authMode: 'bearer' });
    await vi.waitFor(() => expect(useStepUpStore.getState().pending?.tier).toBe('t4'));
    resolveStepUp(false);
    await expect(call).rejects.toBeInstanceOf(HttpError);
  });

  it('throws the original HttpError on cancel without retrying', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, STEP_UP_403));
    const call = apiFetch({ baseUrl: 'https://srv.example', path: '/x', authMode: 'bearer' });
    await vi.waitFor(() => expect(useStepUpStore.getState().pending).not.toBeNull());
    resolveStepUp(false);
    await expect(call).rejects.toMatchObject({ status: 403, code: 'step_up_required' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not loop on a second 403 after the retry', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(403, STEP_UP_403))
      .mockResolvedValueOnce(jsonResponse(403, STEP_UP_403));
    const call = apiFetch({ baseUrl: 'https://srv.example', path: '/x', authMode: 'bearer' });
    await vi.waitFor(() => expect(useStepUpStore.getState().pending).not.toBeNull());
    resolveStepUp(true);
    await expect(call).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useStepUpStore.getState().pending).toBeNull();
  });

  it('honours skipStepUpGate (step-up endpoints never recurse)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, STEP_UP_403));
    await expect(
      apiFetch({
        baseUrl: 'https://srv.example',
        path: '/api/v1/auth/step-up/start',
        authMode: 'bearer',
        skipStepUpGate: true,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(useStepUpStore.getState().pending).toBeNull();
  });

  it('ignores plain 403s without the step_up_required code', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(403, { error: { code: 'forbidden', message: 'no' } }),
    );
    await expect(
      apiFetch({ baseUrl: 'https://srv.example', path: '/x', authMode: 'bearer' }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    expect(useStepUpStore.getState().pending).toBeNull();
  });
});
