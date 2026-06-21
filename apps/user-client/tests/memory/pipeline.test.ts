// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runOneShotCompletion = vi.fn();
vi.mock('@chatsundere/llm-unified', () => ({
  runOneShotCompletion: (...a: unknown[]) => runOneShotCompletion(...a),
  offeringToTarget: () => ({ kind: 'test' }),
  formatRetryEvent: () => '',
}));

import {
  type ChatRow,
  type PersonaRow,
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { _resetMemoryLocksForTests, tryAcquireMemoryLock } from '../../src/memory/mutex.js';
import { runMemoryPipeline } from '../../src/memory/pipeline.js';
import { countJournal, getCurrentBody } from '../../src/memory/repo.js';

const persona = (over: Partial<PersonaRow> = {}): PersonaRow =>
  ({ id: 'p1', name: 'P', useMemory: true, memoryInstructions: '', ...over }) as PersonaRow;
const chat = (over: Partial<ChatRow> = {}): ChatRow =>
  ({ id: 'c1', personaId: 'p1', lastExtractedMessageId: null, ...over }) as ChatRow;

const args = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    persona: persona(),
    chat: chat(),
    provider: {},
    providerConfig: {},
    apiKey: 'k',
    corsProxyUrl: null,
    corsProxyKey: null,
    offering: {},
    ...over,
  }) as never;

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  _resetMemoryLocksForTests();
  runOneShotCompletion.mockReset();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

async function seedUserMessages(n: number): Promise<void> {
  const db = getClientDataDb();
  await db.chats.add(chat() as never);
  for (let i = 0; i < n; i++) {
    await db.messages.add({
      id: `m${String(i).padStart(3, '0')}`,
      chatId: 'c1',
      role: 'user',
      contentBlocks: [{ type: 'text', text: `fact number ${i}` }],
      createdAt: i + 1,
      bookmarked: false,
      streamingState: 'complete',
    } as never);
  }
}

describe('runMemoryPipeline', () => {
  it('no-ops when useMemory is false', async () => {
    await seedUserMessages(10);
    await runMemoryPipeline(args({ persona: persona({ useMemory: false }) }));
    expect(runOneShotCompletion).not.toHaveBeenCalled();
    expect(await countJournal('p1', 'uncommitted')).toBe(0);
  });

  it('extracts when the new-message threshold is met', async () => {
    await seedUserMessages(8);
    runOneShotCompletion.mockResolvedValue('[{"content":"Likes hiking","category":"preference"}]');
    await runMemoryPipeline(args());
    expect(runOneShotCompletion).toHaveBeenCalledTimes(1);
    expect(await countJournal('p1', 'uncommitted')).toBe(1);
    expect((await getClientDataDb().chats.get('c1'))?.lastExtractedMessageId).toBe('m007');
  });

  it('drops the trigger when the persona lock is already held', async () => {
    await seedUserMessages(8);
    tryAcquireMemoryLock('p1');
    await runMemoryPipeline(args());
    expect(runOneShotCompletion).not.toHaveBeenCalled();
  });

  it('auto-commits then dreams once committed entries cross the threshold', async () => {
    // 20 committed entries already present → dreaming fires; mock returns a body.
    const db = getClientDataDb();
    for (let i = 0; i < 20; i++) {
      await db.memoryJournal.add({
        id: `j${i}`,
        personaId: 'p1',
        content: `c${i}`,
        category: null,
        state: 'committed',
        isCorrection: false,
        createdAt: i,
        committedAt: i,
        autoCommitted: true,
        archivedByDreamId: null,
      } as never);
    }
    await db.chats.add(chat() as never); // no user messages → extraction no-ops
    runOneShotCompletion.mockResolvedValue('Consolidated body prose.');
    await runMemoryPipeline(args());
    expect((await getCurrentBody('p1'))?.content).toBe('Consolidated body prose.');
    expect(await countJournal('p1', 'archived')).toBe(20);
    expect(await countJournal('p1', 'committed')).toBe(0);
  });
});
