// SPDX-License-Identifier: AGPL-3.0-only
import { useSessionStore } from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError, apiFetch } from '../../src/lib/fetch.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * The admin-client has no silent refresh by design (spec 2026-07-04 §3). The
 * documented fallback is "on 401 the route guard redirects to login" — which
 * only works if the expired session is actually cleared, otherwise the stale
 * access token lingers in the store and the guard keeps rendering the panel.
 */
describe('apiFetch 401 session clearing', () => {
  const fetchMock = vi.fn();
  const close = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    close.mockReset();
    useSessionStore.setState({
      session: { userId: 'u-1', accessToken: 'expired', role: 'admin', close },
      mk: null,
    } as never);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useSessionStore.setState({ session: null, mk: null } as never);
  });

  it('clears the session on a 401 for a bearer call so the guard redirects', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { code: 'unauthorized', message: 'token expired' } }),
    );

    await expect(
      apiFetch({ baseUrl: 'https://srv.example', path: '/api/v1/users', authMode: 'bearer' }),
    ).rejects.toMatchObject({ status: 401 });

    expect(useSessionStore.getState().session).toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('still throws the HttpError so callers can render a failure state', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { code: 'unauthorized', message: 'token expired' } }),
    );

    await expect(
      apiFetch({ baseUrl: 'https://srv.example', path: '/api/v1/users', authMode: 'bearer' }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('leaves the session intent-untouched for non-bearer 401s (e.g. login probes)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { code: 'unauthorized', message: 'no' } }),
    );

    await expect(
      apiFetch({ baseUrl: 'https://srv.example', path: '/api/v1/token/whoami', authMode: 'none' }),
    ).rejects.toMatchObject({ status: 401 });

    // A 'none'-mode call carries no bearer token; a 401 there is not our session
    // expiring, so we must not tear a valid session down underneath it.
    expect(useSessionStore.getState().session).not.toBeNull();
    expect(close).not.toHaveBeenCalled();
  });
});
