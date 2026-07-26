// SPDX-License-Identifier: AGPL-3.0-only
import type { ReasoningControl, ReasoningIntent } from '@chatsundere/llm-unified';

/**
 * Cockpit-side reasoning selection, mirroring the ReasoningControl modes:
 *   - `off`  — reasoning disabled (toggle-off or the steps `offStep`)
 *   - `on`   — reasoning enabled, no granular step (toggle / fixed-on)
 *   - `step` — a chosen effort step (steps mode)
 */
export type ReasoningState = { kind: 'off' } | { kind: 'on' } | { kind: 'step'; step: string };

type Effort = NonNullable<Extract<ReasoningIntent, { enabled: true }>['effort']>;

/**
 * Step labels that carry a canonical effort. `max` is ollama's level above
 * `high`; every other step label falls back to a bare enabled intent.
 */
function isEffort(step: string): step is Effort {
  return step === 'low' || step === 'medium' || step === 'high' || step === 'max';
}

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
  const intent: ReasoningIntent = isEffort(step)
    ? { enabled: true, effort: step }
    : { enabled: true };
  return { reasoning: intent };
}

/**
 * Flatten a reasoning state into the single string persisted on `ChatRow`:
 * the step label for a step, otherwise `'off'` / `'on'`.
 */
export function reasoningChoiceOf(state: ReasoningState): string {
  return state.kind === 'step' ? state.step : state.kind;
}

/**
 * Restore a persisted choice against the offering's CURRENT control, falling
 * back to the control's default whenever the stored value no longer fits.
 *
 * The fallback is the point, not an edge case: a chat keeps its choice while its
 * model changes underneath it, so a step may vanish (`max` exists on GLM 5.2 and
 * nowhere else) or an off may become unavailable. Restoring a stored `off` onto
 * a model that cannot be silenced would put an off on the wire that the adapter
 * has to refuse anyway — the Grok-4.5 guard, one layer earlier.
 */
export function reasoningStateFromChoice(
  choice: string | null | undefined,
  control: ReasoningControl,
): ReasoningState {
  const fallback = initialReasoningState(control);
  if (!choice) return fallback;

  switch (control.mode) {
    case 'none':
    case 'fixed-on':
      // Unsteerable: the control alone decides, a stored choice cannot override.
      return fallback;
    case 'toggle':
      return choice === 'on' || choice === 'off' ? { kind: choice } : fallback;
    case 'steps': {
      if (choice === control.offStep) return { kind: 'off' };
      return control.steps.includes(choice) ? { kind: 'step', step: choice } : fallback;
    }
  }
}

/**
 * The strongest reasoning intent a control allows — used by the ask_expert tool
 * to run the expert at full effort regardless of any UI step. `none` stays off;
 * `steps` picks the last non-`offStep` step and maps standard labels onto effort.
 */
export function maxReasoningIntent(control: ReasoningControl): ReasoningIntent {
  switch (control.mode) {
    case 'none':
      return { enabled: false };
    case 'fixed-on':
    case 'toggle':
      return { enabled: true };
    case 'steps': {
      const max = control.steps.filter((s) => s !== control.offStep).at(-1);
      return max !== undefined && isEffort(max)
        ? { enabled: true, effort: max }
        : { enabled: true };
    }
  }
}
