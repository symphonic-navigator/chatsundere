// SPDX-License-Identifier: LGPL-3.0-only

import { NANO_GPT_PAIRS } from './providers/_nano-gpt-pairs.js';
import type { ReasoningIntent } from './types.js';

export type ProviderId = 'nano-gpt' | 'novita' | 'ollama-cloud';

export interface ApplyResult {
  modelId: string;
  body: Record<string, unknown>;
}

/**
 * Translate a `ReasoningIntent` into the per-provider request shape.
 * Three quirks encapsulated:
 *  - nano-gpt with switchingMode 'slug' swaps the model id and keeps the
 *    body clean. 'flag' writes a unified `{reasoning:{enabled,effort?}}`
 *    object; 'none' (or an unmapped id) is a capability-gated no-op.
 *  - novita uses the same unified reasoning object on every kind 'optional'
 *    model. Engine-side `composeReasoningExtras` is responsible for
 *    skipping non-optional models — this function unconditionally writes
 *    the field for the novita provider.
 *  - ollama-cloud uses `{ think: bool }`. Effort is silently dropped.
 */
export function applyReasoningToBody(
  providerId: ProviderId,
  modelId: string,
  intent: ReasoningIntent,
  body: Record<string, unknown>,
): ApplyResult {
  const out: Record<string, unknown> = { ...body };

  if (providerId === 'nano-gpt') {
    const pair = NANO_GPT_PAIRS[modelId];
    if (!pair) return { modelId, body: out };
    if (pair.switchingMode === 'slug') {
      const swapped = intent.enabled
        ? (pair.thinkingSlug ?? pair.nonThinkingSlug)
        : pair.nonThinkingSlug;
      return { modelId: swapped, body: out };
    }
    if (pair.switchingMode === 'flag') {
      out.reasoning = intent.enabled
        ? { enabled: true, ...(intent.effort ? { effort: intent.effort } : {}) }
        : { enabled: false };
      return { modelId, body: out };
    }
    // switchingMode === 'none'
    return { modelId, body: out };
  }

  if (providerId === 'novita') {
    out.reasoning = intent.enabled
      ? { enabled: true, ...(intent.effort ? { effort: intent.effort } : {}) }
      : { enabled: false };
    return { modelId, body: out };
  }

  if (providerId === 'ollama-cloud') {
    out.think = intent.enabled;
    return { modelId, body: out };
  }

  return { modelId, body: out };
}
