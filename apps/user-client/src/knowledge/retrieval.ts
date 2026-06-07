// SPDX-License-Identifier: AGPL-3.0-only
import type { Candidate } from '@chatsundere/embeddings';
import { KNOWLEDGE_COLLECTION } from '../boot/knowledge-vectors-db.js';

/** A passage returned to the model, with its provenance. */
export interface RetrievedChunk {
  libraryName: string;
  documentTitle: string;
  headingPath: string[];
  text: string;
  score: number;
}

/** A library reference carrying just what retrieval and awareness need. */
export interface LibraryMeta {
  id: string;
  name: string;
  description: string;
}

export interface RetrievalOptions {
  topK: number;
  minScore: number;
  candidateK: number;
}

/** Injected I/O so the merge logic is unit-testable without engine/store/db. */
export interface RetrievalDeps {
  embed: (texts: string[], opts: { kind: 'query' }) => Promise<Float32Array[]>;
  query: (req: {
    collection: string;
    filter: { tags: { libraryId: string } };
    vector: Float32Array;
    topK: number;
    candidateK: number;
    minScore: number;
  }) => Promise<Candidate[]>;
  getDocumentTitle: (documentId: string) => Promise<string>;
}

function documentIdOf(chunkId: string): string {
  const hash = chunkId.lastIndexOf('#');
  return hash >= 0 ? chunkId.slice(0, hash) : chunkId;
}

/**
 * Embed the query once, run one filtered query per library, merge, sort by score
 * descending, slice to the global topK, and resolve provenance. Returns `[]`
 * (without embedding) when no libraries are given.
 */
export async function retrieveFromLibraries(
  deps: RetrievalDeps,
  libraries: readonly LibraryMeta[],
  query: string,
  opts: RetrievalOptions,
): Promise<RetrievedChunk[]> {
  if (libraries.length === 0) return [];
  const [vector] = await deps.embed([query], { kind: 'query' });
  if (!vector) return [];

  const perLibrary = await Promise.all(
    libraries.map(async (lib) => {
      const candidates = await deps.query({
        collection: KNOWLEDGE_COLLECTION,
        filter: { tags: { libraryId: lib.id } },
        vector,
        topK: opts.topK,
        candidateK: opts.candidateK,
        minScore: opts.minScore,
      });
      return candidates.map((c) => ({ c, libraryName: lib.name }));
    }),
  );

  const merged = perLibrary
    .flat()
    .sort((a, b) => b.c.score - a.c.score)
    .slice(0, opts.topK);

  return Promise.all(
    merged.map(async ({ c, libraryName }) => {
      const meta = (c.metadata ?? {}) as { text?: string; headingPath?: string[] };
      return {
        libraryName,
        documentTitle: await deps.getDocumentTitle(documentIdOf(c.id)),
        headingPath: meta.headingPath ?? [],
        text: meta.text ?? '',
        score: c.score,
      };
    }),
  );
}
