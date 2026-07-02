// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { revokedJtiKey, revokedSubKey } from '@chatsundere/shared-types';
import { isRevoked } from '../src/auth/revocation.js';

/** A hermetic Redis fake exposing only `mget`, seeded from a map. */
function fakeRedis(store: Record<string, string>) {
  return {
    mget: async (...keys: string[]) => keys.map((k) => (k in store ? (store[k] as string) : null)),
  };
}

describe('isRevoked', () => {
  const claims = { sub: 's1', jti: 'j1', iat: 1000 };

  test('a jti deny entry revokes unconditionally', async () => {
    const r = fakeRedis({ [revokedJtiKey('j1')]: '1' });
    expect(await isRevoked(r, claims)).toBe(true);
  });
  test('a sub entry newer than iat revokes', async () => {
    const r = fakeRedis({ [revokedSubKey('s1')]: '1001' });
    expect(await isRevoked(r, claims)).toBe(true);
  });
  test('a sub entry older than iat does NOT revoke (re-login rule)', async () => {
    const r = fakeRedis({ [revokedSubKey('s1')]: '999' });
    expect(await isRevoked(r, claims)).toBe(false);
  });
  test('neither key → not revoked', async () => {
    expect(await isRevoked(fakeRedis({}), claims)).toBe(false);
  });
  test('a Redis error propagates (route maps to 503)', async () => {
    const broken = {
      mget: async () => {
        throw new Error('down');
      },
    };
    await expect(isRevoked(broken, claims)).rejects.toThrow();
  });
});
