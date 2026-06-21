// SPDX-License-Identifier: AGPL-3.0-only

/** Volume thresholds for the memory pipeline. Tunable after device testing. */
export const EXTRACTION_MIN_NEW_MESSAGES = 6;
export const EXTRACTION_WINDOW_CAP = 20;
export const UNCOMMITTED_CAP = 50;
export const AUTO_COMMIT_THRESHOLD = 15;
export const AUTO_COMMIT_KEEP_RECENT = 5;
export const DREAM_THRESHOLD = 20;
export const MEMORY_BODY_MAX_TOKENS = 3000;
export const MEMORY_INJECTION_MAX_TOKENS = 6000;
export const MAX_BODY_VERSIONS = 5;
