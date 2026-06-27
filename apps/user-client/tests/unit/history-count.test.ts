// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { historyCountLabel } from '../../src/lib/history-count';

describe('historyCountLabel', () => {
  it('reads "empty" when there are no chats at all', () => {
    expect(historyCountLabel(0, 0)).toBe('empty');
  });

  it('reads "N chats" when nothing is filtered out', () => {
    expect(historyCountLabel(5, 5)).toBe('5 chats');
  });

  it('uses the singular for one chat', () => {
    expect(historyCountLabel(1, 1)).toBe('1 chat');
  });

  it('reads "N of M" when a filter narrows the set', () => {
    expect(historyCountLabel(8, 3)).toBe('3 of 8');
  });
});
