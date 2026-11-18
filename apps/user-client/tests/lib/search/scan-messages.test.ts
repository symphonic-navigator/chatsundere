// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ContentBlock,
  type MessageRow,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import {
  type MessageHit,
  type ScanChat,
  type ScanProgress,
  scanMessages,
} from '../../../src/lib/search/scan-messages.js';

function row(
  chatId: string,
  createdAt: number,
  text: string,
  extra: Partial<MessageRow> = {},
): MessageRow {
  const blocks: ContentBlock[] = [{ type: 'text', text }];
  return {
    id: uuidv7(),
    chatId,
    role: 'user',
    contentBlocks: blocks,
    createdAt,
    updatedAt: createdAt,
    bookmarked: false,
    streamingState: 'complete',
    ...extra,
  };
}

function chat(id: string): ScanChat {
  return { id, personaId: 'p', title: id };
}

async function run(
  args: Partial<Parameters<typeof scanMessages>[0]> & { chats: readonly ScanChat[]; query: string },
): Promise<{ hits: MessageHit[]; progress: ScanProgress[] }> {
  const hits: MessageHit[] = [];
  const progress: ScanProgress[] = [];
  await scanMessages({
    signal: new AbortController().signal,
    onHits: (h) => hits.push(...h),
    onProgress: (p) => progress.push(p),
    ...args,
  });
  return { hits, progress };
}

describe('scanMessages', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('follows the input chat order and createdAt order within a chat', async () => {
    const db = await openClientDataDb();
    const a = row('chat-a', 20, 'paprika late');
    const b = row('chat-a', 10, 'paprika early', { role: 'persona' });
    const c = row('chat-b', 5, 'paprika in b');
    await db.messages.bulkAdd([a, b, c]);

    const { hits, progress } = await run({
      chats: [chat('chat-b'), chat('chat-a')],
      query: 'Paprika',
    });
    expect(hits.map((h) => h.messageId)).toEqual([c.id, b.id, a.id]);
    expect(hits[1]?.role).toBe('persona');
    expect(hits[0]?.snippet.text).toBe('paprika in b');
    const last = progress[progress.length - 1];
    expect(last).toEqual({
      scannedChats: 2,
      totalChats: 2,
      hits: 3,
      capped: false,
      done: true,
      nextIndex: 2,
    });
  });

  it('skips system rows and reasoning-only matches', async () => {
    const db = await openClientDataDb();
    await db.messages.bulkAdd([
      row('c', 1, 'paprika from the system', { role: 'system' }),
      row('c', 2, 'Here you go.', {
        role: 'persona',
        contentBlocks: [
          { type: 'reasoning', text: 'They asked about paprika.' },
          { type: 'text', text: 'Here you go.' },
        ],
      }),
    ]);
    const keep = row('c', 3, 'more paprika please');
    await db.messages.add(keep);

    const { hits } = await run({ chats: [chat('c')], query: 'paprika' });
    expect(hits.map((h) => h.messageId)).toEqual([keep.id]);
  });

  it('stops at the cap and flags it, dropping the rest of the chat', async () => {
    const db = await openClientDataDb();
    await db.messages.bulkAdd([
      row('c1', 1, 'word one'),
      row('c1', 2, 'word two'),
      row('c1', 3, 'word three'),
      row('c2', 1, 'word four'),
    ]);
    const { hits, progress } = await run({
      chats: [chat('c1'), chat('c2')],
      query: 'word',
      cap: 2,
    });
    expect(hits).toHaveLength(2);
    const last = progress[progress.length - 1];
    expect(last?.capped).toBe(true);
    expect(last?.done).toBe(true);
    expect(last?.hits).toBe(2);
    expect(last?.nextIndex).toBe(1);
  });

  it('counts initial hits towards the cap when resuming', async () => {
    const db = await openClientDataDb();
    await db.messages.bulkAdd([row('c1', 1, 'word one'), row('c1', 2, 'word two')]);
    const { hits, progress } = await run({
      chats: [chat('c1')],
      query: 'word',
      cap: 3,
      initialHits: 2,
    });
    expect(hits).toHaveLength(1);
    expect(progress[progress.length - 1]).toMatchObject({ hits: 3, capped: true });
  });

  it('stops calling back once aborted mid-scan', async () => {
    const db = await openClientDataDb();
    const chats: ScanChat[] = [];
    for (let i = 0; i < 5; i++) {
      await db.messages.add(row(`c${i}`, 1, 'needle'));
      chats.push(chat(`c${i}`));
    }
    const controller = new AbortController();
    const originalWhere = db.messages.where.bind(db.messages);
    let reads = 0;
    vi.spyOn(db.messages, 'where').mockImplementation(((index: string) => {
      reads++;
      if (reads === 2) controller.abort();
      return originalWhere(index);
    }) as typeof db.messages.where);
    const hits: MessageHit[] = [];
    const progress: ScanProgress[] = [];
    let afterAbort = 0;
    await scanMessages({
      chats,
      query: 'needle',
      signal: controller.signal,
      onHits: (h) => {
        if (controller.signal.aborted) afterAbort++;
        hits.push(...h);
      },
      onProgress: (p) => {
        if (controller.signal.aborted) afterAbort++;
        progress.push(p);
      },
    });
    expect(afterAbort).toBe(0);
    expect(reads).toBe(2);
    expect(progress.every((p) => !p.done)).toBe(true);
  });

  it('resumes from startIndex', async () => {
    const db = await openClientDataDb();
    const first = row('c1', 1, 'needle one');
    const second = row('c2', 1, 'needle two');
    await db.messages.bulkAdd([first, second]);
    const { hits, progress } = await run({
      chats: [chat('c1'), chat('c2')],
      query: 'needle',
      startIndex: 1,
      initialHits: 1,
    });
    expect(hits.map((h) => h.messageId)).toEqual([second.id]);
    expect(progress[progress.length - 1]).toMatchObject({
      scannedChats: 2,
      hits: 2,
      done: true,
      nextIndex: 2,
    });
  });

  it('never queries a chat outside the given list (structural gate)', async () => {
    const db = await openClientDataDb();
    await db.messages.bulkAdd([
      row('sfw-chat', 1, 'the secret word'),
      row('adult-chat', 1, 'the secret word, adult'),
    ]);
    const queried: unknown[] = [];
    const originalWhere = db.messages.where.bind(db.messages);
    vi.spyOn(db.messages, 'where').mockImplementation(((index: string) => {
      const clause = originalWhere(index);
      const originalBetween = clause.between.bind(clause);
      clause.between = (lower, upper, includeLower, includeUpper) => {
        queried.push(lower, upper);
        return originalBetween(lower, upper, includeLower, includeUpper);
      };
      return clause;
    }) as typeof db.messages.where);

    const { hits } = await run({ chats: [chat('sfw-chat')], query: 'secret' });
    expect(hits.map((h) => h.chatId)).toEqual(['sfw-chat']);
    expect(queried.length).toBeGreaterThan(0);
    for (const key of queried) {
      expect(Array.isArray(key) ? key[0] : key).toBe('sfw-chat');
    }
    expect(JSON.stringify(queried)).not.toContain('adult-chat');
  });

  it('reads nothing for a blank query', async () => {
    const db = await openClientDataDb();
    const where = vi.spyOn(db.messages, 'where');
    const { hits, progress } = await run({ chats: [chat('c')], query: '   ' });
    expect(where).not.toHaveBeenCalled();
    expect(hits).toEqual([]);
    expect(progress[progress.length - 1]?.done).toBe(true);
  });
});
