// SPDX-License-Identifier: LGPL-3.0-only
import Dexie, { type Table } from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VECTORS_STORE_SCHEMA, type VectorRow } from './schema.js';
import { BudgetExceededError, createVectorStore } from './vector-store.js';

class TestDb extends Dexie {
  vectors!: Table<VectorRow, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ vectors: VECTORS_STORE_SCHEMA });
  }
}

let db: TestDb;
let counter = 0;

function input(
  id: string,
  vec: number[],
  tags: Record<string, string> = {},
  numeric: Record<string, number> = {},
  metadata?: unknown,
) {
  return {
    id,
    collection: 'memory',
    vector: new Float32Array(vec),
    tags,
    numeric,
    metadata,
    updatedAt: 1,
  };
}

beforeEach(async () => {
  db = new TestDb(`test-${counter++}`);
  await db.open();
});
afterEach(async () => {
  db.close();
  await Dexie.delete(db.name);
});

describe('vector store CRUD', () => {
  it('upserts and queries by vector, ranking by cosine', async () => {
    const store = createVectorStore({ db, table: db.vectors });
    await store.upsert([input('a', [1, 0]), input('b', [0, 1])]);
    const hits = await store.query({
      collection: 'memory',
      vector: new Float32Array([0.9, 0.1]),
      topK: 1,
    });
    expect(hits[0]?.id).toBe('a');
  });

  it('upsert replaces an existing id', async () => {
    const store = createVectorStore({ db, table: db.vectors });
    await store.upsert([input('a', [1, 0], { v: '1' })]);
    await store.upsert([input('a', [1, 0], { v: '2' })]);
    const rows = await store.scan({ collection: 'memory' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tags.v).toBe('2');
  });

  it('filters by tags and numeric range before ranking', async () => {
    const store = createVectorStore({ db, table: db.vectors });
    await store.upsert([
      input('old', [1, 0], { persona: 'p1' }, { createdAt: 10 }),
      input('new', [1, 0], { persona: 'p1' }, { createdAt: 100 }),
      input('other', [1, 0], { persona: 'p2' }, { createdAt: 100 }),
    ]);
    const hits = await store.query({
      collection: 'memory',
      vector: new Float32Array([1, 0]),
      filter: { tags: { persona: 'p1' }, numeric: { createdAt: { gte: 50 } } },
      topK: 10,
    });
    expect(hits.map((h) => h.id)).toEqual(['new']);
  });

  it('update mutates numeric/metadata without re-embedding', async () => {
    const store = createVectorStore({ db, table: db.vectors });
    await store.upsert([input('a', [1, 0], {}, { salience: 1 })]);
    const before = (await store.scan({ collection: 'memory' }))[0];
    await store.update('a', { numeric: { salience: 9 } });
    const after = (await store.scan({ collection: 'memory' }))[0];
    expect(after?.numeric.salience).toBe(9);
    expect(Array.from(after?.codes ?? [])).toEqual(Array.from(before?.codes ?? [])); // vector untouched
  });

  it('delete and deleteWhere remove rows', async () => {
    const store = createVectorStore({ db, table: db.vectors });
    await store.upsert([input('a', [1, 0], { k: 'x' }), input('b', [0, 1], { k: 'y' })]);
    await store.delete(['a']);
    expect(await store.scan({ collection: 'memory' })).toHaveLength(1);
    const removed = await store.deleteWhere({ collection: 'memory', filter: { tags: { k: 'y' } } });
    expect(removed).toBe(1);
    expect(await store.scan({ collection: 'memory' })).toHaveLength(0);
  });

  it('query rejects when both text and vector are provided', async () => {
    const store = createVectorStore({ db, table: db.vectors });
    await expect(
      store.query({ collection: 'memory', text: 'x', vector: new Float32Array([1, 0]), topK: 1 }),
    ).rejects.toThrow('exactly one');
  });

  it('usage reports count and bytes', async () => {
    const store = createVectorStore({ db, table: db.vectors });
    await store.upsert([input('a', [1, 0]), input('b', [0, 1])]);
    const u = await store.usage();
    expect(u.count).toBe(2);
    expect(u.bytes).toBeGreaterThan(0);
  });
});

describe('storage budget', () => {
  it('rejects on full by default with a typed error', async () => {
    const store = createVectorStore({ db, table: db.vectors, budget: { maxCount: 1 } });
    await store.upsert([input('a', [1, 0])]);
    await expect(store.upsert([input('b', [0, 1])])).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('upsert-replace at the count limit does not falsely exceed the budget', async () => {
    const store = createVectorStore({ db, table: db.vectors, budget: { maxCount: 2 } });
    await store.upsert([input('a', [1, 0]), input('b', [0, 1])]);
    await expect(store.upsert([input('a', [1, 0], { v: '2' })])).resolves.toBeUndefined();
    expect(await store.scan({ collection: 'memory' })).toHaveLength(2);
  });

  it('invokes the eviction hook instead of rejecting when provided', async () => {
    const evicted: string[] = [];
    const store = createVectorStore({
      db,
      table: db.vectors,
      budget: {
        maxCount: 1,
        onFull: async ({ table }) => {
          const all = await table.toArray();
          const victim = all[0];
          if (victim) {
            await table.delete(victim.id);
            evicted.push(victim.id);
          }
        },
      },
    });
    await store.upsert([input('a', [1, 0])]);
    await store.upsert([input('b', [0, 1])]);
    expect(evicted).toEqual(['a']);
    expect(await store.scan({ collection: 'memory' })).toHaveLength(1);
  });
});
