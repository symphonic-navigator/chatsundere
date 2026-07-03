// SPDX-License-Identifier: AGPL-3.0-only
import type { BlobRef } from '@chatsundere/shared-types';
import { describe, expect, it } from 'vitest';
import { applyPulledBlobRow, stripBlobsForSeal } from '../../src/sync/blob-transform.js';

const BLOB_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const OVERHEAD = 28; // nonce(12) + GCM tag(16)

function blobOf(size: number): Blob {
  return new Blob([new Uint8Array(size)], { type: 'image/jpeg' });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

describe('blob-transform — stripBlobsForSeal (§4 seal-side)', () => {
  it('artefacts: mints both refs, drops both Blob fields, returns both new blobs', () => {
    const blob = blobOf(1000);
    const thumbBlob = blobOf(200);
    const { wireRow, newBlobs } = stripBlobsForSeal('artefacts', {
      id: 'a1',
      title: 'Pic',
      blob,
      thumbBlob,
    });
    const wire = asRecord(wireRow);

    expect('blob' in wire).toBe(false);
    expect('thumbBlob' in wire).toBe(false);
    expect(wire.title).toBe('Pic');

    const blobRef = wire.blobRef as BlobRef;
    const thumbBlobRef = wire.thumbBlobRef as BlobRef;
    expect(blobRef.blobId).toMatch(BLOB_ID_RE);
    expect(thumbBlobRef.blobId).toMatch(BLOB_ID_RE);
    expect(blobRef.bytes).toBe(1000 + OVERHEAD);
    expect(thumbBlobRef.bytes).toBe(200 + OVERHEAD);
    expect(blobRef.blobId).not.toBe(thumbBlobRef.blobId);

    expect(newBlobs).toHaveLength(2);
    const ids = newBlobs.map((b) => b.blobId).sort();
    expect(ids).toEqual([blobRef.blobId, thumbBlobRef.blobId].sort());
    expect(newBlobs.find((b) => b.blobId === blobRef.blobId)?.bytes).toBe(blob);
  });

  it('attachments: mints one ref, drops the Blob field, one new blob', () => {
    const blob = blobOf(4096);
    const { wireRow, newBlobs } = stripBlobsForSeal('attachments', {
      id: 'att1',
      fileName: 'x.jpg',
      blob,
    });
    const wire = asRecord(wireRow);
    expect('blob' in wire).toBe(false);
    expect((wire.blobRef as BlobRef).bytes).toBe(4096 + OVERHEAD);
    expect(newBlobs).toHaveLength(1);
    expect(newBlobs[0]?.bytes).toBe(blob);
  });

  it('personaAvatars: mints a ref for present bytes', () => {
    const blob = blobOf(8192);
    const { wireRow, newBlobs } = stripBlobsForSeal('personaAvatars', {
      personaId: 'p1',
      blob,
      mime: 'image/jpeg',
    });
    const wire = asRecord(wireRow);
    expect('blob' in wire).toBe(false);
    expect((wire.blobRef as BlobRef).blobId).toMatch(BLOB_ID_RE);
    expect(newBlobs).toHaveLength(1);
  });

  it('avatar removal → blobRef: null, NEVER a tombstone, no new blob', () => {
    const { wireRow, newBlobs } = stripBlobsForSeal('personaAvatars', {
      personaId: 'p1',
      mime: 'image/jpeg',
      // no blob present — the avatar was removed
    });
    const wire = asRecord(wireRow);
    expect(wire.blobRef).toBeNull();
    // The wire row is a normal upsert body carrying the persona key — not a
    // tombstone (which would carry no body and brick avatar sync forever).
    expect(wire.personaId).toBe('p1');
    expect(newBlobs).toHaveLength(0);
  });

  it('ref stability: a row already carrying a ref reuses it and queues nothing', () => {
    const blob = blobOf(1000);
    const first = stripBlobsForSeal('attachments', { id: 'att1', blob });
    const ref = asRecord(first.wireRow).blobRef as BlobRef;

    // Simulate the enqueue site persisting the ref back onto the local row.
    const second = stripBlobsForSeal('attachments', { id: 'att1', blob, blobRef: ref });
    expect(asRecord(second.wireRow).blobRef).toEqual(ref);
    expect(second.newBlobs).toHaveLength(0);
  });

  it('sentinel passthrough: an oversize sentinel rides into the wire row', () => {
    const blob = blobOf(1000);
    const ref: BlobRef = { blobId: 'AAAAAAAAAAAAAAAAAAAAAA', bytes: 1028 };
    const { wireRow, newBlobs } = stripBlobsForSeal('artefacts', {
      id: 'a1',
      blob,
      blobRef: ref,
      blobOversized: true,
    });
    const wire = asRecord(wireRow);
    expect(wire.blobOversized).toBe(true);
    expect(wire.blobRef).toEqual(ref); // reused
    expect(newBlobs).toHaveLength(0); // oversized ⇒ never re-uploaded
  });
});

describe('blob-transform — applyPulledBlobRow (§4 apply-side)', () => {
  it('artefacts: preserves local bytes when both refs match; placeholder when they differ', () => {
    const blob = blobOf(1000);
    const thumbBlob = blobOf(200);
    const blobRef: BlobRef = { blobId: 'AAAAAAAAAAAAAAAAAAAAAA', bytes: 1028 };
    const thumbBlobRef: BlobRef = { blobId: 'BBBBBBBBBBBBBBBBBBBBBB', bytes: 228 };
    const newThumbRef: BlobRef = { blobId: 'CCCCCCCCCCCCCCCCCCCCCC', bytes: 999 };

    const local = { id: 'a1', blob, thumbBlob, blobRef, thumbBlobRef };
    // The pulled row kept blobRef but the thumb ref changed (re-imaged elsewhere).
    const pulled = { id: 'a1', blobRef, thumbBlobRef: newThumbRef };

    const out = asRecord(applyPulledBlobRow('artefacts', pulled, local));
    expect(out.blob).toBe(blob); // ref unchanged → bytes kept
    expect('thumbBlob' in out).toBe(false); // ref changed → placeholder, bytes dropped
    expect(out.thumbBlobRef).toEqual(newThumbRef); // pulled ref stands
  });

  it('attachments: placeholder state on a pulled ref with no local bytes', () => {
    const blobRef: BlobRef = { blobId: 'AAAAAAAAAAAAAAAAAAAAAA', bytes: 1028 };
    const out = asRecord(applyPulledBlobRow('attachments', { id: 'att1', blobRef }, undefined));
    expect(out.blobRef).toEqual(blobRef);
    expect('blob' in out).toBe(false);
  });

  it('personaAvatars: a pulled blobRef null leaves no bytes and null ref (removal synced)', () => {
    const blob = blobOf(8192);
    const oldRef: BlobRef = { blobId: 'AAAAAAAAAAAAAAAAAAAAAA', bytes: 8220 };
    const local = { personaId: 'p1', blob, blobRef: oldRef };
    const pulled = { personaId: 'p1', blobRef: null };
    const out = asRecord(applyPulledBlobRow('personaAvatars', pulled, local));
    expect(out.blobRef).toBeNull();
    expect('blob' in out).toBe(false);
  });

  it('sentinel-aware: a synced blobOversized survives application', () => {
    const blobRef: BlobRef = { blobId: 'AAAAAAAAAAAAAAAAAAAAAA', bytes: 1028 };
    const out = asRecord(
      applyPulledBlobRow('attachments', { id: 'att1', blobRef, blobOversized: true }, undefined),
    );
    expect(out.blobOversized).toBe(true);
    expect('blob' in out).toBe(false);
  });

  it('personaAvatars: preserves local bytes when the ref matches', () => {
    const blob = blobOf(8192);
    const ref: BlobRef = { blobId: 'AAAAAAAAAAAAAAAAAAAAAA', bytes: 8220 };
    const local = { personaId: 'p1', blob, blobRef: ref };
    const pulled = { personaId: 'p1', blobRef: ref };
    const out = asRecord(applyPulledBlobRow('personaAvatars', pulled, local));
    expect(out.blob).toBe(blob);
    expect(out.blobRef).toEqual(ref);
  });
});
