// SPDX-License-Identifier: LGPL-3.0-only

export const MODEL_ID = 'Snowflake/snowflake-arctic-embed-m-v2.0';
export const EMBED_DIM = 768;

/**
 * arctic-embed v2.0 prepends a prompt to queries but not to documents.
 * NOTE: the exact prefix string is verified empirically against the model-card
 * reference scores (0.327 / 0.070) in the dev smoke page; adjust here if the
 * probe disagrees with this default.
 */
export const QUERY_PREFIX = 'query: ';
export const DOC_PREFIX = '';

export const POOLING = 'cls' as const;

export type EmbedKind = 'query' | 'document';

export function applyPrefix(text: string, kind: EmbedKind): string {
  return (kind === 'query' ? QUERY_PREFIX : DOC_PREFIX) + text;
}
