// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import {
  _resetAuthDegradeForTests,
  armAuthDegradeFromBoot,
  isAuthDegraded,
} from '../../src/lib/auth-degrade.js';
import { refreshAccessToken } from '../../src/lib/fetch.js';
import { getSyncState } from '../../src/sync/watermark.js';

// A stateful fake of the two ui-shared stores fetch.ts consults. Hoisted so the
// (hoisted) vi.mock factory below can close over it without a TDZ error.
const stores = vi.hoisted(() => {
  const sessionState = {
    session: { accessToken: 'test-access-token' } as { accessToken: string } | null,
    updateAccessToken: vi.fn((token: string) => {
      sessionState.session = { accessToken: token };
    }),
    closeAndForget: vi.fn(() => {
      sessionState.session = null;
    }),
  };
  const accountLinkState = { baseUrl: 'https://auth.example.com' };
  return { sessionState, accountLinkState };
});

vi.mock('@chatsundere/ui-shared', () => ({
  useSessionStore: { getState: () => stores.sessionState, setState: vi.fn() },
  useAccountLinkStore: { getState: () => stores.accountLinkState },
  requestStepUp: vi.fn(async () => false),
}));

const AUTH_BASE = 'https://auth.example.com';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The one refusal shape the auth service emits: 401 with envelope code `unauthorized`. */
function refusalResponse(): Response {
  return jsonResponse({ error: { code: 'unauthorized' } }, 401);
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  _resetAuthDegradeForTests();
  vi.restoreAllMocks();
  stores.sessionState.session = { accessToken: 'test-access-token' };
  stores.sessionState.updateAccessToken.mockClear();
  stores.sessionState.closeAndForget.mockClear();
});

afterEach(async () => {
  await _resetClientDataDbForTests();
  _resetAuthDegradeForTests();
});

describe('refreshAccessToken — definitive refusal (401 unauthorized)', () => {
  it('background origin latches auth-degraded without destroying the session', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(refusalResponse());

    const ok = await refreshAccessToken(AUTH_BASE, 'background');

    expect(ok).toBe(false);
    expect(stores.sessionState.closeAndForget).not.toHaveBeenCalled();
    expect(stores.sessionState.session).not.toBeNull();
    expect(isAuthDegraded()).toBe(true);
    expect((await getSyncState()).attention).toEqual({ kind: 'auth_degraded' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('user origin destroys the session (closeAndForget)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(refusalResponse());

    const ok = await refreshAccessToken(AUTH_BASE, 'user');

    expect(ok).toBe(false);
    expect(stores.sessionState.closeAndForget).toHaveBeenCalledTimes(1);
    expect(stores.sessionState.session).toBeNull();
    expect(isAuthDegraded()).toBe(false);
  });

  it('defaults to user origin when none is passed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(refusalResponse());

    const ok = await refreshAccessToken(AUTH_BASE);

    expect(ok).toBe(false);
    expect(stores.sessionState.closeAndForget).toHaveBeenCalledTimes(1);
    expect(isAuthDegraded()).toBe(false);
  });
});

describe('refreshAccessToken — unreachable classes never destroy', () => {
  const unreachable: Array<[string, () => Response | Promise<Response>]> = [
    ['503', () => jsonResponse({ error: { code: 'unavailable' } }, 503)],
    ['429', () => jsonResponse({ error: { code: 'rate_limited' } }, 429)],
    ['404 html body', () => new Response('<html>nope</html>', { status: 404 })],
    [
      '401 without the unauthorized envelope',
      () => jsonResponse({ error: { code: 'other' } }, 401),
    ],
  ];

  for (const [label, make] of unreachable) {
    for (const origin of ['user', 'background'] as const) {
      it(`${label} + ${origin}: no destruction, not degraded`, async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(await make());

        const ok = await refreshAccessToken(AUTH_BASE, origin);

        expect(ok).toBe(false);
        expect(stores.sessionState.closeAndForget).not.toHaveBeenCalled();
        expect(stores.sessionState.session).not.toBeNull();
        expect(isAuthDegraded()).toBe(false);
      });
    }
  }

  it('network throw + background: no destruction, not degraded', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const ok = await refreshAccessToken(AUTH_BASE, 'background');

    expect(ok).toBe(false);
    expect(stores.sessionState.closeAndForget).not.toHaveBeenCalled();
    expect(isAuthDegraded()).toBe(false);
  });
});

describe('refreshAccessToken — single-flight', () => {
  it('collapses concurrent refreshes into one underlying fetch', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ error: { code: 'unavailable' } }, 503));

    const results = await Promise.all([
      refreshAccessToken(AUTH_BASE, 'background'),
      refreshAccessToken(AUTH_BASE, 'background'),
      refreshAccessToken(AUTH_BASE, 'user'),
    ]);

    expect(results).toEqual([false, false, false]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('armAuthDegradeFromBoot', () => {
  it('re-arms the in-memory latch from the persisted attention', async () => {
    // Persist the attention (as a prior background refusal would have), then
    // simulate a fresh process where only the in-memory latch was lost.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(refusalResponse());
    await refreshAccessToken(AUTH_BASE, 'background');
    expect(isAuthDegraded()).toBe(true);

    _resetAuthDegradeForTests();
    expect(isAuthDegraded()).toBe(false);

    await armAuthDegradeFromBoot();
    expect(isAuthDegraded()).toBe(true);
  });
});

describe('refreshAccessToken — success', () => {
  it('updates the token and clears a previously latched degraded state', async () => {
    // First: a background refusal latches degraded.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(refusalResponse());
    await refreshAccessToken(AUTH_BASE, 'background');
    expect(isAuthDegraded()).toBe(true);

    // Then: a successful refresh clears it.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ access_token: 'fresh-token', expires_in: 3600 }, 200),
    );

    const ok = await refreshAccessToken(AUTH_BASE, 'background');

    expect(ok).toBe(true);
    expect(stores.sessionState.updateAccessToken).toHaveBeenCalledWith('fresh-token');
    expect(isAuthDegraded()).toBe(false);
    expect((await getSyncState()).attention).toBeNull();
  });
});
