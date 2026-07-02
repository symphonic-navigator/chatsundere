// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { revokedJtiKey, revokedSubKey } from '@chatsundere/shared-types';
import { Redis } from 'ioredis';
import { denyJti, denySub, nowSeconds } from '../../src/auth/deny-list.js';
import { ACCESS_TTL_SECONDS } from '../../src/jwt/issue.js';

let redis: Redis;
beforeAll(() => {
  redis = new Redis(process.env.REDIS_URL as string);
});
afterAll(async () => {
  await redis.quit();
});

describe('deny-list writes', () => {
  test('denyJti writes revoked:jti:<jti> with TTL ≤ ACCESS_TTL', async () => {
    await denyJti(redis, 'sess-x');
    expect(await redis.get(revokedJtiKey('sess-x'))).toBe('1');
    const ttl = await redis.ttl(revokedJtiKey('sess-x'));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(ACCESS_TTL_SECONDS);
    await redis.del(revokedJtiKey('sess-x'));
  });

  test('denySub writes revoked:sub:<sub> holding a current unix-seconds value', async () => {
    const before = nowSeconds();
    await denySub(redis, 'user-y', before);
    const stored = Number(await redis.get(revokedSubKey('user-y')));
    expect(stored).toBe(before);
    expect(await redis.ttl(revokedSubKey('user-y'))).toBeGreaterThan(0);
    await redis.del(revokedSubKey('user-y'));
  });

  test('the keys match the shared-types builders', () => {
    expect(revokedJtiKey('j')).toBe('revoked:jti:j');
    expect(revokedSubKey('s')).toBe('revoked:sub:s');
  });
});
