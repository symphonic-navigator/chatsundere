// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  addAttachment,
  attachmentRemovalRoute,
  clearPendingAttachments,
  listEditAttachments,
  listPendingAttachments,
} from '../../src/data/attachments.js';

async function seedOriginal(chatId: string, messageId: string, name: string): Promise<string> {
  const id = await addAttachment({
    chatId,
    kind: 'text',
    fileName: name,
    mime: 'text/plain',
    text: name,
  });
  await getClientDataDb().attachments.update(id, { messageId });
  return id;
}

beforeEach(async () => {
  await openClientDataDb();
  await getClientDataDb().attachments.clear();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('listEditAttachments', () => {
  it('is empty when editingMessageId is null', async () => {
    await seedOriginal('c1', 'u1', 'keep');
    expect(await listEditAttachments('c1', null, [])).toEqual([]);
  });

  it('composes surviving originals (minus staged removals) with pending additions', async () => {
    const keep = await seedOriginal('c1', 'u1', 'keep');
    const drop = await seedOriginal('c1', 'u1', 'drop');
    const added = await addAttachment({
      chatId: 'c1',
      kind: 'text',
      fileName: 'new',
      mime: 'text/plain',
      text: 'new',
    });

    const result = await listEditAttachments('c1', 'u1', [drop]);

    expect(result.map((a) => a.id)).toEqual([keep, added]);
  });

  it('excludes a soft-deleted original even when not staged for removal', async () => {
    const deleted = await seedOriginal('c1', 'u1', 'gone');
    await getClientDataDb().attachments.update(deleted, { state: 'deleted' });

    const result = await listEditAttachments('c1', 'u1', []);

    expect(result).toEqual([]);
  });
});

describe('clearPendingAttachments', () => {
  it('deletes only pending (messageId === null) rows for the chat', async () => {
    const original = await seedOriginal('c1', 'u1', 'sent');
    const pending = await addAttachment({
      chatId: 'c1',
      kind: 'text',
      fileName: 'draft',
      mime: 'text/plain',
      text: 'draft',
    });

    await clearPendingAttachments('c1');

    const db = getClientDataDb();
    expect(await db.attachments.get(original)).toBeDefined();
    expect(await db.attachments.get(pending)).toBeUndefined();
    expect(await listPendingAttachments('c1')).toHaveLength(0);
  });

  it('leaves another chat’s pending attachments untouched', async () => {
    const otherPending = await addAttachment({
      chatId: 'c2',
      kind: 'text',
      fileName: 'other',
      mime: 'text/plain',
      text: 'other',
    });

    await clearPendingAttachments('c1');

    expect(await getClientDataDb().attachments.get(otherPending)).toBeDefined();
  });
});

describe('attachmentRemovalRoute', () => {
  it('stages removal for an original bound to the message being edited', () => {
    expect(attachmentRemovalRoute('u1', 'u1')).toBe('stage');
  });

  it('deletes a pending addition (messageId null) even while editing', () => {
    expect(attachmentRemovalRoute(null, 'u1')).toBe('delete');
  });

  it('deletes an attachment bound to a different message than the one being edited', () => {
    expect(attachmentRemovalRoute('u-other', 'u1')).toBe('delete');
  });

  it('deletes when not editing at all', () => {
    expect(attachmentRemovalRoute('u1', null)).toBe('delete');
  });
});
