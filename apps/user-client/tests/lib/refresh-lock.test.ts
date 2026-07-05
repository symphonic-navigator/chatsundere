// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshAccessToken } from '../../src/lib/fetch.js';

// A minimal LockManager stand-in — jsdom has no navigator.locks. We record the
// lock name and run the callback synchronously, proving the refresh round-trip
// is routed through the named exclusive lock.
type LockRequest = (name: string, cb: (lock: unknown) => Promise<unknown>) => Promise<unknown>;

function installFakeLocks(record: string[]): void {
  const request: LockRequest = (name, cb) => {
    record.push(name);
    return cb(null);
  };
  (globalThis.navigator as unknown as { locks: { request: LockRequest } }).locks = { request };
}

function removeLocks(): void {
  // Biome bans `delete`; an `undefined` assignment is behaviourally identical
  // here — `withRefreshLock` only checks truthiness of `navigator.locks`.
  (globalThis.navigator as unknown as { locks?: unknown }).locks = undefined;
}

afterEach(() => {
  removeLocks();
  vi.restoreAllMocks();
});

describe('refreshAccessToken cross-tab serialisation (F3)', () => {
  it('routes the refresh round-trip through the chatsundere-token-refresh Web Lock', async () => {
    const acquired: string[] = [];
    installFakeLocks(acquired);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'at', expires_in: 900 }), { status: 200 }),
    );

    const ok = await refreshAccessToken('https://auth.example');

    expect(ok).toBe(true);
    expect(acquired).toEqual(['chatsundere-token-refresh']);
  });

  it('falls back to a direct refresh when navigator.locks is unavailable', async () => {
    removeLocks();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'at', expires_in: 900 }), { status: 200 }),
      );

    const ok = await refreshAccessToken('https://auth.example');

    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
