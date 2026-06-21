// SPDX-License-Identifier: AGPL-3.0-only

/** Compaction thresholds. All tunable after device testing (see spec §3, §4.1). */

/** Tail (kept verbatim): coherence floor / hard cap / fraction of the context window. */
export const TAIL_MIN_MESSAGES = 12;
export const TAIL_MAX_MESSAGES = 36;
export const TAIL_TOKEN_FRACTION = 0.2;

/** Manual precondition — below this a chat cannot usefully be compacted. */
export const PRECONDITION_MIN_MESSAGES = 12;
export const PRECONDITION_MIN_TOKENS = 4000;

/** Trigger fill ratios (per cent). 80 → actionable toast; 90 → background valve. */
export const TOAST_FILL_THRESHOLD = 80;
export const VALVE_FILL_THRESHOLD = 90;

/** Summariser call budgets. */
export const COMPACTION_MAX_OUTPUT_TOKENS = 2000;
export const COMPACTION_SAFETY_MARGIN = 1000;
/** If the source itself exceeds this fraction of the window, drop oldest source first (spec §4.5). */
export const COMPACTION_SOURCE_FRACTION = 0.7;
