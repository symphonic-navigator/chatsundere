import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  addDocuments,
  createLibrary,
  documentCounts,
  listDocuments,
  updateDocument,
} from '../../src/data/knowledge.js';

const enqueue = vi.fn();
vi.mock('../../src/knowledge/start-ingestion.js', () => ({
  enqueueDocument: (id: string) => enqueue(id),
}));

beforeEach(async () => {
  await openClientDataDb();
  enqueue.mockClear();
});
afterEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
});

describe('document data layer', () => {
  it('adds documents as pending and enqueues each', async () => {
    const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
    const ids = await addDocuments(lib.id, [
      { title: 'A', content: 'alpha' },
      { title: 'B', content: 'beta' },
    ]);
    expect(ids).toHaveLength(2);
    const docs = await listDocuments(lib.id);
    expect(docs.every((d) => d.embeddingStatus === 'pending')).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it('rejects empty/whitespace documents', async () => {
    const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
    const ids = await addDocuments(lib.id, [{ title: 'Empty', content: '   ' }]);
    expect(ids).toHaveLength(0);
    expect(await listDocuments(lib.id)).toHaveLength(0);
  });

  it('content edit re-queues embedding; title-only edit does not', async () => {
    const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
    const [id] = await addDocuments(lib.id, [{ title: 'A', content: 'alpha' }]);
    await getClientDataDb().documents.update(id as string, { embeddingStatus: 'ready' });
    enqueue.mockClear();

    await updateDocument(id as string, { title: 'A2' });
    expect(enqueue).not.toHaveBeenCalled();
    expect((await getClientDataDb().documents.get(id as string))?.embeddingStatus).toBe('ready');

    await updateDocument(id as string, { content: 'changed' });
    expect(enqueue).toHaveBeenCalledWith(id);
    expect((await getClientDataDb().documents.get(id as string))?.embeddingStatus).toBe('pending');
  });

  it('documentCounts groups by libraryId', async () => {
    const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
    await addDocuments(lib.id, [
      { title: 'A', content: 'a' },
      { title: 'B', content: 'b' },
    ]);
    const counts = await documentCounts();
    expect(counts[lib.id]).toBe(2);
  });
});
