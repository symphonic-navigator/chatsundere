// SPDX-License-Identifier: AGPL-3.0-only

/** Chat reading-text size steps (behaviour-axis, per-device — see sync/strip.ts).
 *  'standard' is today's baseline; the feature only adds headroom above it. */
export type ChatFontScale = 'standard' | 'large' | 'larger';

/** Multiplier applied to the chat reading text at each step. Starting points,
 *  tunable on-device; not a contract. */
export const CHAT_FONT_SCALE: Record<ChatFontScale, number> = {
  standard: 1,
  large: 1.15,
  larger: 1.3,
};

/** Resolve a stored (possibly absent) scale to its multiplier. Absent ⇒ 1. */
export function chatFontScaleValue(scale: ChatFontScale | undefined): number {
  return CHAT_FONT_SCALE[scale ?? 'standard'];
}
