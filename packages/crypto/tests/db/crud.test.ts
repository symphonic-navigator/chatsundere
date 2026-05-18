// SPDX-License-Identifier: LGPL-3.0-only
import { beforeEach, describe, expect, it } from 'bun:test';
import {
  deleteLinkedAccount,
  getLinkedAccount,
  putLinkedAccount,
} from '../../src/db/linked-account.js';
import {
  deleteLocalAccount,
  getLocalAccount,
  putLocalAccount,
} from '../../src/db/local-account.js';
import { openLocalDb } from '../../src/db/open.js';
import {
  deletePasskeyCredential,
  listPasskeyCredentials,
  putPasskeyCredential,
} from '../../src/db/passkey-credentials.js';
import { getStaging, putStaging, setStagingState } from '../../src/db/staging.js';

const DB = 'chatsundere-test-crud';

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const r = globalThis.indexedDB.deleteDatabase(DB);
    r.onsuccess = () => resolve();
    r.onerror = () => resolve();
    r.onblocked = () => resolve();
  });
});

describe('CRUD round-trips', () => {
  it('local_account: put → get → delete → get returns null', async () => {
    const db = await openLocalDb(DB);
    const row = makeLocalRow();
    await putLocalAccount(db, row);
    const got = await getLocalAccount(db);
    expect(got?.username).toBe('alice');
    await deleteLocalAccount(db);
    expect(await getLocalAccount(db)).toBeNull();
    db.close();
  });

  it('linked_account round-trip', async () => {
    const db = await openLocalDb(DB);
    await putLinkedAccount(db, makeLinkedRow());
    expect((await getLinkedAccount(db))?.role).toBe('user');
    await deleteLinkedAccount(db);
    expect(await getLinkedAccount(db)).toBeNull();
    db.close();
  });

  it('passkey credentials: list two, delete one, list one', async () => {
    const db = await openLocalDb(DB);
    await putPasskeyCredential(db, makePasskeyRow(1));
    await putPasskeyCredential(db, makePasskeyRow(2));
    expect((await listPasskeyCredentials(db)).length).toBe(2);
    await deletePasskeyCredential(db, Uint8Array.from([2]));
    expect((await listPasskeyCredentials(db)).length).toBe(1);
    db.close();
  });

  it('staging: put, setState, get reflects new state', async () => {
    const db = await openLocalDb(DB);
    await putStaging(db, makeStagingRow());
    await setStagingState(db, 'committed');
    expect((await getStaging(db))?.server_state).toBe('committed');
    db.close();
  });
});

function makeLocalRow() {
  return {
    schema_version: 1,
    username: 'alice',
    local_salt: new Uint8Array(16),
    wrapped_mk_local_ciphertext: new Uint8Array(48),
    wrapped_mk_local_nonce: new Uint8Array(12),
    wrapped_mk_local_aad: new TextEncoder().encode('alice::local::v1'),
    wrapped_mk_local_integrity: new Uint8Array(32),
    wrapped_mk_recovery_ciphertext: new Uint8Array(48),
    wrapped_mk_recovery_nonce: new Uint8Array(12),
    wrapped_mk_recovery_aad: new TextEncoder().encode('alice::recovery::v1'),
    wrapped_mk_recovery_integrity: new Uint8Array(32),
    recovery_verifier_key: new Uint8Array(32),
    created_at: new Date(),
  };
}

function makeLinkedRow() {
  return {
    server_user_id: '01HX...',
    base_url: 'https://chatsundere.example.com/api',
    issuer_label: 'Chris',
    role: 'user' as const,
    wrapped_mk_opaque_ciphertext: new Uint8Array(48),
    wrapped_mk_opaque_nonce: new Uint8Array(12),
    wrapped_mk_opaque_aad: new TextEncoder().encode('alice::opaque::v1'),
    wrapped_mk_opaque_integrity: new Uint8Array(32),
    linked_at: new Date(),
  };
}

function makePasskeyRow(n: number) {
  return {
    credential_id: Uint8Array.from([n]),
    public_key: Uint8Array.from([0xa0 + n]),
    sign_counter: 0,
    aaguid: null,
    label: `device-${n}`,
    wrapped_mk_prf_ciphertext: new Uint8Array(48),
    wrapped_mk_prf_nonce: new Uint8Array(12),
    wrapped_mk_prf_aad: new TextEncoder().encode(`alice::prf::cred${n}::v1`),
    wrapped_mk_prf_integrity: new Uint8Array(32),
    is_synced_with_server: false,
    created_at: new Date(),
  };
}

function makeStagingRow() {
  return {
    key: 'pending_passphrase_change' as const,
    new_local_salt: new Uint8Array(16),
    new_wrapped_mk_local_ciphertext: new Uint8Array(48),
    new_wrapped_mk_local_nonce: new Uint8Array(12),
    new_wrapped_mk_local_aad: new TextEncoder().encode('alice::local::v1'),
    new_wrapped_mk_local_integrity: new Uint8Array(32),
    server_state: 'pending' as const,
    created_at: new Date(),
  };
}
