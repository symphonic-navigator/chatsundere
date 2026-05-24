// SPDX-License-Identifier: AGPL-3.0-only
import type { KnownModel } from '@chatsundere/llm-unified';

export type ReasoningState = { mode: 'off' } | { mode: 'on' } | { mode: 'bucket'; bucket: string };

/**
 * Translate a (model, reasoning-state) pair into the body-extras the
 * wire-shape needs. The stream-completion layer further translates these
 * generic extras into provider-specific shapes (nano-gpt pair-map etc.).
 *
 *   - no_reasoning kind → empty (model has no controls).
 *   - kind with effort buckets → `reasoning_effort: <bucket>` when on/bucket,
 *     `thinking: false` when off (signals adapter to suppress thinking).
 *   - kind without effort → `thinking: true | false`.
 */
export function resolveReasoningBodyExtras(
  model: KnownModel,
  state: ReasoningState,
): Record<string, unknown> {
  const cap = model.reasoning;
  if (cap.kind === 'no_reasoning') return {};
  if (cap.effort) {
    if (state.mode === 'off') return { thinking: false };
    if (state.mode === 'bucket') return { reasoning_effort: state.bucket };
    return { reasoning_effort: cap.effort.defaultBucket };
  }
  if (state.mode === 'off') return { thinking: false };
  return { thinking: true };
}

/** Derive the initial UI reasoning state from a model's capability declaration. */
export function initialReasoningState(model: KnownModel): ReasoningState {
  const cap = model.reasoning;
  if (cap.kind === 'no_reasoning') return { mode: 'off' };
  if (cap.effort)
    return cap.defaultOn ? { mode: 'bucket', bucket: cap.effort.defaultBucket } : { mode: 'off' };
  return cap.defaultOn ? { mode: 'on' } : { mode: 'off' };
}
