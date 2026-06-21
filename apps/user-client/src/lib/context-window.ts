// SPDX-License-Identifier: AGPL-3.0-only

import type { Offering, WireMessage } from '@chatsundere/llm-unified';
import type { PersonaRow } from '../boot/client-data-db.js';
import { estimateTokens } from './token-estimator.js';

/** Smallest selectable context window. Our system prompts are substantial and
 *  every integrated model ships a generous window, so 64k is a safe floor. */
export const CONTEXT_FLOOR = 65_536;
/** Slider granularity. */
export const CONTEXT_STEP = 4_096;

/** Effective floor for an offering — never above its own max. */
export function effectiveFloor(offering: Offering): number {
  return Math.min(CONTEXT_FLOOR, offering.context.max);
}

/** Whether the window is worth a slider (there is head-room above the floor). */
export function contextAdjustable(offering: Offering): boolean {
  return offering.context.max > effectiveFloor(offering);
}

/** Resolve the window a persona actually uses against an offering. */
export function resolveContextWindow(persona: PersonaRow, offering: Offering): number {
  const target = persona.contextWindow ?? offering.context.recommended;
  return Math.min(offering.context.max, Math.max(effectiveFloor(offering), target));
}

export function wireTokens(m: WireMessage): number {
  return estimateTokens(typeof m.content === 'string' ? m.content : '');
}

/**
 * Drop the oldest history messages until the estimated token total fits the
 * budget. The system prompt (first) and the current user turn (last) are never
 * dropped. `trimmed` counts the history messages actually removed.
 */
export function truncateToWindow(
  messages: WireMessage[],
  budget: number,
): { messages: WireMessage[]; trimmed: number } {
  if (messages.length <= 2) return { messages, trimmed: 0 };
  const system = messages[0];
  const current = messages[messages.length - 1];
  // Both are defined: we checked length > 2 above.
  if (system === undefined || current === undefined) return { messages, trimmed: 0 };
  const history = messages.slice(1, -1);
  let total =
    wireTokens(system) + wireTokens(current) + history.reduce((s, m) => s + wireTokens(m), 0);
  let start = 0;
  // Drop oldest history messages until the remaining set fits within the budget.
  while (total > budget && start < history.length) {
    const candidate = history[start];
    if (candidate === undefined) break;
    total -= wireTokens(candidate);
    start += 1;
  }
  return { messages: [system, ...history.slice(start), current], trimmed: start };
}

/**
 * Number of oldest messages outside the model's window, fitting messages
 * newest-first under (budget - systemTokens). At least the newest message is
 * always kept. Used to place the in-stream "out of memory" marker.
 */
export function outOfWindowCount(
  messageTokens: number[],
  systemTokens: number,
  budget: number,
): number {
  let remaining = budget - systemTokens;
  let kept = 0;
  for (let i = messageTokens.length - 1; i >= 0; i -= 1) {
    const t = messageTokens[i] ?? 0;
    if (kept > 0 && remaining - t < 0) break;
    remaining -= t;
    kept += 1;
  }
  return messageTokens.length - kept;
}
