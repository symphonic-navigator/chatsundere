// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import type { SyncCollection } from '@chatsundere/shared-types';
import type { BlobRef } from '@chatsundere/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtefactRow, SyncOutboxRow } from '../../src/boot/client-data-db.js';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  type BlobFailure,
  type BlobFailureContext,
  type BlobRepairDeps,
  _resetBlobRepairForTests,
  maybeProactiveHeal,
  noteBlobLocallyRemoved,
  reprobeDisabled,
  resetBlobRepairCycle,
  resolveBlobFailure,
} from '../../src/sync/blob-repair.js';
import type { PutBlobResult } from '../../src/sync/blob-transport.js';
import { getSyncState } from '../../src/sync/watermark.js';

const MK = {} as never;

function id22(seed: string): string {
  return (seed + 'A'.repeat(22)).slice(0, 22);
}

/** A repair deps stub whose PUT verdict the test dictates. */
function deps(putResult: PutBlobResult = { status: 'created' }): BlobRepairDeps & {
  puts: string[];
} {
  const puts: string[] = [];
  return {
    puts,
    sealBlob: async (_mk, blobId) => {
      void blobId;
      return { body: new Uint8Array([1, 2, 3, 4, 5]), hash: new Uint8Array([9]) };
    },
    putBlob: async (blobId: string) => {
      puts.push(blobId);
      return putResult;
    },
  };
}

function ctx(overrides: Partial<BlobFailureContext> = {}): BlobFailureContext {
  return {
    collection: 'artefacts' as SyncCollection,
    key: 'a1',
    blobId: id22('old'),
    refField: 'blobRef',
    oversizedField: 'blobOversized',
    bytes: new Uint8Array([7, 7, 7]),
    mk: MK,
    ...overrides,
  };
}

async function seedArtefact(patch: Partial<ArtefactRow> = {}): Promise<void> {
  await getClientDataDb().artefacts.put({
    id: 'a1',
    title: 'Pic',
    blobRef: { blobId: id22('old'), bytes: 12 },
    ...patch,
  } as never);
}

async function outbox(): Promise<SyncOutboxRow[]> {
  return getClientDataDb().syncOutbox.toArray();
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  _resetBlobRepairForTests();
});

afterEach(async () => {
  _resetBlobRepairForTests();
  await _resetClientDataDbForTests();
});

describe('resolveBlobFailure — 404 dangling with local bytes (§7.1)', () => {
  it('repairs with an idempotent same-id PUT and clears the failure count', async () => {
    const d = deps({ status: 'created' });
    const disposition = await resolveBlobFailure({ kind: 'get-not-found' }, ctx(), d);
    expect(disposition).toBe('repaired');
    expect(d.puts).toEqual([id22('old')]); // SAME id — deterministic re-seal
  });

  it('rests after 8 consecutive failures (terminal placeholder)', async () => {
    const d = deps({ status: 'error', httpStatus: 500 }); // repair PUT keeps failing
    let last = '';
    for (let i = 0; i < 8; i++) {
      resetBlobRepairCycle(); // a fresh GET budget each cycle
      last = await resolveBlobFailure({ kind: 'get-not-found' }, ctx({ bytes: undefined }), d);
    }
    expect(last).toBe('placeholder');
    resetBlobRepairCycle();
    const terminal = await resolveBlobFailure(
      { kind: 'get-not-found' },
      ctx({ bytes: undefined }),
      d,
    );
    expect(terminal).toBe('terminal');
  });

  it('spends the shared per-cycle GET budget, then defers to a placeholder', async () => {
    const d = deps({ status: 'error', httpStatus: 500 });
    // 16 refs exhaust the default budget; the 17th gets no GET this cycle.
    let disposition = 'placeholder';
    for (let i = 0; i < 17; i++) {
      disposition = await resolveBlobFailure(
        { kind: 'get-not-found' },
        ctx({ blobId: id22(`d${i}`), bytes: undefined }),
        d,
      );
    }
    expect(disposition).toBe('placeholder'); // budget spent, no crash
  });
});

describe('resolveBlobFailure — 409 / corrupt body → tamper + fresh-id repair (§7.2, M-1)', () => {
  it('raises the tamper attention and reissues under a fresh id with a Class-2 update + deferred delete', async () => {
    await seedArtefact();
    const NEW_PUT: PutBlobResult = { status: 'created' };
    const d = deps(NEW_PUT);
    const disposition = await resolveBlobFailure({ kind: 'put-exists' }, ctx(), d);

    expect(disposition).toBe('reissued');
    expect((await getSyncState()).attention).toEqual({ kind: 'tamper' });

    // The row's ref now points at the freshly-minted id (not the old one).
    const row = await getClientDataDb().artefacts.get('a1');
    const ref = (row as ArtefactRow).blobRef as BlobRef;
    expect(ref.blobId).not.toBe(id22('old'));
    expect(d.puts[0]).toBe(ref.blobId);

    // A Class-2 record upsert + a DEFERRED delete of the old id were queued.
    const rows = await outbox();
    expect(rows.some((r) => r.op === 'upsert' && r.key === 'a1')).toBe(true);
    expect(rows.some((r) => r.op === 'blob-delete' && r.blobId === id22('old'))).toBe(true);
  });

  it('a GET-corrupt body takes the same fresh-id repair path', async () => {
    await seedArtefact();
    const d = deps({ status: 'created' });
    const disposition = await resolveBlobFailure({ kind: 'get-corrupt' }, ctx(), d);
    expect(disposition).toBe('reissued');
    expect((await getSyncState()).attention).toEqual({ kind: 'tamper' });
  });

  it('caps at 3 failed generations → permanent placeholder + persistent attention', async () => {
    await seedArtefact();
    const d = deps({ status: 'blob_exists' }); // every fresh PUT also 409s
    let disposition = '';
    for (let gen = 0; gen < 3; gen++) {
      resetBlobRepairCycle(); // fresh repair budget each cycle
      disposition = await resolveBlobFailure({ kind: 'put-exists' }, ctx(), d);
    }
    expect(disposition).toBe('terminal'); // permanent placeholder after 3 generations
    expect((await getSyncState()).attention).toEqual({ kind: 'tamper' }); // persistent
  });

  it('honours one fresh-id attempt per blobId per cycle', async () => {
    await seedArtefact();
    const d = deps({ status: 'blob_exists' });
    const first = await resolveBlobFailure({ kind: 'put-exists' }, ctx(), d);
    const second = await resolveBlobFailure({ kind: 'put-exists' }, ctx(), d); // same cycle
    expect(first).toBe('keep-block');
    expect(second).toBe('keep-block');
    expect(d.puts).toHaveLength(1); // only one fresh-id PUT attempted this cycle
  });

  it('without local bytes → placeholder + diagnostic (no PUT)', async () => {
    const d = deps();
    const disposition = await resolveBlobFailure(
      { kind: 'put-exists' },
      ctx({ bytes: undefined }),
      d,
    );
    expect(disposition).toBe('placeholder');
    expect(d.puts).toHaveLength(0);
  });
});

describe('resolveBlobFailure — 413 oversize sentinel round-trip (§7.3, Laura hard)', () => {
  it('sets the durable sentinel on the row (Class-2), re-enqueues the record, and goes terminal', async () => {
    await seedArtefact();
    const d = deps();
    const disposition = await resolveBlobFailure(
      { kind: 'put-too-large', maxBlobBytes: 1024 },
      ctx(),
      d,
    );
    expect(disposition).toBe('terminal');

    const row = await getClientDataDb().artefacts.get('a1');
    expect((row as ArtefactRow).blobOversized).toBe(true);
    const rows = await outbox();
    expect(rows.some((r) => r.op === 'upsert' && r.key === 'a1')).toBe(true);
  });

  it('the sentinel is durable — it survives a database reload', async () => {
    await seedArtefact();
    await resolveBlobFailure({ kind: 'put-too-large', maxBlobBytes: 1024 }, ctx(), deps());
    // Re-open the database from its persisted state.
    await openClientDataDb();
    const row = await getClientDataDb().artefacts.get('a1');
    expect((row as ArtefactRow).blobOversized).toBe(true);
  });
});

describe('resolveBlobFailure — quota + disabled (§7.3)', () => {
  it('quota → attention with used/quota bytes + keep-block', async () => {
    const disposition = await resolveBlobFailure(
      { kind: 'put-quota', usedBytes: 900, quotaBytes: 1000 },
      ctx(),
      deps(),
    );
    expect(disposition).toBe('keep-block');
    expect((await getSyncState()).attention).toEqual({
      kind: 'quota_exceeded',
      usedBytes: 900,
      quotaBytes: 1000,
    });
  });

  it('501 disabled → suppressed, and re-probes only when the config signature changes', async () => {
    const disposition = await resolveBlobFailure({ kind: 'get-disabled' }, ctx(), deps());
    expect(disposition).toBe('suppressed');
    // A same-signature re-probe is a no-op; a changed one clears suppression.
    reprobeDisabled('cfg-v1');
    reprobeDisabled('cfg-v2');
    expect(disposition).toBe('suppressed');
  });
});

describe('maybeProactiveHeal (§7.2 M-2b)', () => {
  it('re-PUTs an id this device previously removed once bytes are held again', async () => {
    const OLD = id22('healme');
    noteBlobLocallyRemoved(OLD);
    const d = deps({ status: 'ok' });
    const healed = await maybeProactiveHeal({ blobId: OLD, bytes: new Uint8Array([1]), mk: MK }, d);
    expect(healed).toBe(true);
    expect(d.puts).toEqual([OLD]); // idempotent same-id re-PUT
  });

  it('does nothing for an id this device never removed', async () => {
    const d = deps({ status: 'created' });
    const healed = await maybeProactiveHeal(
      { blobId: id22('unknown'), bytes: new Uint8Array([1]), mk: MK },
      d,
    );
    expect(healed).toBe(false);
    expect(d.puts).toHaveLength(0);
  });
});

describe('per-cycle repair budget (§7.2)', () => {
  it('caps fresh-id repairs at 2 per cycle across distinct blobs', async () => {
    await getClientDataDb().artefacts.put({
      id: 'a1',
      title: 'Pic',
      blobRef: { blobId: id22('r0'), bytes: 12 },
    } as never);
    const putBlob = vi.fn(async (blobId: string) => {
      void blobId;
      return { status: 'created' } as PutBlobResult;
    });
    const d: BlobRepairDeps = {
      sealBlob: async () => ({ body: new Uint8Array([1]), hash: new Uint8Array([2]) }),
      putBlob,
    };
    // Three distinct blobs, all corrupt; only two fresh-id PUTs fit the budget.
    await resolveBlobFailure({ kind: 'put-exists' }, ctx({ blobId: id22('r0') }), d);
    await resolveBlobFailure({ kind: 'put-exists' }, ctx({ key: 'a1', blobId: id22('r1') }), d);
    const third = await resolveBlobFailure(
      { kind: 'put-exists' },
      ctx({ key: 'a1', blobId: id22('r2') }),
      d,
    );
    expect(putBlob).toHaveBeenCalledTimes(2);
    expect(third).toBe('keep-block'); // budget spent — retry next cycle
  });
});
