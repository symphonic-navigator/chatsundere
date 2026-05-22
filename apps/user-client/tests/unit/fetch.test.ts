// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError, apiFetch, joinUrl } from '../../src/lib/fetch.js';

// Mock the session store so tests do not depend on real Zustand state.
vi.mock('@chatsundere/ui-shared', () => ({
  useSessionStore: {
    getState: vi.fn(() => ({
      session: { accessToken: 'test-access-token' },
      updateAccessToken: vi.fn(),
      closeAndForget: vi.fn(),
    })),
    setState: vi.fn(),
  },
}));

// Import the mock after vi.mock so we can introspect it.
const { useSessionStore } = await import('@chatsundere/ui-shared');

const BASE_URL = 'https://api.example.com';

function makeJsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function makeFetchSpy() {
  return vi.spyOn(globalThis, 'fetch');
}

beforeEach(() => {
  vi.resetAllMocks();
  // Restore the default mock state for the session store.
  vi.mocked(useSessionStore.getState).mockReturnValue({
    session: { accessToken: 'test-access-token' } as ReturnType<
      typeof useSessionStore.getState
    >['session'],
    setSession: vi.fn(),
    updateAccessToken: vi.fn(),
    closeAndForget: vi.fn(),
  } as unknown as ReturnType<typeof useSessionStore.getState>);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('apiFetch — successful response', () => {
  it('returns the parsed JSON body on a 200 response', async () => {
    const spy = makeFetchSpy();
    spy.mockResolvedValueOnce(makeJsonResponse({ message: 'ok' }, 200));

    const result = await apiFetch<{ message: string }>({
      baseUrl: BASE_URL,
      path: '/v1/ping',
    });

    expect(result).toEqual({ message: 'ok' });
  });
});

describe('apiFetch — auth header', () => {
  it('adds Authorization: Bearer header when authMode is "bearer"', async () => {
    const spy = makeFetchSpy();
    spy.mockResolvedValueOnce(makeJsonResponse({}, 200));

    await apiFetch({ baseUrl: BASE_URL, path: '/v1/me', authMode: 'bearer' });

    const firstCall = spy.mock.calls[0];
    const headers = new Headers(firstCall?.[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer test-access-token');
  });

  it('does not add Authorization header when authMode is "none"', async () => {
    const spy = makeFetchSpy();
    spy.mockResolvedValueOnce(makeJsonResponse({}, 200));

    await apiFetch({ baseUrl: BASE_URL, path: '/v1/public', authMode: 'none' });

    const firstCall = spy.mock.calls[0];
    const headers = new Headers(firstCall?.[1]?.headers);
    expect(headers.get('Authorization')).toBeNull();
  });
});

describe('apiFetch — 401 with bearer auth', () => {
  it('calls the refresh endpoint once and retries the original request', async () => {
    const spy = makeFetchSpy();

    // 1st call — original request → 401
    spy.mockResolvedValueOnce(makeJsonResponse({ error: { code: 'token_expired' } }, 401));
    // 2nd call — refresh → 200
    spy.mockResolvedValueOnce(
      makeJsonResponse({ access_token: 'new-token', expires_in: 3600 }, 200),
    );
    // 3rd call — retry of original → 200
    spy.mockResolvedValueOnce(makeJsonResponse({ data: 'payload' }, 200));

    const result = await apiFetch<{ data: string }>({
      baseUrl: BASE_URL,
      path: '/v1/secure',
      authMode: 'bearer',
    });

    expect(result).toEqual({ data: 'payload' });
    // original + refresh + retry = 3 fetch calls
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('propagates HttpError(401) and calls closeAndForget when refresh also returns 401', async () => {
    const closeAndForget = vi.fn();
    vi.mocked(useSessionStore.getState).mockReturnValue({
      session: { accessToken: 'test-access-token' } as ReturnType<
        typeof useSessionStore.getState
      >['session'],
      setSession: vi.fn(),
      updateAccessToken: vi.fn(),
      closeAndForget,
    } as unknown as ReturnType<typeof useSessionStore.getState>);

    const spy = makeFetchSpy();
    // original → 401
    spy.mockResolvedValueOnce(makeJsonResponse({ error: { code: 'token_expired' } }, 401));
    // refresh → 401 (reuse_detected or expired)
    spy.mockResolvedValueOnce(makeJsonResponse({ error: { code: 'refresh_invalid' } }, 401));

    await expect(
      apiFetch({ baseUrl: BASE_URL, path: '/v1/secure', authMode: 'bearer' }),
    ).rejects.toBeInstanceOf(HttpError);

    expect(closeAndForget).toHaveBeenCalled();
  });
});

describe('joinUrl', () => {
  it('joins a host-only baseUrl with an absolute path', () => {
    expect(joinUrl('https://api.example.com', '/auth/v1/foo')).toBe(
      'https://api.example.com/auth/v1/foo',
    );
  });

  it('strips a trailing slash from baseUrl before joining', () => {
    expect(joinUrl('https://api.example.com/', '/auth/v1/foo')).toBe(
      'https://api.example.com/auth/v1/foo',
    );
  });

  it('preserves a path prefix in baseUrl', () => {
    expect(joinUrl('https://example.com/chatsundere', '/auth/v1/foo')).toBe(
      'https://example.com/chatsundere/auth/v1/foo',
    );
  });

  it('preserves a path prefix in baseUrl with a trailing slash', () => {
    expect(joinUrl('https://example.com/chatsundere/', '/auth/v1/foo')).toBe(
      'https://example.com/chatsundere/auth/v1/foo',
    );
  });

  it('treats a relative path as absolute by prepending /', () => {
    expect(joinUrl('https://example.com/chatsundere', 'auth/v1/foo')).toBe(
      'https://example.com/chatsundere/auth/v1/foo',
    );
  });
});

describe('apiFetch — path-prefixed baseUrl', () => {
  it('sends the request to baseUrl + path, preserving the prefix', async () => {
    const spy = makeFetchSpy();
    spy.mockResolvedValueOnce(makeJsonResponse({ ok: true }, 200));

    await apiFetch({
      baseUrl: 'https://example.com/chatsundere',
      path: '/auth/v1/ping',
    });

    expect(spy.mock.calls[0]?.[0]).toBe('https://example.com/chatsundere/auth/v1/ping');
  });

  it('uses the prefixed baseUrl for the token refresh endpoint on 401', async () => {
    const spy = makeFetchSpy();
    // original → 401
    spy.mockResolvedValueOnce(makeJsonResponse({ error: { code: 'token_expired' } }, 401));
    // refresh → 200
    spy.mockResolvedValueOnce(
      makeJsonResponse({ access_token: 'new-token', expires_in: 3600 }, 200),
    );
    // retry → 200
    spy.mockResolvedValueOnce(makeJsonResponse({ ok: true }, 200));

    await apiFetch({
      baseUrl: 'https://example.com/chatsundere',
      path: '/auth/v1/secure',
      authMode: 'bearer',
    });

    expect(spy.mock.calls[1]?.[0]).toBe('https://example.com/chatsundere/api/v1/token/refresh');
  });
});

describe('apiFetch — 429 rate limiting', () => {
  it('throws HttpError with retryAfterSeconds when Retry-After is a valid integer', async () => {
    const spy = makeFetchSpy();
    spy.mockResolvedValueOnce(
      makeJsonResponse({ error: { code: 'rate_limited' } }, 429, { 'Retry-After': '30' }),
    );

    await expect(apiFetch({ baseUrl: BASE_URL, path: '/v1/action' })).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 30,
    });
  });

  it('throws HttpError with retryAfterSeconds === undefined when Retry-After is not a valid integer', async () => {
    const spy = makeFetchSpy();
    spy.mockResolvedValueOnce(
      makeJsonResponse({ error: { code: 'rate_limited' } }, 429, {
        'Retry-After': 'garbage',
      }),
    );

    await expect(apiFetch({ baseUrl: BASE_URL, path: '/v1/action' })).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: undefined,
    });
  });
});
