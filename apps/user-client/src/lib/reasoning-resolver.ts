// SPDX-License-Identifier: AGPL-3.0-only
import type { ReasoningControl, ReasoningIntent } from '@chatsundere/llm-unified';

/**
 * Cockpit-side reasoning selection, mirroring the ReasoningControl modes:
 *   - `off`  — reasoning disabled (toggle-off or the steps `offStep`)
 *   - `on`   — reasoning enabled, no granular step (toggle / fixed-on)
 *   - `step` — a chosen effort step (steps mode)
 */
export type ReasoningState = { kind: 'off' } | { kind: 'on' } | { kind: 'step'; step: string };

/** Derive the initial UI reasoning state from the offering's control. */
export function initialReasoningState(control: ReasoningControl): ReasoningState {
  switch (control.mode) {
    case 'none':
      return { kind: 'off' };
    case 'fixed-on':
      return { kind: 'on' };
    case 'toggle':
      return control.defaultOn ? { kind: 'on' } : { kind: 'off' };
    case 'steps':
      return { kind: 'step', step: control.defaultStep };
  }
}

/**
 * Map control + state onto request-body extras the engine shallow-merges.
 * `none`/`fixed-on` are unsteerable → no intent emitted. Steps map the chosen
 * label onto the canonical low/medium/high effort; anything else falls back to
 * a bare enabled intent. The per-provider wire translation stays in
 * `applyReasoningToBody`.
 */
export function resolveReasoningBodyExtras(
  control: ReasoningControl,
  state: ReasoningState,
): Record<string, unknown> {
  if (control.mode === 'none' || control.mode === 'fixed-on') return {};
  if (control.mode === 'toggle') {
    const intent: ReasoningIntent = { enabled: state.kind !== 'off' };
    return { reasoning: intent };
  }
  // steps
  if (state.kind === 'off') {
    const intent: ReasoningIntent = { enabled: false };
    return { reasoning: intent };
  }
  const step = state.kind === 'step' ? state.step : control.defaultStep;
  const intent: ReasoningIntent =
    step === 'low' || step === 'medium' || step === 'high'
      ? { enabled: true, effort: step }
      : { enabled: true };
  return { reasoning: intent };
}
