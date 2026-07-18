// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  importThirdPartyConversations,
  listAlreadyImported,
} from '../../src/data/third-party-import.js';
import type { ThirdPartyConversation } from '../../src/lib/third-party-import/types.js';

const ZERO = { images: 0, toolCalls: 0, attachments: 0, artefacts: 0, knowledgeLookups: 0 };
const T0 = 1721300000000;

function conv(overrides: Partial<ThirdPartyConversation> = {}): ThirdPartyConversation {
  return {
    sourceId: 'chatgpt/c1',
    source: 'chatgpt',
    title: 'Imported',
    createdAt: T0,
    lastMessageAt: T0 + 5000,
    messages: [
      { role: 'user', createdAt: T0, blocks: [{ type: 'text', text: 'hi' }], dropped: { ...ZERO } },
      {
        role: 'persona',
        createdAt: T0 + 1000,
        blocks: [
          { type: 'reasoning', text: 'thinking' },
          { type: 'text', text: 'hello' },
        ],
        dropped: { ...ZERO, images: 2 },
      },
    ],
    ...overrides,
  };
}

describe('third-party import writer', () => {
  let personaId: string;

  beforeEach(async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    const now = Date.now();
    await db.mindspaces.add({
      id: 'ms1',
      name: 'Default',
      instructions: '',
      createdAt: now,
      updatedAt: now,
    } as never);
    await db.settings.put({ id: 1, defaultMindspaceId: 'ms1' } as never);
    personaId = 'p1';
    await db.personas.add({
      id: personaId,
      name: 'Fable',
      createdAt: now,
      updatedAt: now,
    } as never);
  });

  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('writes chat + messages with importedFrom, blocks and dropped hint', async () => {
    const r = await importThirdPartyConversations(personaId, [conv()]);
    expect(r).toEqual({ imported: 1, skipped: 0 });

    const db = getClientDataDb();
    const chats = await db.chats.where('personaId').equals(personaId).toArray();
    expect(chats).toHaveLength(1);
    expect(chats[0]?.importedFrom).toBe('chatgpt/c1');
    expect(chats[0]?.title).toBe('Imported');
    expect(chats[0]?.createdAt).toBe(T0);

    const chatId = chats[0]?.id ?? '';
    const messages = await db.messages.where('chatId').equals(chatId).sortBy('createdAt');
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('user');
    expect(messages[1]?.contentBlocks[0]).toEqual({ type: 'reasoning', text: 'thinking' });
    expect(messages[1]?.contentBlocks[1]).toEqual({ type: 'text', text: 'hello' });
    // The dropped hint rides as a trailing text block.
    expect(messages[1]?.contentBlocks[2]).toEqual({
      type: 'text',
      text: '[2 images from the original message were not imported.]',
    });
    expect(messages.every((m) => m.streamingState === 'complete')).toBe(true);
    // Memory extraction cursor untouched (spec §8).
    expect(chats[0]?.lastExtractedMessageId).toBeUndefined();
  });

  it('is idempotent by sourceId and reported by listAlreadyImported', async () => {
    await importThirdPartyConversations(personaId, [conv()]);
    const again = await importThirdPartyConversations(personaId, [conv()]);
    expect(again).toEqual({ imported: 0, skipped: 1 });
    const seen = await listAlreadyImported(personaId);
    expect(seen.has('chatgpt/c1')).toBe(true);
    expect(seen.has('grok/other')).toBe(false);
  });

  it('enforces strictly increasing createdAt under equal source timestamps', async () => {
    const equal = conv({
      sourceId: 'grok/equal',
      messages: [
        {
          role: 'user',
          createdAt: T0,
          blocks: [{ type: 'text', text: 'a' }],
          dropped: { ...ZERO },
        },
        {
          role: 'persona',
          createdAt: T0,
          blocks: [{ type: 'text', text: 'b' }],
          dropped: { ...ZERO },
        },
        { role: 'user', createdAt: 0, blocks: [{ type: 'text', text: 'c' }], dropped: { ...ZERO } },
      ],
    });
    await importThirdPartyConversations(personaId, [equal]);
    const db = getClientDataDb();
    // No importedFrom index exists (and adding one would be a Dexie bump) — filter.
    const chat = await db.chats.filter((c) => c.importedFrom === 'grok/equal').first();
    const ordered = await db.messages
      .where('chatId')
      .equals(chat?.id ?? '')
      .sortBy('createdAt');
    expect(ordered.map((m) => (m.contentBlocks[0] as { text: string }).text)).toEqual([
      'a',
      'b',
      'c',
    ]);
    const times = ordered.map((m) => m.createdAt);
    expect(times[1]).toBeGreaterThan(times[0] ?? 0);
    expect(times[2]).toBeGreaterThan(times[1] ?? 0);
  });

  it('skips conversations with no messages', async () => {
    const r = await importThirdPartyConversations(personaId, [
      conv({ sourceId: 'chatgpt/empty', messages: [] }),
    ]);
    expect(r).toEqual({ imported: 0, skipped: 1 });
  });
});
