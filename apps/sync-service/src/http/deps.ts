// SPDX-License-Identifier: AGPL-3.0-only

import type { Redis } from 'ioredis';
import type { TokenClaims } from '../auth/verify-token.js';
import type { Db } from '../db/client.js';
import type { Env } from '../env.js';

/** Everything the sync HTTP handlers need, injectable for tests. */
export interface SyncDeps {
  env: Env;
  db: Db;
  redis: Redis;
  verifyToken: (token: string) => Promise<TokenClaims | null>;
  allow: (key: string, limit: number, windowSec: number) => Promise<boolean>;
  /** The store's `instance_epoch`, read once at boot and echoed on every response. */
  epoch: string;
}
