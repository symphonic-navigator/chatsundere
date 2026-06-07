// SPDX-License-Identifier: LGPL-3.0-only

// Engine — goal (a): text → vector
export {
  type CreateEngineOptions,
  createEmbeddingEngine,
  type EmbeddingEngine,
} from './engine/engine.js';
export { type EmbedKind, EMBED_DIM, MODEL_ID } from './engine/model-config.js';
export {
  EXECUTION_MODE_LABELS,
  type ExecutionMode,
  formatBackendLabel,
  type ResolvedBackend,
} from './engine/execution-modes.js';

// Store — goal (b): vector → filtered ranked hits
export {
  type Budget,
  BudgetExceededError,
  createVectorStore,
  type EvictionContext,
  type EvictionHook,
  type QueryRequest,
  type ScanRequest,
  type UsageReport,
  type VectorStore,
  type VectorStoreConfig,
} from './store/vector-store.js';
export { type VectorInput, type VectorRow, VECTORS_STORE_SCHEMA } from './store/schema.js';
export type { Candidate, NumericPredicate, VectorFilter } from './store/retrieval.js';

// Codec + similarity helpers (for "dreaming"/dedup consumers)
export {
  BLOCK_SIZE,
  CODEC_VERSION,
  cosineQuery,
  decode,
  deserialise,
  encode,
  type EncodedVector,
  I4L_VECTOR_BYTES,
  serialise,
} from './store/codec.js';
export { cosineSimilarity, dot, l2Norm } from './lib/similarity.js';

// Chunking — document text → embeddable chunks
export { type Chunk, type ChunkOptions, chunkMarkdown, estimateTokens } from './chunk/chunker.js';
