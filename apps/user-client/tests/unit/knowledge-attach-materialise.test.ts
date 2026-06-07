// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { addDocumentReference, listPendingAttachments } from '../../src/data/attachments.js';
import {
  addDocuments,
  createLibrary,
  deleteDocumentCascade,
  getDocument,
} from '../../src/data/knowledge.js';

// The ingestion queue would otherwise try to load the embedding engine.
vi.mock('../../src/knowledge/start-ingestion.js', () => ({ enqueueDocument: () => {} }));

beforeEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  await openClientDataDb();
});

describe('defensive materialisation on document delete', () => {
  it('freezes the live content into a still-referenced pending attachment before deleting', async () => {
    const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
    const [docId] = await addDocuments(lib.id, [{ title: 'Doc', content: 'body text' }]);
    const doc = await getDocument(docId as string);
    if (!doc) throw new Error('document not found');
    await addDocumentReference('c1', doc);

    // Sanity: the reference carries no copied text yet.
    expect((await listPendingAttachments('c1'))[0]?.text).toBeUndefined();

    await deleteDocumentCascade(docId as string, { deleteWhere: async () => {} } as never);

    const [row] = await listPendingAttachments('c1');
    expect(row?.text).toBe('body text');
    expect(await getDocument(docId as string)).toBeUndefined();
  });

  it('leaves an already-materialised (edited) attachment untouched', async () => {
    const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
    const [docId] = await addDocuments(lib.id, [{ title: 'Doc', content: 'body text' }]);
    const doc = await getDocument(docId as string);
    if (!doc) throw new Error('document not found');
    const attId = await addDocumentReference('c1', doc);
    // Simulate a user edit (materialise).
    const { updateAttachmentText } = await import('../../src/data/attachments.js');
    await updateAttachmentText(attId, 'edited note');

    await deleteDocumentCascade(docId as string, { deleteWhere: async () => {} } as never);

    const [row] = await listPendingAttachments('c1');
    expect(row?.text).toBe('edited note');
  });
});
