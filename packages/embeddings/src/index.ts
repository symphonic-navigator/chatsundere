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

// Quant + similarity helpers (for "dreaming"/dedup consumers)
export { cosineFromQuant, dequantise, type QuantVector, quantiseMaxAbs } from './store/quantise.js';
export { cosineSimilarity, dot, l2Norm } from './lib/similarity.js';
