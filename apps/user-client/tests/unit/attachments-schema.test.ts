// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AttachmentRow,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
});

describe('attachments schema (Dexie v12)', () => {
  it('opens at verno 12 with an attachments table', async () => {
    const db = await openClientDataDb();
    expect(db.verno).toBe(18);
    expect(db.tables.map((t) => t.name)).toContain('attachments');
  });

  it('seeds substituteVisionModel = null on the settings row', async () => {
    const db = await openClientDataDb();
    const row = await db.settings.get(1);
    expect(row?.substituteVisionModel).toBeNull();
  });

  it('round-trips a pending image attachment and finds it by chatId with null messageId', async () => {
    const db = await openClientDataDb();
    const att: AttachmentRow = {
      id: 'a1',
      chatId: 'c1',
      messageId: null,
      origin: 'upload',
      kind: 'image',
      fileName: 'screen.png',
      mime: 'image/jpeg',
      order: 0,
      state: 'active',
      createdAt: 1,
      blob: new Blob(['x'], { type: 'image/jpeg' }),
      width: 100,
      height: 80,
      visionDescription: null,
    };
    await db.attachments.add(att);
    // IDB does not allow null in compound keys; pending rows are queried by chatId + JS filter.
    const pending = await db.attachments
      .where('chatId')
      .equals('c1')
      .filter((r) => r.messageId === null)
      .toArray();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.fileName).toBe('screen.png');
  });
});
