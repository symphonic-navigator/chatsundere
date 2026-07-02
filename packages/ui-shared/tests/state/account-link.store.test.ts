// SPDX-License-Identifier: LGPL-3.0-only
import { type LinkedAccountRow, openLocalDb, putLinkedAccount } from '@chatsundere/crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { initAccountLinkFromDb, useAccountLinkStore } from '../../src/state/account-link.store.js';

function linkedRowFixture(): LinkedAccountRow {
  return {
    server_user_id: '0197fead-0000-7000-8000-000000000001',
    base_url: 'https://chatsundere.example.org',
    issuer_label: 'Example Operator',
    role: 'user',
    wrapped_mk_opaque_ciphertext: new Uint8Array([1]),
    wrapped_mk_opaque_nonce: new Uint8Array([2]),
    wrapped_mk_opaque_aad: new Uint8Array([3]),
    wrapped_mk_opaque_integrity: new Uint8Array([4]),
    linked_at: new Date('2026-07-01T00:00:00Z'),
  };
}

describe('account-link.store', () => {
  beforeEach(() => {
    useAccountLinkStore.setState({
      linkStatus: 'unknown',
      baseUrl: null,
      issuerLabel: null,
      role: null,
    });
    // fake-indexeddb/auto is loaded by tests/setup.ts; a fresh DB name per
    // run is unnecessary because deleteDatabase is implicit in a new suite.
    indexedDB.deleteDatabase('chatsundere');
  });

  it('starts as unknown so gates never claim enabled before the IDB read', () => {
    expect(useAccountLinkStore.getState().linkStatus).toBe('unknown');
  });

  it('initialises to local-only when no linked account row exists', async () => {
    const db = await openLocalDb();
    await initAccountLinkFromDb(db);
    const s = useAccountLinkStore.getState();
    expect(s.linkStatus).toBe('local-only');
    expect(s.baseUrl).toBeNull();
    db.close();
  });

  it('initialises to linked with base URL, issuer label, and role', async () => {
    const db = await openLocalDb();
    await putLinkedAccount(db, linkedRowFixture());
    await initAccountLinkFromDb(db);
    const s = useAccountLinkStore.getState();
    expect(s.linkStatus).toBe('linked');
    expect(s.baseUrl).toBe('https://chatsundere.example.org');
    expect(s.issuerLabel).toBe('Example Operator');
    expect(s.role).toBe('user');
    db.close();
  });

  it('setLocalOnly clears the linked details', () => {
    useAccountLinkStore.getState().setLinked(linkedRowFixture());
    useAccountLinkStore.getState().setLocalOnly();
    const s = useAccountLinkStore.getState();
    expect(s.linkStatus).toBe('local-only');
    expect(s.baseUrl).toBeNull();
    expect(s.issuerLabel).toBeNull();
    expect(s.role).toBeNull();
  });
});
