// SPDX-License-Identifier: AGPL-3.0-only

export const TRANSFER_VERSION = 1;

export type TransferFormat = 'chatsundere/persona' | 'chatsundere/knowledge';

export interface PersonaManifest {
  format: 'chatsundere/persona';
  version: number;
  exportedAt: string;
  appVersion: string;
  included: { memory: boolean; artefacts: boolean; images: boolean };
  source: { personaName: string };
}

export interface KnowledgeManifest {
  format: 'chatsundere/knowledge';
  version: number;
  exportedAt: string;
  appVersion: string;
  embed: { modelId: string; dim: number; codecVersion: number };
  source: { libraryName: string };
}

export type DetectedFormat =
  | 'chatsune/persona'
  | 'chatsune/knowledge'
  | 'chatsundere/persona'
  | 'chatsundere/knowledge'
  | 'unknown';

const KNOWN: ReadonlySet<string> = new Set([
  'chatsune/persona',
  'chatsune/knowledge',
  'chatsundere/persona',
  'chatsundere/knowledge',
]);

/** Branch import on a parsed manifest's `format` field. */
export function detectArchiveFormat(manifestJson: unknown): DetectedFormat {
  const format =
    typeof manifestJson === 'object' && manifestJson !== null
      ? (manifestJson as { format?: unknown }).format
      : undefined;
  return typeof format === 'string' && KNOWN.has(format) ? (format as DetectedFormat) : 'unknown';
}
