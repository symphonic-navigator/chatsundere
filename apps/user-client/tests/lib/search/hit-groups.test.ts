// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { ChatRow } from '../../../src/boot/client-data-db.js';
import { hitDateLabel, toHitGroups } from '../../../src/lib/search/hit-groups.js';
import type { MessageHit } from '../../../src/lib/search/scan-messages.js';

function chatRow(id: string, personaId: string, title: string | null): ChatRow {
  return {
    id,
    personaId,
    title,
    resolvedMindspaceId: 'ms',
    createdAt: 0,
    updatedAt: 0,
    lastMessageAt: 0,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: [],
  };
}

function hit(chatId: string, messageId: string, role: 'user' | 'persona' = 'user'): MessageHit {
  return {
    chatId,
    messageId,
    role,
    createdAt: 1_700_000_000_000,
    snippet: { text: 'paprika', marks: [[0, 7]] },
  };
}

const personas = new Map([
  ['p1', { id: 'p1', name: 'Mira' }],
  ['p2', { id: 'p2', name: 'Sage' }],
]);

describe('toHitGroups', () => {
  it('groups by chat in first-appearance order and builds the jump href', () => {
    const chats = new Map([
      ['a', chatRow('a', 'p1', 'Spices')],
      ['b', chatRow('b', 'p2', 'Books')],
    ]);
    const groups = toHitGroups(
      [hit('b', 'm1'), hit('a', 'm2', 'persona'), hit('b', 'm3')],
      chats,
      personas,
    );
    expect(groups.map((g) => g.key)).toEqual(['b', 'a']);
    expect(groups[0]?.hits.map((h) => h.key)).toEqual(['m1', 'm3']);
    expect(groups[0]?.totalHits).toBe(2);
    expect(groups[0]?.personaId).toBe('p2');
    expect(groups[1]?.hits[0]?.href).toBe('/app/chat/a?focus=m2');
  });

  it("labels the user's turns 'You' and the persona's by name", () => {
    const chats = new Map([['a', chatRow('a', 'p1', 'Spices')]]);
    const [g] = toHitGroups([hit('a', 'm1'), hit('a', 'm2', 'persona')], chats, personas);
    expect(g?.hits.map((h) => h.roleLabel)).toEqual(['You', 'Mira']);
  });

  it("drops a deleted chat's group and shows a rename at once", () => {
    const hits = [hit('a', 'm1'), hit('b', 'm2')];
    const before = toHitGroups(
      hits,
      new Map([
        ['a', chatRow('a', 'p1', 'Spices')],
        ['b', chatRow('b', 'p2', 'Books')],
      ]),
      personas,
    );
    expect(before.map((g) => g.title)).toEqual(['Spices', 'Books']);
    const after = toHitGroups(hits, new Map([['b', chatRow('b', 'p2', 'Novels')]]), personas);
    expect(after.map((g) => g.title)).toEqual(['Novels']);
  });

  it('drops a group whose persona is not visible', () => {
    const chats = new Map([['a', chatRow('a', 'hidden', 'Private')]]);
    expect(toHitGroups([hit('a', 'm1')], chats, personas)).toEqual([]);
  });

  it('falls back to the untitled chat title', () => {
    const chats = new Map([['a', chatRow('a', 'p1', null)]]);
    expect(toHitGroups([hit('a', 'm1')], chats, personas)[0]?.title).toMatch(/^New chat/);
  });
});

describe('hitDateLabel', () => {
  const now = new Date(2026, 10, 18).getTime();

  it('leaves the year out within the current year', () => {
    expect(hitDateLabel(new Date(2026, 10, 3).getTime(), now)).toBe('3 Nov');
  });

  it('adds the year outside the current year', () => {
    expect(hitDateLabel(new Date(2025, 10, 3).getTime(), now)).toBe('3 Nov 2025');
  });
});
