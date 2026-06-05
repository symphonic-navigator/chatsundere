// SPDX-License-Identifier: LGPL-3.0-only
import type Dexie from 'dexie';
import type { Table } from 'dexie';
import type { EmbeddingEngine } from '../engine/engine.js';
import { l2Norm } from '../lib/similarity.js';
import { encode } from './codec.js';
import { type Candidate, type VectorFilter, matchesFilter, scoreAndRank } from './retrieval.js';
import { type VectorInput, type VectorRow, rowBytes } from './schema.js';

/** Thrown when an upsert would exceed the configured storage budget and no eviction hook is set. */
export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export interface EvictionContext {
  table: Table<VectorRow, string>;
  usage: { count: number; bytes: number };
  incoming: { count: number; bytes: number };
}

export type EvictionHook = (ctx: EvictionContext) => Promise<void>;

export interface Budget {
  maxCount?: number;
  maxBytes?: number;
  onFull?: EvictionHook; // default: reject with BudgetExceededError
}

export interface VectorStoreConfig {
  db: Dexie;
  table: Table<VectorRow, string>;
  engine?: EmbeddingEngine;
  budget?: Budget;
}

export interface QueryRequest {
  collection: string;
  filter?: VectorFilter;
  text?: string;
  vector?: Float32Array;
  topK: number;
  candidateK?: number;
  minScore?: number;
  rerank?: (candidates: Candidate[]) => Candidate[];
}

export interface ScanRequest {
  collection: string;
  filter?: VectorFilter;
}

export interface UsageReport {
  count: number;
  bytes: number;
  perCollection: Record<string, { count: number; bytes: number }>;
}

export interface VectorStore {
  upsert(records: VectorInput[]): Promise<void>;
  update(
    id: string,
    patch: { numeric?: Record<string, number>; metadata?: unknown },
  ): Promise<void>;
  delete(ids: string[]): Promise<void>;
  deleteWhere(req: ScanRequest): Promise<number>;
  scan(req: ScanRequest): Promise<VectorRow[]>;
  query(req: QueryRequest): Promise<Candidate[]>;
  usage(): Promise<UsageReport>;
}

function toRow(input: VectorInput): VectorRow {
  const encoded = encode(input.vector);
  const tags = input.tags ?? {};
  const numeric = input.numeric ?? {};
  return {
    ...encoded,
    id: input.id,
    collection: input.collection,
    tags,
    numeric,
    metadata: input.metadata,
    updatedAt: input.updatedAt,
    bytes: rowBytes(tags, numeric, input.metadata),
  };
}

/** Narrow to a collection via the Dexie index, then apply tag/numeric predicates in memory. */
async function loadCandidates(
  table: Table<VectorRow, string>,
  collection: string,
  filter?: VectorFilter,
): Promise<VectorRow[]> {
  const rows = await table.where('collection').equals(collection).toArray();
  return filter ? rows.filter((r) => matchesFilter(r, filter)) : rows;
}

export function createVectorStore(config: VectorStoreConfig): VectorStore {
  const { db, table, engine, budget } = config;

  async function currentUsage(): Promise<{ count: number; bytes: number }> {
    let count = 0;
    let bytes = 0;
    await table.each((r) => {
      count++;
      bytes += r.bytes;
    });
    return { count, bytes };
  }

  async function enforceBudget(rows: VectorRow[]): Promise<void> {
    if (!budget) return;
    const usage = await currentUsage();
    // Upsert replaces rows sharing an id, so only genuinely-new ids add to the count,
    // and a replaced row contributes only its net byte delta.
    const existing = await table.bulkGet(rows.map((r) => r.id));
    const previousBytes = new Map<string, number>();
    for (const prev of existing) {
      if (prev) previousBytes.set(prev.id, prev.bytes);
    }
    let addedCount = 0;
    let addedBytes = 0;
    for (const r of rows) {
      const prevBytes = previousBytes.get(r.id);
      if (prevBytes === undefined) {
        addedCount += 1;
        addedBytes += r.bytes;
      } else {
        addedBytes += r.bytes - prevBytes;
      }
    }
    const overCount = budget.maxCount !== undefined && usage.count + addedCount > budget.maxCount;
    const overBytes = budget.maxBytes !== undefined && usage.bytes + addedBytes > budget.maxBytes;
    if (!overCount && !overBytes) return;
    if (budget.onFull) {
      await budget.onFull({ table, usage, incoming: { count: addedCount, bytes: addedBytes } });
      return;
    }
    throw new BudgetExceededError(
      `Storage budget exceeded (count ${usage.count}+${addedCount}/${budget.maxCount ?? '∞'}, bytes ${usage.bytes}+${addedBytes}/${budget.maxBytes ?? '∞'})`,
    );
  }

  return {
    async upsert(records) {
      const rows = records.map(toRow);
      await enforceBudget(rows);
      await db.transaction('rw', table, async () => {
        await table.bulkPut(rows);
      });
    },

    /** Mutate numeric/metadata without re-embedding. Recomputes the stored byte size; bypasses the storage budget. */
    async update(id, patch) {
      const existing = await table.get(id);
      if (!existing) return;
      const numeric = patch.numeric ?? existing.numeric;
      const metadata = patch.metadata !== undefined ? patch.metadata : existing.metadata;
      await table.update(id, {
        numeric,
        metadata,
        bytes: rowBytes(existing.tags, numeric, metadata),
      });
    },

    async delete(ids) {
      await table.bulkDelete(ids);
    },

    async deleteWhere(req) {
      const rows = await loadCandidates(table, req.collection, req.filter);
      const ids = rows.map((r) => r.id);
      await table.bulkDelete(ids);
      return ids.length;
    },

    async scan(req) {
      return loadCandidates(table, req.collection, req.filter);
    },

    async query(req) {
      if (req.vector && req.text !== undefined) {
        throw new Error('query requires exactly one of { text, vector } — both were provided.');
      }
      let queryVec: Float32Array;
      if (req.vector) {
        queryVec = req.vector;
      } else if (req.text !== undefined) {
        if (!engine) {
          throw new Error('Text queries require an Engine — construct the store with { engine }.');
        }
        const embedded = await engine.embed([req.text], { kind: 'query' });
        const first = embedded[0];
        if (!first) throw new Error('Engine returned no embedding for the query text.');
        queryVec = first;
      } else {
        throw new Error('query requires exactly one of { text, vector }.');
      }
      const rows = await loadCandidates(table, req.collection, req.filter);
      return scoreAndRank(queryVec, l2Norm(queryVec), rows, {
        topK: req.topK,
        candidateK: req.candidateK,
        minScore: req.minScore,
        rerank: req.rerank,
      });
    },

    async usage() {
      const perCollection: Record<string, { count: number; bytes: number }> = {};
      let count = 0;
      let bytes = 0;
      await table.each((r) => {
        count++;
        bytes += r.bytes;
        const c = perCollection[r.collection] ?? { count: 0, bytes: 0 };
        c.count++;
        c.bytes += r.bytes;
        perCollection[r.collection] = c;
      });
      return { count, bytes, perCollection };
    },
  };
}
