// SPDX-License-Identifier: AGPL-3.0-only
import type { Dictation } from '../../src/lib/voice/dictation/use-dictation.js';

/** Inert dictation surface for component tests that do not exercise the mic. */
export const idleDictationStub: Dictation = {
  uiState: 'idle',
  level: 0,
  available: false,
  failed: false,
  failedKind: null,
  captureError: null,
  pressStart: () => {},
  pressEnd: () => {},
  pressCancel: () => {},
  tap: () => {},
  cancel: () => {},
  retry: () => {},
  discard: () => {},
};
