// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { ChatRow } from '../../src/boot/client-data-db';
import { displayTitle } from '../../src/lib/chat-title';

function row(over: Partial<ChatRow> = {}): ChatRow {
  return {
    id: 'c1',
    personaId: 'p1',
    title: null,
    resolvedMindspaceId: 'm1',
    createdAt: new Date('2026-05-24T18:06:00').getTime(),
    updatedAt: new Date('2026-05-24T18:06:00').getTime(),
    lastMessageAt: 0,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: [],
    ...over,
  };
}

describe('displayTitle', () => {
  it('returns the real title when set', () => {
    expect(displayTitle(row({ title: 'Foo' }))).toBe('Foo');
  });
  it('returns the British-convention fallback when title is null', () => {
    expect(displayTitle(row({ title: null }))).toBe('New chat — 24 May, 18:06');
  });
  it('preserves the empty-string case as fallback', () => {
    expect(displayTitle(row({ title: '' }))).toBe('');
  });
});
