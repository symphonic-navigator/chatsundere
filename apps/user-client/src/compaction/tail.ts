// SPDX-License-Identifier: AGPL-3.0-only
import { TAIL_MAX_MESSAGES, TAIL_MIN_MESSAGES, TAIL_TOKEN_FRACTION } from './config.js';

/**
 * Choose the verbatim-tail boundary (chatsune's rule, spec §4.1). Walking
 * newest → oldest, accumulate tokens and count; stop at the FIRST of:
 *   (count ≥ TAIL_MIN_MESSAGES AND tokens ≥ TAIL_TOKEN_FRACTION of the window)
 *   OR (count ≥ TAIL_MAX_MESSAGES).
 * Returns the index of the first tail message; messages before it are the
 * compaction source. Consequences: with large messages the token fraction is
 * met early, so the tail stops at the 12-message floor; with small messages the
 * fraction is never met within the cap, so the tail stops at the 36 cap.
 */
export function selectTailStartIndex(messageTokens: number[], contextWindow: number): number {
  const n = messageTokens.length;
  if (n <= TAIL_MIN_MESSAGES) return 0;
  const tokenTarget = contextWindow * TAIL_TOKEN_FRACTION;
  let kept = 0;
  let tokens = 0;
  for (let i = n - 1; i >= 0; i -= 1) {
    kept += 1;
    tokens += messageTokens[i] ?? 0;
    if (kept >= TAIL_MAX_MESSAGES) break;
    if (kept >= TAIL_MIN_MESSAGES && tokens >= tokenTarget) break;
  }
  return n - kept;
}
