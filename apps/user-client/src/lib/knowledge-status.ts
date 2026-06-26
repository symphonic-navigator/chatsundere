// SPDX-License-Identifier: AGPL-3.0-only
import type { EmbeddingStatus } from '../boot/client-data-db.js';

/** Human-readable label for each embedding status value. */
export const STATUS_LABEL: Record<EmbeddingStatus, string> = {
  pending: 'Pending',
  embedding: 'Embedding…',
  ready: 'Ready',
  failed: 'Failed',
};

/** Badge tone for each embedding status value. */
export const STATUS_TONE: Record<EmbeddingStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  pending: 'neutral',
  embedding: 'warning',
  ready: 'success',
  failed: 'danger',
};
