// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { toBase64Url } from '@chatsundere/crypto';
import type { BlobRef, SyncCollection, SyncPulledRecord } from '@chatsundere/shared-types';
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  _resetApplyForTests,
  _setApplyBlobHooks,
  _setApplyComputeBlindId,
  _setApplyOpenRecord,
  applyRecord,
} from '../../src/sync/apply.js';
import { resolveConflict } from '../../src/sync/resolution.js';

// Node env: the proactive-heal test reads a local `Blob`'s bytes via
// arrayBuffer(), which jsdom's Blob lacks (mirrors blob-drain.test.ts).

function fakeBlindId(collection: string, key: string): Uint8Array {
  return new TextEncoder().encode(`bid:${collection}:${key}`);
}

function id22(seed: string): string {
  return (seed + 'A'.repeat(22)).slice(0, 22);
}

function ref(blobId: string, bytes = 100): BlobRef {
  return { blobId, bytes };
}

/** A pulled upsert whose decrypted row the open seam returns directly. */
function pulled(collection: string, key: string, rev: number): SyncPulledRecord {
  return {
    blindId: toBase64Url(fakeBlindId(collection, key)),
    collection: collection as SyncCollection,
    rev,
    deleted: false,
    nonce: toBase64Url(new Uint8Array([1, 2, 3])),
    ciphertext: toBase64Url(new Uint8Array([rev, rev + 1])),
  };
}

function seedLinkedOnline(): void {
  useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
  useDiscoveryStore.setState({
    status: 'ok',
    // biome-ignore lint/suspicious/noExplicitAny: partial store shape for the test
    config: { syncUrl: 'https://sync.example', features: ['sync'] } as any,
  });
  useConnectivityStore.setState({ state: { kind: 'linked_online' } });
  useSessionStore.setState({ session: { accessToken: 'tok' } as never, mk: {} as never });
}

type EagerCall = { collection: string; key: string; field: string; blobId: string };

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  seedLinkedOnline();
  _setApplyComputeBlindId(async (_mk, c, k) => fakeBlindId(c, k));
});

afterEach(async () => {
  _resetApplyForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
});

describe('apply-side eager enqueue — thumbs + avatars ONLY (WS-D §6)', () => {
  it('enqueues an artefact thumbnail, never its lazy original', async () => {
    const eager: EagerCall[] = [];
    _setApplyBlobHooks({
      enqueueEager: (collection, key, field, r) =>
        eager.push({ collection, key, field, blobId: r.blobId }),
      proactiveHeal: async () => undefined,
    });
    const THUMB = id22('thumb1');
    const ORIG = id22('orig1');
    _setApplyOpenRecord(async () => ({
      id: 'a1',
      chatId: 'c1',
      updatedAt: 1,
      blobRef: ref(ORIG),
      thumbBlobRef: ref(THUMB, 30),
    }));

    const outcome = await applyRecord(pulled('artefacts', 'a1', 5));
    expect(outcome.kind).toBe('inserted');

    expect(eager).toHaveLength(1);
    expect(eager[0]).toMatchObject({
      collection: 'artefacts',
      key: 'a1',
      field: 'thumbBlob',
      blobId: THUMB,
    });
  });

  it('enqueues a persona avatar eagerly', async () => {
    const eager: EagerCall[] = [];
    _setApplyBlobHooks({
      enqueueEager: (collection, key, field, r) =>
        eager.push({ collection, key, field, blobId: r.blobId }),
      proactiveHeal: async () => undefined,
    });
    const AV = id22('av1');
    _setApplyOpenRecord(async () => ({
      personaId: 'p1',
      mime: 'image/jpeg',
      width: 10,
      height: 10,
      crop: { x: 0, y: 0, zoom: 1 },
      updatedAt: 1,
      blobRef: ref(AV),
    }));

    await applyRecord(pulled('personaAvatars', 'p1', 5));

    expect(eager).toEqual([{ collection: 'personaAvatars', key: 'p1', field: 'blob', blobId: AV }]);
  });

  it('never enqueues an attachment image (lazy on view)', async () => {
    const eager: EagerCall[] = [];
    _setApplyBlobHooks({
      enqueueEager: (collection, key, field, r) =>
        eager.push({ collection, key, field, blobId: r.blobId }),
      proactiveHeal: async () => undefined,
    });
    _setApplyOpenRecord(async () => ({
      id: 'att1',
      chatId: 'c1',
      messageId: 'm1',
      updatedAt: 1,
      blobRef: ref(id22('att1')),
    }));

    await applyRecord(pulled('attachments', 'att1', 5));

    expect(eager).toHaveLength(0);
  });
});

describe('proactive heal on apply (WS-D §7.2 M-2b)', () => {
  it('heals a pulled ref whose bytes this device still holds', async () => {
    const db = getClientDataDb();
    const B = id22('heal1');
    // Local row already holds the bytes under the same ref.
    await db.artefacts.put({
      id: 'a1',
      chatId: 'c1',
      updatedAt: 1,
      blob: new Blob([new Uint8Array([1, 2, 3, 4])]),
      blobRef: ref(B),
    } as never);

    const heals: string[] = [];
    _setApplyBlobHooks({
      enqueueEager: () => undefined,
      proactiveHeal: async (blobId) => {
        heals.push(blobId);
      },
    });
    // Pulled row wins LWW (newer updatedAt) and carries the same ref.
    _setApplyOpenRecord(async () => ({
      id: 'a1',
      chatId: 'c1',
      updatedAt: 2,
      blobRef: ref(B),
    }));

    const outcome = await applyRecord(pulled('artefacts', 'a1', 5));
    expect(outcome).toEqual({ kind: 'resolved', winner: 'pulled' });
    expect(heals).toEqual([B]);
    // The local bytes were preserved (ref unchanged), not dropped to placeholder.
    expect((await db.artefacts.get('a1'))?.blob?.size).toBe(4);
  });
});

describe('conflict keys per blob collection (WS-D §3 — LWW)', () => {
  it('artefacts + attachments resolve by updatedAt with uuid tie-break', () => {
    for (const c of ['artefacts', 'attachments'] as const) {
      expect(resolveConflict(c, { id: 'a', updatedAt: 1 }, { id: 'a', updatedAt: 2 })).toEqual({
        winner: 'pulled',
        repush: false,
      });
      expect(resolveConflict(c, { id: 'a', updatedAt: 5 }, { id: 'a', updatedAt: 2 })).toEqual({
        winner: 'local',
        repush: true,
      });
      expect(resolveConflict(c, { id: 'a', updatedAt: 3 }, { id: 'b', updatedAt: 3 })).toEqual({
        winner: 'pulled',
        repush: false,
      });
    }
  });

  it('personaAvatars resolves by updatedAt, tie → local (1:1 by personaId)', () => {
    expect(resolveConflict('personaAvatars', { updatedAt: 1 }, { updatedAt: 2 })).toEqual({
      winner: 'pulled',
      repush: false,
    });
    expect(resolveConflict('personaAvatars', { updatedAt: 5 }, { updatedAt: 2 })).toEqual({
      winner: 'local',
      repush: true,
    });
    expect(resolveConflict('personaAvatars', { updatedAt: 3 }, { updatedAt: 3 })).toEqual({
      winner: 'local',
      repush: false,
    });
  });
});
