// SPDX-License-Identifier: AGPL-3.0-only
import type { KnownModel, ReasoningIntent } from '@chatsundere/llm-unified';

/**
 * Cockpit-side reasoning state. Three arms cover the UI surfaces:
 *
 *   - `off` — user explicitly disabled reasoning (only on capability-optional
 *     models — the toggle is gated upstream).
 *   - `on` — reasoning is enabled; an optional `effort` hint may be supplied
 *     for providers that honour low/medium/high (nano-gpt-flag, Novita).
 *   - `bucket` — legacy nano-gpt-pair-style selection where the model exposes
 *     a discrete bucket list (e.g. `low`, `medium`, `high`). The resolver
 *     normalises this onto the same ReasoningIntent shape, treating
 *     `bucket` as `effort` for the three canonical labels.
 *
 * The dual shape is deliberate during the Phase-4 transition: the cockpit
 * still emits the bucket form for effort-list models, while newer surfaces
 * may emit the flat `{ mode: 'on', effort }` directly.
 */
export type ReasoningState =
  | { mode: 'off' }
  | { mode: 'on'; effort?: 'low' | 'medium' | 'high' }
  | { mode: 'bucket'; bucket: string };

/**
 * Map cockpit reasoning state + KnownModel capability onto a request-body
 * extras object the engine layer will shallow-merge.
 *
 *   - `optional` models receive `{ reasoning: ReasoningIntent }`; the
 *     per-provider translation (Novita flag, nano-gpt slug-swap, ollama
 *     `think`, …) happens later in `applyReasoningToBody`.
 *   - `no_reasoning` and `always_on` models receive an empty extras object;
 *     the capability-gated cockpit UI ensures no toggling can occur for
 *     those, so there is no intent to emit.
 */
export function resolveReasoningBodyExtras(
  model: KnownModel,
  state: ReasoningState,
): Record<string, unknown> {
  if (model.reasoning.kind !== 'optional') return {};
  const intent: ReasoningIntent = stateToIntent(state);
  return { reasoning: intent };
}

function stateToIntent(state: ReasoningState): ReasoningIntent {
  if (state.mode === 'off') return { enabled: false };
  if (state.mode === 'bucket') {
    // Bucket labels coming from the cockpit's effort-list rendering match
    // the canonical low/medium/high triplet for every model we ship.
    // Anything outside that is silently dropped to a bare enabled intent
    // rather than smuggled into the wire shape.
    const bucket = state.bucket;
    if (bucket === 'low' || bucket === 'medium' || bucket === 'high') {
      return { enabled: true, effort: bucket };
    }
    return { enabled: true };
  }
  return state.effort ? { enabled: true, effort: state.effort } : { enabled: true };
}

/** Derive the initial UI reasoning state from a model's capability declaration. */
export function initialReasoningState(model: KnownModel): ReasoningState {
  const cap = model.reasoning;
  if (cap.kind === 'no_reasoning') return { mode: 'off' };
  if (cap.effort)
    return cap.defaultOn ? { mode: 'bucket', bucket: cap.effort.defaultBucket } : { mode: 'off' };
  return cap.defaultOn ? { mode: 'on' } : { mode: 'off' };
}
