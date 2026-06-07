import { describe, expect, it, vi } from 'vitest';
import { type IngestionDeps, createIngestionQueue } from '../../src/knowledge/ingestion-queue.js';

function makeDoc(id: string, content = 'hello world') {
  return {
    id,
    libraryId: 'lib1',
    title: 't',
    content,
    embeddingStatus: 'pending' as const,
    embeddingError: null,
    chunkCount: 0,
    triggerPhrases: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeDeps(overrides: Partial<IngestionDeps> = {}): IngestionDeps {
  return {
    getDocument: vi.fn(async (id: string) => makeDoc(id)),
    setStatus: vi.fn(async () => {}),
    setReady: vi.fn(async () => {}),
    embed: vi.fn(async (texts: string[]) => texts.map(() => new Float32Array(768).fill(0.1))),
    writeChunks: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('ingestion queue', () => {
  it('drives a document pending → embedding → ready', async () => {
    const deps = makeDeps();
    const q = createIngestionQueue(deps);
    await q.process('d1');
    expect(deps.setStatus).toHaveBeenCalledWith('d1', 'embedding');
    expect(deps.writeChunks).toHaveBeenCalledTimes(1);
    expect(deps.setReady).toHaveBeenCalledWith('d1', expect.any(Number));
  });

  it('marks a document failed when embedding throws', async () => {
    const deps = makeDeps({
      embed: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const q = createIngestionQueue(deps);
    await q.process('d1');
    expect(deps.setStatus).toHaveBeenCalledWith('d1', 'failed', 'boom');
    expect(deps.writeChunks).not.toHaveBeenCalled();
  });

  it('discards results when the document was deleted mid-flight', async () => {
    const getDocument = vi
      .fn()
      .mockResolvedValueOnce(makeDoc('d1'))
      .mockResolvedValueOnce(undefined);
    const deps = makeDeps({ getDocument });
    const q = createIngestionQueue(deps);
    await q.process('d1');
    expect(deps.writeChunks).not.toHaveBeenCalled();
    expect(deps.setReady).not.toHaveBeenCalled();
  });

  it('serialises concurrent enqueues (one in flight at a time)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const deps = makeDeps({
      embed: vi.fn(async (texts: string[]) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return texts.map(() => new Float32Array(768).fill(0.1));
      }),
    });
    const q = createIngestionQueue(deps);
    q.enqueue('d1');
    q.enqueue('d2');
    await q.idle();
    expect(maxInFlight).toBe(1);
  });

  it('skips embedding for a document with no chunkable content', async () => {
    const deps = makeDeps({ getDocument: vi.fn(async (id: string) => makeDoc(id, '   ')) });
    const q = createIngestionQueue(deps);
    await q.process('d1');
    expect(deps.embed).not.toHaveBeenCalled();
    expect(deps.setReady).toHaveBeenCalledWith('d1', 0);
  });
});
