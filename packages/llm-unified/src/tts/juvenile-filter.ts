// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Words that mark a voice as juvenile. Deliberately narrow and openly
 * documented (ADR 0040): `girl`, `young` and German `kind` are absent on purpose.
 */
export const JUVENILE_VOICE_TERMS: readonly string[] = [
  'kid',
  'kids',
  'kiddo',
  'child',
  'children',
  'childlike',
  'childish',
  'teen',
  'teens',
  'teenage',
  'teenager',
  'boy',
  'schoolboy',
  'schoolgirl',
  'little girl',
  'young girl',
  'toddler',
  'baby',
  'minor',
  'kinderstimme',
  'kindlich',
  'jugendlich',
  'teenie',
  'schüler',
  'schülerin',
  'schulmädchen',
  'mädchenstimme',
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const JUVENILE_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${JUVENILE_VOICE_TERMS.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}])`,
  'iu',
);

/** True when the voice's name or description contains a whole-word juvenile term. */
export function isJuvenileVoice(v: { name: string; description?: string }): boolean {
  return (
    JUVENILE_PATTERN.test(v.name) ||
    (v.description !== undefined && JUVENILE_PATTERN.test(v.description))
  );
}
