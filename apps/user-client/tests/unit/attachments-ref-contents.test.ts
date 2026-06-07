// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import {
  addDocumentReference,
  listPendingAttachments,
  loadPendingDocumentContents,
} from '../../src/data/attachments.js';
import { addDocuments, createLibrary, getDocument } from '../../src/data/knowledge.js';

vi.mock('../../src/knowledge/start-ingestion.js', () => ({ enqueueDocument: () => {} }));

beforeEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  await openClientDataDb();
});

describe('loadPendingDocumentContents', () => {
  it('maps attachment id → live content for unmaterialised references only', async () => {
    const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
    const [docId] = await addDocuments(lib.id, [{ title: 'Doc', content: 'live body' }]);
    const doc = await getDocument(docId as string);
    if (!doc) throw new Error('doc missing');
    const refAtt = await addDocumentReference('c1', doc);

    const rows = await listPendingAttachments('c1');
    const map = await loadPendingDocumentContents(rows);
    expect(map.get(refAtt)).toBe('live body');
  });

  it('omits materialised references (text already set)', async () => {
    const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
    const [docId] = await addDocuments(lib.id, [{ title: 'Doc', content: 'live body' }]);
    const doc = await getDocument(docId as string);
    if (!doc) throw new Error('doc missing');
    const refAtt = await addDocumentReference('c1', doc);
    const { updateAttachmentText } = await import('../../src/data/attachments.js');
    await updateAttachmentText(refAtt, 'edited');

    const rows = await listPendingAttachments('c1');
    const map = await loadPendingDocumentContents(rows);
    expect(map.has(refAtt)).toBe(false);
  });
});
