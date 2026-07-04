// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A stateful fake of the two ui-shared stores fetch.ts consults, mirroring the
// hoisted-store pattern in fetch-refresh.test.ts.
const stores = vi.hoisted(() => {
  const sessionState = {
    session: { accessToken: 'test-access-token' } as { accessToken: string } | null,
    updateAccessToken: vi.fn(),
    closeAndForget: vi.fn(),
  };
  const accountLinkState: { baseUrl: string | null } = { baseUrl: 'https://auth.example.com' };
  return { sessionState, accountLinkState };
});

vi.mock('@chatsundere/ui-shared', () => ({
  useSessionStore: { getState: () => stores.sessionState, setState: vi.fn() },
  useAccountLinkStore: { getState: () => stores.accountLinkState },
  requestStepUp: vi.fn(async () => false),
}));

const { logoutCurrentSession } = await import('../../src/lib/auth-logout.js');

const AUTH_BASE = 'https://auth.example.com';

beforeEach(() => {
  stores.accountLinkState.baseUrl = AUTH_BASE;
  stores.sessionState.session = { accessToken: 'test-access-token' };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('logoutCurrentSession', () => {
  it('POSTs the auth base logout endpoint with a bearer header and returns true on 2xx', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await logoutCurrentSession();

    expect(result).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(url).toBe(`${AUTH_BASE}/api/v1/auth/logout`);
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer test-access-token');
  });

  it('returns false when the transport throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network down'));

    const result = await logoutCurrentSession();

    expect(result).toBe(false);
  });

  it('returns false when the server responds with a non-2xx status', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    // 1st call — the logout POST itself → 401.
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'unauthorized' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    // 2nd call — apiFetch's bearer-401 handling refreshes against the same
    // auth base; a definitive refusal here keeps the original 401 standing.
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'unauthorized' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await logoutCurrentSession();

    expect(result).toBe(false);
  });

  it('returns false without calling fetch when there is no linked auth base', async () => {
    stores.accountLinkState.baseUrl = null;
    const spy = vi.spyOn(globalThis, 'fetch');

    const result = await logoutCurrentSession();

    expect(result).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('POSTs to the override base URL when one is supplied, ignoring the store', async () => {
    // Mirrors the decouple retry path: the store's baseUrl has already been
    // cleared to null (setLocalOnly), so the caller must be able to supply
    // the auth base explicitly and still reach the logout endpoint.
    stores.accountLinkState.baseUrl = null;
    const overrideBase = 'https://retry.example.com';
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await logoutCurrentSession(overrideBase);

    expect(result).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    const [url] = spy.mock.calls[0] ?? [];
    expect(url).toBe(`${overrideBase}/api/v1/auth/logout`);
  });

  it('still uses the store base URL when no override is supplied', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await logoutCurrentSession();

    expect(result).toBe(true);
    const [url] = spy.mock.calls[0] ?? [];
    expect(url).toBe(`${AUTH_BASE}/api/v1/auth/logout`);
  });
});
