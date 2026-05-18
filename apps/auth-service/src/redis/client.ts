// SPDX-License-Identifier: AGPL-3.0-only

import { Redis } from 'ioredis';
import { loadEnv } from '../env.js';

let cached: Redis | null = null;

export function createRedis(): Redis {
  if (cached) return cached;
  const env = loadEnv();
  cached = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  return cached;
}

export async function closeRedis(): Promise<void> {
  if (cached) {
    await cached.quit();
    cached = null;
  }
}
