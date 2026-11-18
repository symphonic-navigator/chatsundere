// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { keyLockedSentence } from '../../src/data/send-errors.js';

describe('keyLockedSentence', () => {
  it('keeps the chat wording by default', () => {
    expect(keyLockedSentence('NanoGPT')).toBe(
      "Your saved key for NanoGPT can't be opened any more. Enter it again to keep chatting.",
    );
  });

  it('ends neutrally on the memory page', () => {
    expect(keyLockedSentence('NanoGPT', 'memory')).toBe(
      "Your saved key for NanoGPT can't be opened any more. Enter it again to carry on.",
    );
  });
});
