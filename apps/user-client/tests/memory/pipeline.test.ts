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
import { DREAM_BATCH_SIZE, DREAM_THRESHOLD, UNCOMMITTED_CAP } from '../../src/memory/config.js';
import { _resetMemoryLocksForTests, tryAcquireMemoryLock } from '../../src/memory/mutex.js';
import {
  MemoryInvalidOutputError,
  runDreaming,
  runExtraction,
  runMemoryPipeline,
} from '../../src/memory/pipeline.js';
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

  it('passes the extraction timeout to the one-shot call', async () => {
    await seedUserMessages(8);
    runOneShotCompletion.mockResolvedValue('[]');
    await runMemoryPipeline(args());
    expect(runOneShotCompletion.mock.calls[0]?.[0]).toMatchObject({ timeoutMs: 60_000 });
  });

  it('auto-commits then dreams once committed entries cross the threshold', async () => {
    // DREAM_THRESHOLD committed entries already present → dreaming fires; mock returns a body.
    const db = getClientDataDb();
    for (let i = 0; i < DREAM_THRESHOLD; i++) {
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
    expect(await countJournal('p1', 'archived')).toBe(DREAM_THRESHOLD);
    expect(await countJournal('p1', 'committed')).toBe(0);
  });

  it('absorbs a dreaming invalid-output throw and releases the persona lock', async () => {
    await seedCommitted(DREAM_THRESHOLD);
    await getClientDataDb().chats.add(chat() as never); // no user messages → extraction no-ops
    runOneShotCompletion.mockResolvedValue('   '); // fails validateMemoryBody
    await expect(runMemoryPipeline(args())).resolves.toBeUndefined();
    expect(await countJournal('p1', 'committed')).toBe(DREAM_THRESHOLD); // dream slice never checkpointed
    expect(tryAcquireMemoryLock('p1')).toBe(true); // lock released in the finally block
  });
});

async function seedCommitted(n: number): Promise<void> {
  const db = getClientDataDb();
  for (let i = 0; i < n; i++) {
    await db.memoryJournal.add({
      id: `j${String(i).padStart(3, '0')}`,
      personaId: 'p1',
      content: `fact ${i}`,
      category: null,
      state: 'committed',
      isCorrection: false,
      createdAt: i,
      committedAt: i,
      autoCommitted: true,
      archivedByDreamId: null,
    } as never);
  }
}

describe('runDreaming (batched)', () => {
  it('drains a large backlog in DREAM_BATCH_SIZE slices, firing onSlice per slice', async () => {
    await seedCommitted(DREAM_BATCH_SIZE * 2 + 20); // 100 → slices of 40/40/20
    runOneShotCompletion.mockResolvedValue('Consolidated body prose.');
    const onSlice = vi.fn();
    const wrote = await runDreaming(args(), { force: true, onSlice });
    expect(wrote).toBe(true);
    expect(runOneShotCompletion).toHaveBeenCalledTimes(3);
    expect(onSlice).toHaveBeenCalledTimes(3);
    expect(await countJournal('p1', 'committed')).toBe(0);
    expect(await countJournal('p1', 'archived')).toBe(DREAM_BATCH_SIZE * 2 + 20);
  });

  it('consolidates oldest-first: the first slice carries the oldest entries', async () => {
    await seedCommitted(DREAM_BATCH_SIZE + 1);
    runOneShotCompletion.mockResolvedValue('Consolidated body prose.');
    await runDreaming(args(), { force: true });
    const firstSystem = (
      runOneShotCompletion.mock.calls[0]?.[0] as { messages: { content: string }[] }
    ).messages[0]?.content;
    expect(firstSystem).toContain('fact 0');
    expect(firstSystem).not.toContain(`fact ${DREAM_BATCH_SIZE}`);
  });

  it('a mid-drain failure keeps checkpointed slices archived and the remainder committed', async () => {
    await seedCommitted(DREAM_BATCH_SIZE + 10); // 50 → slices of 40/10
    runOneShotCompletion
      .mockResolvedValueOnce('Consolidated body prose.')
      .mockRejectedValueOnce(new Error('upstream exploded'));
    const onSlice = vi.fn();
    await expect(runDreaming(args(), { force: true, onSlice })).rejects.toThrow(
      'upstream exploded',
    );
    expect(onSlice).toHaveBeenCalledTimes(1);
    expect(await countJournal('p1', 'archived')).toBe(DREAM_BATCH_SIZE);
    expect(await countJournal('p1', 'committed')).toBe(10);
    expect((await getCurrentBody('p1'))?.content).toBe('Consolidated body prose.');
  });

  it('throws MemoryInvalidOutputError when the model output fails validation', async () => {
    await seedCommitted(5);
    runOneShotCompletion.mockResolvedValue('   ');
    await expect(runDreaming(args(), { force: true })).rejects.toBeInstanceOf(
      MemoryInvalidOutputError,
    );
    expect(await countJournal('p1', 'committed')).toBe(5);
  });

  it('forwards the raw model answer to onRawResponse (debug-view capture)', async () => {
    await seedCommitted(5);
    const answer = { content: '', reasoning: 'thought hard', finishReason: 'stop' };
    // The one-shot call fires its onRawResponse, then the empty content throws.
    runOneShotCompletion.mockImplementation(async (a: { onRawResponse?: (r: unknown) => void }) => {
      a.onRawResponse?.(answer);
      throw new Error('one-shot returned empty content');
    });
    const onRawResponse = vi.fn();
    await expect(runDreaming(args(), { force: true, onRawResponse })).rejects.toThrow();
    expect(onRawResponse).toHaveBeenCalledWith(answer);
  });

  it('respects the threshold gate without force', async () => {
    await seedCommitted(DREAM_THRESHOLD - 1);
    expect(await runDreaming(args())).toBe(false);
    expect(runOneShotCompletion).not.toHaveBeenCalled();
  });
});

describe('runExtraction cursor honesty', () => {
  it('holds the cursor when the uncommitted cap drops fresh entries', async () => {
    await seedUserMessages(8);
    const db = getClientDataDb();
    for (let i = 0; i < UNCOMMITTED_CAP; i++) {
      await db.memoryJournal.add({
        id: `u${String(i).padStart(3, '0')}`,
        personaId: 'p1',
        content: `existing ${i}`,
        category: null,
        state: 'uncommitted',
        isCorrection: false,
        createdAt: i,
        committedAt: null,
        autoCommitted: false,
        archivedByDreamId: null,
      } as never);
    }
    runOneShotCompletion.mockResolvedValue('[{"content":"Brand new fact"}]');
    const added = await runExtraction(args(), { force: true });
    expect(added).toBe(0);
    expect((await db.chats.get('c1'))?.lastExtractedMessageId ?? null).toBeNull();
    expect(await countJournal('p1', 'uncommitted')).toBe(UNCOMMITTED_CAP);
  });
});
