// SPDX-License-Identifier: AGPL-3.0-only
import { openLocalDb } from '@chatsundere/crypto';
import { openClientDataDb } from './client-data-db.js';

let dbHandle: IDBDatabase | null = null;
let pending: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbHandle) return Promise.resolve(dbHandle);
  if (pending) return pending;
  pending = (async () => {
    const [crypto, _client] = await Promise.all([openLocalDb(), openClientDataDb()]);
    dbHandle = crypto;
    pending = null;
    return crypto;
  })();
  return pending;
}

export function getDb(): IDBDatabase {
  if (!dbHandle) throw new Error('IDB not opened — call openDb() during boot first');
  return dbHandle;
}
