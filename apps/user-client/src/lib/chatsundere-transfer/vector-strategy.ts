// SPDX-License-Identifier: AGPL-3.0-only

export interface EmbedFingerprint {
  modelId: string;
  dim: number;
  codecVersion: number;
}

/**
 * Decide whether imported vectors can be adopted as-is or must be re-embedded.
 * Pure: the only side effect (re-embedding) lives at the call site, in the
 * existing device-tested ingestion path.
 */
export function resolveVectorStrategy(
  manifest: EmbedFingerprint,
  engine: EmbedFingerprint,
): 'adopt' | 'reembed' {
  const compatible =
    manifest.modelId === engine.modelId &&
    manifest.dim === engine.dim &&
    manifest.codecVersion === engine.codecVersion;
  return compatible ? 'adopt' : 'reembed';
}
