// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import type { BlobRef } from '@chatsundere/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ArtefactRow,
  AttachmentRow,
  PersonaAvatarRow,
} from '../../src/boot/client-data-db.js';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

/**
 * WS-D Task 1 — the §4 ref/sentinel fields are INTERFACE-ONLY additions to the
 * three blob-bearing row interfaces (non-indexed, no Dexie version bump). This
 * suite pins two things: v33 still opens at v33 (no verno bump snuck in), and
 * the new optional fields round-trip through Dexie untouched.
 */
describe('client-data-db — WS-D blob ref/sentinel row fields (§4)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('still opens at verno 33 — no schema bump from the interface additions', () => {
    expect(getClientDataDb().verno).toBe(33);
  });

  it('round-trips an artefact carrying both refs and both oversize sentinels', async () => {
    const db = getClientDataDb();
    const blobRef: BlobRef = { blobId: 'AAAAAAAAAAAAAAAAAAAAAA', bytes: 1028 };
    const thumbBlobRef: BlobRef = { blobId: 'BBBBBBBBBBBBBBBBBBBBBB', bytes: 228 };
    const row: ArtefactRow = {
      id: 'art-1',
      chatId: 'chat-1',
      personaId: 'p1',
      projectId: null,
      origin: 'generated',
      kind: 'image',
      format: 'image',
      title: 'A picture',
      fileName: 'a.jpg',
      mime: 'image/jpeg',
      content: '',
      tags: [],
      favourite: false,
      createdAt: 1,
      updatedAt: 2,
      blobRef,
      thumbBlobRef,
      blobOversized: true,
      thumbBlobOversized: true,
    };
    await db.artefacts.put(row);
    const read = await db.artefacts.get('art-1');
    expect(read?.blobRef).toEqual(blobRef);
    expect(read?.thumbBlobRef).toEqual(thumbBlobRef);
    expect(read?.blobOversized).toBe(true);
    expect(read?.thumbBlobOversized).toBe(true);
  });

  it('round-trips an attachment carrying a ref and the oversize sentinel', async () => {
    const db = getClientDataDb();
    const blobRef: BlobRef = { blobId: 'CCCCCCCCCCCCCCCCCCCCCC', bytes: 4096 };
    const row: AttachmentRow = {
      id: 'att-1',
      chatId: 'chat-1',
      messageId: 'msg-1',
      origin: 'upload',
      kind: 'image',
      fileName: 'x.jpg',
      mime: 'image/jpeg',
      order: 0,
      state: 'active',
      createdAt: 1,
      updatedAt: 2,
      blobRef,
      blobOversized: true,
    };
    await db.attachments.put(row);
    const read = await db.attachments.get('att-1');
    expect(read?.blobRef).toEqual(blobRef);
    expect(read?.blobOversized).toBe(true);
  });

  it('round-trips a persona avatar with a ref, and with the removal sentinel (blobRef: null)', async () => {
    const db = getClientDataDb();
    const blobRef: BlobRef = { blobId: 'DDDDDDDDDDDDDDDDDDDDDD', bytes: 8220 };
    const present: PersonaAvatarRow = {
      personaId: 'p1',
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
      mime: 'image/jpeg',
      width: 64,
      height: 64,
      crop: { x: 0, y: 0, zoom: 1 },
      updatedAt: 1,
      blobRef,
    };
    await db.personaAvatars.put(present);
    expect((await db.personaAvatars.get('p1'))?.blobRef).toEqual(blobRef);

    // Removal keeps the row (never a tombstone) and records blobRef: null.
    const removed: PersonaAvatarRow = {
      personaId: 'p2',
      blob: new Blob([], { type: 'image/jpeg' }),
      mime: 'image/jpeg',
      width: 0,
      height: 0,
      crop: { x: 0, y: 0, zoom: 1 },
      updatedAt: 2,
      blobRef: null,
    };
    await db.personaAvatars.put(removed);
    const read = await db.personaAvatars.get('p2');
    expect(read).toBeDefined();
    expect(read?.blobRef).toBeNull();
  });
});
