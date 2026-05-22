// SPDX-License-Identifier: LGPL-3.0-only
import { beforeEach, describe, expect, it } from 'bun:test';
import { openLocalDb } from '../../src/db/open.js';
import {
  DB_VERSION,
  STORE_FLAGS,
  STORE_LINKED_ACCOUNT,
  STORE_LOCAL_ACCOUNT,
  STORE_PASSKEY_CREDENTIALS,
  STORE_STAGING,
} from '../../src/db/schema.js';

const TEST_DB = 'chatsundere-test-open';

describe('openLocalDb', () => {
  beforeEach(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = globalThis.indexedDB.deleteDatabase(TEST_DB);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
  });

  it('creates all expected object stores', async () => {
    const db = await openLocalDb(TEST_DB);
    const names = Array.from(db.objectStoreNames);
    expect(names).toContain(STORE_LOCAL_ACCOUNT);
    expect(names).toContain(STORE_LINKED_ACCOUNT);
    expect(names).toContain(STORE_PASSKEY_CREDENTIALS);
    expect(names).toContain(STORE_STAGING);
    expect(names).toContain(STORE_FLAGS);
    db.close();
  });

  it('can re-open an existing DB without running migrations again', async () => {
    const a = await openLocalDb(TEST_DB);
    a.close();
    const b = await openLocalDb(TEST_DB);
    expect(b.version).toBe(DB_VERSION);
    b.close();
  });
});
