// SPDX-License-Identifier: LGPL-3.0-only

import { CryptoError } from '../errors.js';
import {
  DB_NAME,
  DB_VERSION,
  STORE_LINKED_ACCOUNT,
  STORE_LOCAL_ACCOUNT,
  STORE_PASSKEY_CREDENTIALS,
  STORE_STAGING,
} from './schema.js';

/**
 * Open the per-origin IndexedDB used by @chatsundere/crypto. Caller may
 * pass a custom name for testing isolation.
 */
export function openLocalDb(
  name: string = DB_NAME,
  version: number = DB_VERSION,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open(name, version);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = (event as IDBVersionChangeEvent).oldVersion;
      runMigrations(db, oldVersion, version);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(new CryptoError('db_schema_mismatch', `IndexedDB open failed: ${req.error}`));
    req.onblocked = () =>
      reject(new CryptoError('db_schema_mismatch', 'IndexedDB open blocked by another connection'));
  });
}

function runMigrations(db: IDBDatabase, oldVersion: number, newVersion: number): void {
  if (oldVersion < 1 && newVersion >= 1) {
    db.createObjectStore(STORE_LOCAL_ACCOUNT, { keyPath: null });
    db.createObjectStore(STORE_LINKED_ACCOUNT, { keyPath: null });
    db.createObjectStore(STORE_PASSKEY_CREDENTIALS, { keyPath: 'credential_id' });
    db.createObjectStore(STORE_STAGING, { keyPath: 'key' });
  }
  // Future versions: add a block per inclusive (oldVersion < N && newVersion >= N).
}

/** Promise-friendly wrapper for IDB request. */
export function reqPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Promise-friendly wrapper for IDB transaction completion. */
export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}
