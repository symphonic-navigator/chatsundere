// SPDX-License-Identifier: AGPL-3.0-only

/** Concatenate VAD PCM chunks (16 kHz mono Float32) into one buffer, in order. */
export function mergePcm(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
