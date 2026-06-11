// SPDX-License-Identifier: AGPL-3.0-only
import { preprocessTeal } from '../teal/preprocess-teal.js';
import { preprocessMath } from './preprocess-math.js';

/**
 * The single display-preprocessing chain applied to raw block text before it
 * reaches ReactMarkdown: TEAL tags first (so `[laugh]` → emoji and wrapping
 * tags become PUA sentinels), then math-delimiter normalisation.
 *
 * It lives in one place so the renderer ({@link MarkdownContent}) and the
 * voice-glow plugin ({@link rehypeVoiceAnchor}) can never drift on the exact
 * transformation — the plugin must reproduce the same processed-paragraph
 * structure the renderer produced to pair glow anchors correctly (spec I1).
 *
 * Pure: no I/O, no DOM, no React.
 */
export function preprocessForDisplay(text: string): string {
  return preprocessMath(preprocessTeal(text));
}
