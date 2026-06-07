// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import {
  addAttachment,
  addDocumentReference,
  attachPendingToMessage,
  listMessageAttachments,
  listPendingAttachments,
  removeAttachment,
  renameAttachment,
  updateAttachmentText,
} from '../../src/data/attachments.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});

function imageInput(name: string) {
  return {
    chatId: 'c1',
    kind: 'image' as const,
    fileName: name,
    mime: 'image/jpeg',
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    width: 10,
    height: 10,
  };
}

describe('attachment data ops', () => {
  it('adds pending attachments with incrementing order and lists them', async () => {
    await addAttachment(imageInput('a.png'));
    await addAttachment(imageInput('b.png'));
    const pending = await listPendingAttachments('c1');
    expect(pending.map((a) => a.fileName)).toEqual(['a.png', 'b.png']);
    expect(pending.map((a) => a.order)).toEqual([0, 1]);
    expect(pending.every((a) => a.messageId === null && a.state === 'active')).toBe(true);
  });

  it('removes a pending attachment', async () => {
    const id = await addAttachment(imageInput('a.png'));
    await removeAttachment(id);
    expect(await listPendingAttachments('c1')).toHaveLength(0);
  });

  it('renames and updates text', async () => {
    const id = await addAttachment({
      chatId: 'c1',
      kind: 'text',
      fileName: 'n.md',
      mime: 'text/markdown',
      text: 'hello',
    });
    await renameAttachment(id, 'notes.md');
    await updateAttachmentText(id, 'world');
    const [row] = await listPendingAttachments('c1');
    expect(row?.fileName).toBe('notes.md');
    expect(row?.text).toBe('world');
  });

  it('attaches all pending to a message id and they leave the pending set', async () => {
    await addAttachment(imageInput('a.png'));
    await addAttachment(imageInput('b.png'));
    await attachPendingToMessage('c1', 'm1');
    expect(await listPendingAttachments('c1')).toHaveLength(0);
    expect((await listMessageAttachments('m1')).map((a) => a.fileName)).toEqual(['a.png', 'b.png']);
  });

  it('stores a library-origin attachment with a kbRef and defaults kbRef to null otherwise', async () => {
    const upload = await addAttachment({
      chatId: 'c1',
      kind: 'text',
      fileName: 'plain.md',
      mime: 'text/markdown',
      text: 'hi',
    });
    const libRef = await addAttachment({
      chatId: 'c1',
      kind: 'text',
      fileName: 'Doc.md',
      mime: 'text/markdown',
      origin: 'library',
      kbRef: { libraryId: 'lib1', documentId: 'doc1' },
    });
    const rows = await listPendingAttachments('c1');
    const u = rows.find((r) => r.id === upload);
    const l = rows.find((r) => r.id === libRef);
    expect(u?.origin).toBe('upload');
    expect(u?.kbRef).toBeNull();
    expect(l?.origin).toBe('library');
    expect(l?.kbRef).toEqual({ libraryId: 'lib1', documentId: 'doc1' });
    expect(l?.text).toBeUndefined();
  });
});

describe('document references (attach document)', () => {
  it('creates a copy-on-write pending reference: no text, kbRef set, .md filename', async () => {
    const id = await addDocumentReference('c1', {
      id: 'doc1',
      libraryId: 'lib1',
      title: 'Brand Guidelines',
      content: 'the full markdown body',
      embeddingStatus: 'ready',
      embeddingError: null,
      chunkCount: 3,
      triggerPhrases: [],
      createdAt: 0,
      updatedAt: 0,
    });
    const [row] = await listPendingAttachments('c1');
    expect(row?.id).toBe(id);
    expect(row?.origin).toBe('library');
    expect(row?.kind).toBe('text');
    expect(row?.fileName).toBe('Brand Guidelines.md');
    expect(row?.mime).toBe('text/markdown');
    expect(row?.kbRef).toEqual({ libraryId: 'lib1', documentId: 'doc1' });
    expect(row?.text).toBeUndefined();
  });
});
