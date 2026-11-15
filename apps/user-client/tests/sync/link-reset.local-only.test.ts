// apps/user-client/tests/sync/link-reset.local-only.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { resetEngineStateForLocalOnly } from '../../src/sync/link-reset.js';

describe('resetEngineStateForLocalOnly', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });

  it('clears all transfer-state to local-only defaults', async () => {
    const db = getClientDataDb();
    await db.syncRows.put({ collection: 'personas', key: 'p1', rev: 3, ciphertextHash: 'h' });
    await db.syncOutbox.add({ collection: 'personas', key: 'p1', op: 'upsert', enqueuedAt: 1 });
    await db.syncState.put({
      id: 'state',
      epoch: 'e',
      watermarkRev: 9,
      lastSyncAt: null,
      pulling: null,
      attention: null,
      backfillPending: true,
      backfillTotal: 2,
      backfillDone: 1,
    });

    await resetEngineStateForLocalOnly();

    expect(await db.syncRows.count()).toBe(0);
    expect(await db.syncOutbox.count()).toBe(0);
    const s = await db.syncState.get('state');
    expect(s).toMatchObject({
      epoch: null,
      watermarkRev: 0,
      backfillPending: false,
      backfillTotal: null,
      backfillDone: null,
    });
  });

  it('sets seenGeneration to the row generation and clears the hold, touching nothing else', async () => {
    const db = getClientDataDb();
    const base = {
      resource: 'https://mcp.example/mcp',
      issuer: 'https://auth.example',
      tokenEndpoint: 'https://auth.example/token',
      revocationEndpoint: null,
      clientId: 'client-1',
      registration: 'dcr' as const,
      scope: 'read',
      tokenRoute: 'direct' as const,
      tokens: null,
      claim: null,
      createdAt: 1,
      updatedAt: 2,
    };
    await db.mcpOAuthGrants.bulkPut([
      { ...base, id: 'g-gen', generation: 6, seenGeneration: 9, heldGeneration: 4 },
      { ...base, id: 'g-old', seenGeneration: 3, heldGeneration: 2 },
    ]);

    await resetEngineStateForLocalOnly();

    expect(await db.mcpOAuthGrants.get('g-gen')).toEqual({
      ...base,
      id: 'g-gen',
      generation: 6,
      seenGeneration: 6,
      heldGeneration: null,
    });
    expect(await db.mcpOAuthGrants.get('g-old')).toEqual({
      ...base,
      id: 'g-old',
      seenGeneration: 0,
      heldGeneration: null,
    });
  });
});
