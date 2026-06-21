// SPDX-License-Identifier: AGPL-3.0-only
import {
  PRECONDITION_MIN_MESSAGES,
  PRECONDITION_MIN_TOKENS,
  TOAST_FILL_THRESHOLD,
  VALVE_FILL_THRESHOLD,
} from './config.js';

/** A chat is worth compacting only past both the message-count and token floors. */
export function isCompactable(messageCount: number, usedTokens: number): boolean {
  return messageCount > PRECONDITION_MIN_MESSAGES && usedTokens > PRECONDITION_MIN_TOKENS;
}

/** Show the actionable "Compact?" toast once per chat at the warning fill. */
export function shouldShowToast(
  fillPct: number,
  alreadyShown: boolean,
  compactable: boolean,
): boolean {
  return compactable && !alreadyShown && fillPct >= TOAST_FILL_THRESHOLD;
}

/** Background safety valve: auto-compact after the send once fill is critical. */
export function shouldFireValve(fillPct: number): boolean {
  return fillPct >= VALVE_FILL_THRESHOLD;
}
