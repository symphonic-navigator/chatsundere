// SPDX-License-Identifier: LGPL-3.0-only

import { reqPromise, txDone } from './open.js';
import { type PasskeyCredentialRow, STORE_PASSKEY_CREDENTIALS } from './schema.js';

export async function listPasskeyCredentials(db: IDBDatabase): Promise<PasskeyCredentialRow[]> {
  const tx = db.transaction(STORE_PASSKEY_CREDENTIALS, 'readonly');
  const rows = (await reqPromise(
    tx.objectStore(STORE_PASSKEY_CREDENTIALS).getAll(),
  )) as PasskeyCredentialRow[];
  await txDone(tx);
  return rows;
}

export async function getPasskeyCredential(
  db: IDBDatabase,
  credentialId: Uint8Array,
): Promise<PasskeyCredentialRow | null> {
  const tx = db.transaction(STORE_PASSKEY_CREDENTIALS, 'readonly');
  const row = (await reqPromise(
    tx.objectStore(STORE_PASSKEY_CREDENTIALS).get(credentialId as unknown as IDBValidKey),
  )) as PasskeyCredentialRow | undefined;
  await txDone(tx);
  return row ?? null;
}

export async function putPasskeyCredential(
  db: IDBDatabase,
  row: PasskeyCredentialRow,
): Promise<void> {
  const tx = db.transaction(STORE_PASSKEY_CREDENTIALS, 'readwrite');
  await reqPromise(tx.objectStore(STORE_PASSKEY_CREDENTIALS).put(row));
  await txDone(tx);
}

export async function deletePasskeyCredential(
  db: IDBDatabase,
  credentialId: Uint8Array,
): Promise<void> {
  const tx = db.transaction(STORE_PASSKEY_CREDENTIALS, 'readwrite');
  await reqPromise(
    tx.objectStore(STORE_PASSKEY_CREDENTIALS).delete(credentialId as unknown as IDBValidKey),
  );
  await txDone(tx);
}
