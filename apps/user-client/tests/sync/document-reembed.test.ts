// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { toBase64Url } from '@chatsundere/crypto';
import type { SyncCollection, SyncPulledRecord } from '@chatsundere/shared-types';
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
  _setApplyComputeBlindId,
  _setApplyDocumentReembedHooks,
  _setApplyOpenRecord,
  applyRecord,
} from '../../src/sync/apply.js';

/**
 * Finding V (Workstream B, Medium): the knowledge design is deliberately
 * one-directional for vectors — a peer RE-EMBEDS a pulled document from its
 * `content` rather than receiving vector bytes (§ apply.ts §7.5 `vectors`
 * skip). Before this fix, `documents` had no deny-list entry, so
 * `embeddingStatus` sealed and synced whole: a document landed on a fresh
 * device already `ready`/`embedded` with ZERO local vectors and was never
 * picked up by the boot ingestion sweep (which only scans `pending`) —
 * silently unsearchable on that device.
 */

function fakeBlindId(collection: string, key: string): Uint8Array {
  return new TextEncoder().encode(`bid:${collection}:${key}`);
}

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

describe('applyRecord — documents re-embed device-locally (Finding V)', () => {
  it('a freshly-pulled document with no local vectors lands `pending` and is enqueued', async () => {
    _setApplyDocumentReembedHooks({
      hasLocalVectors: async () => false, // fresh device — nothing embedded yet
    });
    const enqueued: string[] = [];
    _setApplyDocumentReembedHooks({ triggerReembed: (id) => enqueued.push(id) });

    // The wire row never carries embeddingStatus/embeddingError/chunkCount —
    // they are deny-listed (stripped before seal) — so the open seam returns a
    // row shaped exactly like what a peer's `stripForSeal('documents', …)` would
    // actually produce.
    _setApplyOpenRecord(async () => ({
      id: 'd1',
      libraryId: 'l1',
      title: 'Doc',
      content: 'hello world',
      triggerPhrases: [],
      createdAt: 1,
      updatedAt: 5,
    }));

    const outcome = await applyRecord(pulled('documents', 'd1', 9));
    expect(outcome.kind).toBe('inserted');

    const db = getClientDataDb();
    const row = await db.documents.get('d1');
    expect(row?.embeddingStatus).toBe('pending');
    expect(row?.embeddingError).toBeNull();
    expect(row?.chunkCount).toBe(0);
    expect(enqueued).toEqual(['d1']);
  });

  it('a pulled document that already has local vectors keeps its local embedding state', async () => {
    const db = getClientDataDb();
    await db.documents.put({
      id: 'd2',
      libraryId: 'l1',
      title: 'Doc old title',
      content: 'old content',
      embeddingStatus: 'ready',
      embeddingError: null,
      chunkCount: 3,
      triggerPhrases: [],
      createdAt: 1,
      updatedAt: 1,
    } as never);
    await db.syncRows.put({ collection: 'documents', key: 'd2', rev: 1, ciphertextHash: 'x' });

    _setApplyDocumentReembedHooks({
      hasLocalVectors: async () => true, // this device already embedded it
    });
    const enqueued: string[] = [];
    _setApplyDocumentReembedHooks({ triggerReembed: (id) => enqueued.push(id) });

    _setApplyOpenRecord(async () => ({
      id: 'd2',
      libraryId: 'l1',
      title: 'Doc new title',
      content: 'old content',
      triggerPhrases: [],
      createdAt: 1,
      updatedAt: 5, // newer — pulled wins LWW
    }));

    const outcome = await applyRecord(pulled('documents', 'd2', 9));
    expect(outcome).toEqual({ kind: 'resolved', winner: 'pulled' });

    const row = await db.documents.get('d2');
    expect(row?.title).toBe('Doc new title'); // synced field applied
    expect(row?.embeddingStatus).toBe('ready'); // device-local state preserved
    expect(row?.chunkCount).toBe(3);
    expect(enqueued).toEqual([]); // no re-embed needed — vectors already present
  });
});
