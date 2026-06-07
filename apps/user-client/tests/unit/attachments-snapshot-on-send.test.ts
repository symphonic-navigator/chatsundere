// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  addDocumentReference,
  listPendingAttachments,
  snapshotPendingDocumentReferences,
  updateAttachmentText,
} from '../../src/data/attachments.js';
import { addDocuments, createLibrary, getDocument } from '../../src/data/knowledge.js';

vi.mock('../../src/knowledge/start-ingestion.js', () => ({ enqueueDocument: () => {} }));

beforeEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  await openClientDataDb();
});

describe('snapshotPendingDocumentReferences', () => {
  it('freezes live content for unmaterialised references and leaves edited ones alone', async () => {
    const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
    const [refId] = await addDocuments(lib.id, [{ title: 'Ref', content: 'live body' }]);
    const [editId] = await addDocuments(lib.id, [{ title: 'Edited', content: 'original' }]);
    const refDoc = await getDocument(refId as string);
    const editDoc = await getDocument(editId as string);
    if (!refDoc || !editDoc) throw new Error('documents not found');

    await addDocumentReference('c1', refDoc);
    const editAtt = await addDocumentReference('c1', editDoc);
    await updateAttachmentText(editAtt, 'my note'); // materialised

    await snapshotPendingDocumentReferences('c1');

    const rows = await listPendingAttachments('c1');
    const ref = rows.find((r) => r.kbRef?.documentId === refId);
    const edited = rows.find((r) => r.id === editAtt);
    expect(ref?.text).toBe('live body');
    expect(edited?.text).toBe('my note');
  });

  it('degrades a vanished document to empty content rather than throwing', async () => {
    const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
    const [docId] = await addDocuments(lib.id, [{ title: 'Gone', content: 'x' }]);
    const doc = await getDocument(docId as string);
    if (!doc) throw new Error('document not found');
    await addDocumentReference('c1', doc);
    await getClientDataDb().documents.delete(docId as string);

    await snapshotPendingDocumentReferences('c1');
    const [row] = await listPendingAttachments('c1');
    expect(row?.text).toBe('');
  });
});
