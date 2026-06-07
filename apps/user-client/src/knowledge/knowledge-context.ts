// SPDX-License-Identifier: AGPL-3.0-only
import type { ChatRow, LibraryRow, PersonaRow } from '../boot/client-data-db.js';
import { getClientDataDb } from '../boot/client-data-db.js';
import { getEmbeddingEngine, getKnowledgeVectorStore } from '../boot/knowledge-vectors-db.js';
import { computeEffectiveLibraries } from './effective-libraries.js';
import type { KnowledgeContext } from './query-tool.js';
import { type RetrievalDeps, retrieveFromLibraries } from './retrieval.js';

/** Retrieval tuning — device-tunable knobs (spec §4). */
export const KNOWLEDGE_RETRIEVAL_OPTS = { topK: 6, minScore: 0.35, candidateK: 24 };

/** Injectable I/O for the test; the default wires the live db + engine + store. */
export interface KnowledgeContextDeps {
  listLibraries: () => Promise<LibraryRow[]>;
  embed: RetrievalDeps['embed'];
  query: RetrievalDeps['query'];
  getDocumentTitle: (documentId: string) => Promise<string>;
}

function liveDeps(): KnowledgeContextDeps {
  const db = getClientDataDb();
  return {
    listLibraries: () => db.libraries.toArray(),
    embed: async (texts, opts) => (await getEmbeddingEngine()).embed(texts, opts),
    query: (req) => getKnowledgeVectorStore().query(req),
    getDocumentTitle: async (documentId) =>
      (await db.documents.get(documentId))?.title ?? 'Untitled',
  };
}

/**
 * Assemble the per-send knowledge context, or `null` when nothing is searchable.
 * NSFW gating uses the persona's `adultPersona` flag (mirrors IntegrationContext).
 */
export async function buildKnowledgeContext(
  persona: Pick<PersonaRow, 'adultPersona' | 'libraryIds'>,
  chat: Pick<ChatRow, 'libraryIds'>,
  deps: KnowledgeContextDeps = liveDeps(),
): Promise<KnowledgeContext | null> {
  const all = await deps.listLibraries();
  const effective = computeEffectiveLibraries(
    persona.libraryIds ?? [],
    chat.libraryIds ?? [],
    all,
    persona.adultPersona,
  );
  if (effective.length === 0) return null;

  const libraries = effective.map((l) => ({ id: l.id, name: l.name, description: l.description }));
  const retrievalDeps: RetrievalDeps = {
    embed: deps.embed,
    query: deps.query,
    getDocumentTitle: deps.getDocumentTitle,
  };
  return {
    libraries,
    retrieve: (query) =>
      retrieveFromLibraries(retrievalDeps, libraries, query, KNOWLEDGE_RETRIEVAL_OPTS),
  };
}
