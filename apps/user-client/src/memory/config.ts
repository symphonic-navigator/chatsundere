// SPDX-License-Identifier: AGPL-3.0-only

/** Volume thresholds for the memory pipeline. Tunable after device testing. */
export const EXTRACTION_MIN_NEW_MESSAGES = 6;
export const EXTRACTION_WINDOW_CAP = 20;
export const UNCOMMITTED_CAP = 50;
export const AUTO_COMMIT_THRESHOLD = 10;
export const AUTO_COMMIT_KEEP_RECENT = 5;
export const DREAM_THRESHOLD = 12;
export const MEMORY_BODY_MAX_TOKENS = 3000;
export const MEMORY_INJECTION_MAX_TOKENS = 6000;
export const MAX_BODY_VERSIONS = 5;

/** One-shot call budgets. Dreaming regenerates a whole body (≤3000 tokens) —
 *  the library's 30 s default is structurally too short for that output size. */
export const EXTRACTION_TIMEOUT_MS = 60_000;
export const DREAM_TIMEOUT_MS = 180_000;
/** Committed entries consolidated per dreaming slice (bounds prompt and drain step). */
export const DREAM_BATCH_SIZE = 40;
