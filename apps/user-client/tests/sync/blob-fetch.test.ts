// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import type { MasterKey } from '@chatsundere/crypto';
import type { BlobRef } from '@chatsundere/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  _resetBlobFetchForTests,
  _setBlobFetchDeps,
  boostForKeys,
  enqueueEager,
  fetchRowBlob,
  isEagerQueueActive,
  resolveBlobBytes,
} from '../../src/sync/blob-fetch.js';
import { _resetBlobRepairForTests } from '../../src/sync/blob-repair.js';
import { BlobCorruptBodyError, BlobNotFoundError } from '../../src/sync/blob-transport.js';

// Node's global `Blob` survives fake-indexeddb's structuredClone with real bytes
// (jsdom's does not, and lacks arrayBuffer()) — hence the node env, mirroring
// tests/sync/blob-drain.test.ts.

const FAKE_MK = new Uint8Array([1, 2, 3]) as unknown as MasterKey;

/** A 22-char base64url blob id. */
function id22(seed: string): string {
  return (seed + 'A'.repeat(22)).slice(0, 22);
}

function ref(blobId: string, bytes = 100): BlobRef {
  return { blobId, bytes };
}

/** Never-resolving getBlob that records start order and yields controllable gates. */
function gatedTransport() {
  const starts: string[] = [];
  const gates: Array<(v: Uint8Array) => void> = [];
  let active = 0;
  let maxActive = 0;
  return {
    starts,
    get maxActive() {
      return maxActive;
    },
    getBlob: (r: BlobRef): Promise<Uint8Array> => {
      starts.push(r.blobId);
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise<Uint8Array>((resolve) => {
        gates.push((v) => {
          active -= 1;
          resolve(v);
        });
      });
    },
    release(): void {
      const gate = gates.shift();
      if (gate) gate(new Uint8Array([9]));
    },
    releaseAll(): void {
      while (gates.length > 0) this.release();
    },
  };
}

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  _resetBlobRepairForTests();
  _resetBlobFetchForTests();
  _setBlobFetchDeps({ getMk: () => FAKE_MK, invalidate: () => undefined });
});

afterEach(async () => {
  _resetBlobFetchForTests();
  _resetBlobRepairForTests();
  await _resetClientDataDbForTests();
});

describe('eager queue — concurrency (WS-D §6)', () => {
  it('never runs more than 3 fetches in flight', () => {
    const t = gatedTransport();
    _setBlobFetchDeps({ getBlob: t.getBlob, openBlob: async () => new Uint8Array([1]) });

    for (let i = 0; i < 6; i++) {
      enqueueEager('artefacts', `a${i}`, 'thumbBlob', ref(id22(`t${i}`)));
    }

    // The synchronous portion of each fetch (the getBlob call) has already run.
    expect(t.starts).toHaveLength(3);
    expect(t.maxActive).toBe(3);
    expect(isEagerQueueActive()).toBe(true);
  });

  it('drains the whole queue three at a time as slots free up', async () => {
    const t = gatedTransport();
    _setBlobFetchDeps({ getBlob: t.getBlob, openBlob: async () => new Uint8Array([1]) });

    for (let i = 0; i < 5; i++) {
      enqueueEager('artefacts', `a${i}`, 'thumbBlob', ref(id22(`t${i}`)));
    }
    // Release started fetches until the queue fully drains (each completion frees
    // a slot and pumps the next).
    for (let i = 0; i < 10 && isEagerQueueActive(); i++) {
      t.releaseAll();
      await tick();
      await tick();
    }

    expect(t.starts).toHaveLength(5);
    expect(t.maxActive).toBe(3);
    expect(isEagerQueueActive()).toBe(false);
  });
});

describe('eager queue — view priority (Laura)', () => {
  it('boosts a queued surface ref ahead of plain FIFO', async () => {
    const t = gatedTransport();
    _setBlobFetchDeps({ getBlob: t.getBlob, openBlob: async () => new Uint8Array([1]) });

    // Five entries; concurrency 3 → entries 0..2 start, 3 and 4 queue.
    for (let i = 0; i < 5; i++) {
      enqueueEager('artefacts', `a${i}`, 'thumbBlob', ref(id22(`t${i}`)));
    }
    expect(t.starts).toEqual([id22('t0'), id22('t1'), id22('t2')]);

    // The in-focus surface boosts a4 (still queued behind a3).
    boostForKeys(['a4']);
    // Free one slot → the boosted a4 jumps ahead of a3.
    t.release();
    await tick();
    await tick();

    expect(t.starts[3]).toBe(id22('t4'));
  });
});

describe('lazy resolver — hydrate onto the row (§6)', () => {
  it('placeholder → ready, and the bytes land on the Dexie row', async () => {
    const db = getClientDataDb();
    const B = id22('lz1');
    await db.artefacts.put({
      id: 'a1',
      title: 'Pic',
      blobRef: ref(B),
    } as never);
    _setBlobFetchDeps({
      getBlob: async () => new Uint8Array([1, 2, 3]),
      openBlob: async () => new Uint8Array([7, 7, 7]),
    });

    const before = await resolveBlobBytes('artefacts', 'a1', 'blob');
    expect(before.kind).toBe('missing');

    const result = await fetchRowBlob('artefacts', 'a1', 'blob', ref(B));
    expect(result.state).toBe('ready');

    const row = await db.artefacts.get('a1');
    expect(row?.blob).toBeInstanceOf(Blob);
    expect(row?.blob?.size).toBe(3);

    // A subsequent open hydrates instantly — ready without a fetch.
    const after = await resolveBlobBytes('artefacts', 'a1', 'blob');
    expect(after.kind).toBe('ready');
  });

  it('a present oversize sentinel is terminal, never a fetch', async () => {
    const db = getClientDataDb();
    await db.artefacts.put({
      id: 'a2',
      title: 'Big',
      blobRef: ref(id22('ov1')),
      blobOversized: true,
    } as never);

    const state = await resolveBlobBytes('artefacts', 'a2', 'blob');
    expect(state.kind).toBe('terminal');
  });
});

describe('detach on unmount but the fetch completes onto the row (§6)', () => {
  it('completes the download onto Dexie even after the caller stops listening', async () => {
    const db = getClientDataDb();
    const B = id22('dt1');
    await db.artefacts.put({ id: 'a1', title: 'Pic', blobRef: ref(B) } as never);
    const t = gatedTransport();
    _setBlobFetchDeps({ getBlob: t.getBlob, openBlob: async () => new Uint8Array([5, 5]) });

    // Mount: kick the fetch. The caller (a component) would detach on unmount;
    // here we simply drop the promise's UI use but keep the underlying work.
    const p = fetchRowBlob('artefacts', 'a1', 'blob', ref(B));
    await tick();
    // Mid-fetch: the row is not yet hydrated.
    expect((await db.artefacts.get('a1'))?.blob).toBeUndefined();

    // The fetch completes in the background onto the Dexie row.
    t.release();
    await p;
    expect((await db.artefacts.get('a1'))?.blob?.size).toBe(2);
  });

  it('dedupes concurrent fetches of the same row field to one download', async () => {
    const db = getClientDataDb();
    const B = id22('dd1');
    await db.artefacts.put({ id: 'a1', title: 'Pic', blobRef: ref(B) } as never);
    const t = gatedTransport();
    _setBlobFetchDeps({ getBlob: t.getBlob, openBlob: async () => new Uint8Array([1]) });

    const p1 = fetchRowBlob('artefacts', 'a1', 'blob', ref(B));
    const p2 = fetchRowBlob('artefacts', 'a1', 'blob', ref(B));
    t.releaseAll();
    await Promise.all([p1, p2]);

    expect(t.starts).toHaveLength(1);
  });
});

describe('retry budget + rest-until-next-session (§7.1)', () => {
  it('a dangling ref yields placeholder until it rests terminal', async () => {
    const db = getClientDataDb();
    const B = id22('dang1');
    await db.attachments.put({
      id: 'att1',
      chatId: 'c1',
      messageId: 'm1',
      blobRef: ref(B),
    } as never);
    _setBlobFetchDeps({
      getBlob: async () => {
        throw new BlobNotFoundError();
      },
      openBlob: async () => new Uint8Array(),
    });

    for (let i = 0; i < 8; i++) {
      const r = await fetchRowBlob('attachments', 'att1', 'blob', ref(B));
      expect(r.state).toBe('placeholder');
    }
    // The ninth consecutive failure rests until next session (terminal).
    const rested = await fetchRowBlob('attachments', 'att1', 'blob', ref(B));
    expect(rested.state).toBe('terminal');
  });
});

describe('size-gate / open failure → no partial row write (§7.2)', () => {
  it('an over-ref-size stream (corrupt body) never writes bytes to the row', async () => {
    const db = getClientDataDb();
    const B = id22('sg1');
    await db.artefacts.put({ id: 'a1', title: 'Pic', blobRef: ref(B) } as never);
    _setBlobFetchDeps({
      getBlob: async () => {
        throw new BlobCorruptBodyError('too big');
      },
      openBlob: async () => new Uint8Array([1]),
    });

    const r = await fetchRowBlob('artefacts', 'a1', 'blob', ref(B));
    expect(r.state).toBe('placeholder');
    expect((await db.artefacts.get('a1'))?.blob).toBeUndefined();
  });

  it('an openBlob failure never writes bytes to the row', async () => {
    const db = getClientDataDb();
    const B = id22('of1');
    await db.artefacts.put({ id: 'a2', title: 'Pic', blobRef: ref(B) } as never);
    _setBlobFetchDeps({
      getBlob: async () => new Uint8Array([1, 2, 3, 4]),
      openBlob: async () => {
        throw new Error('AEAD verification failed');
      },
    });

    const r = await fetchRowBlob('artefacts', 'a2', 'blob', ref(B));
    expect(r.state).toBe('placeholder');
    expect((await db.artefacts.get('a2'))?.blob).toBeUndefined();
  });
});
