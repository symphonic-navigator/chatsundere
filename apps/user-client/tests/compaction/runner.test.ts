// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
vi.mock('@chatsundere/llm-unified', async (orig) => {
  const actual = await orig<typeof import('@chatsundere/llm-unified')>();
  return {
    ...actual,
    runOneShotCompletion: vi.fn(async () => {
      calls.push('x');
      // First call returns an invalid (incomplete) briefing, forcing the retry;
      // the second returns a valid six-section briefing.
      return calls.length === 1
        ? '## Topic & Goal\nonly one section'
        : '## Topic & Goal\na\n## Established Facts\nb\n## Open Threads\nc\n## User Preferences Observed\nd\n## Pending References\ne\n## Tone & Persona Adherence\nf';
    }),
  };
});

import { runOneShotCompletion } from '@chatsundere/llm-unified';
import { getClientDataDb, openClientDataDb } from '../../src/boot/client-data-db.js';
import { listCheckpoints } from '../../src/compaction/repo.js';
import { runCompaction } from '../../src/compaction/runner.js';

afterEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
});

describe('runCompaction', () => {
  it('summarises the source, retries on invalid output, and writes a checkpoint', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    const now = Date.now();
    await db.chats.add({
      id: 'rc1',
      personaId: 'p',
      title: null,
      resolvedMindspaceId: 'm',
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    // 20 complete text messages so a tail is carved and a source remains.
    for (let i = 0; i < 20; i += 1) {
      await db.messages.add({
        id: `m${i}`,
        chatId: 'rc1',
        role: i % 2 === 0 ? 'user' : 'persona',
        contentBlocks: [{ type: 'text', text: `message ${i} with enough words to count` }] as never,
        createdAt: now + i,
        updatedAt: now + i,
        bookmarked: false,
        streamingState: 'complete',
      });
    }
    const chat = await db.chats.get('rc1');
    if (!chat) throw new Error('chat missing');
    const result = await runCompaction({
      chat,
      persona: { id: 'p', name: 'Fable' } as never,
      provider: {} as never,
      providerConfig: {} as never,
      apiKey: 'k',
      // Small window so the tail algorithm carves a source slice from the 20 messages.
      // 512-token window → tokenTarget=102; 12 tail messages × ~9 tokens ≈ 108 ≥ 102 → tailStart=8.
      // upstreamSlug + adapter are required by offeringToTarget (called inside runner).
      offering: {
        context: { recommended: 512, max: 512 },
        upstreamSlug: 'test-model',
        canonicalRef: 'test/test-model',
        adapter: { kind: 'direct' },
      } as never,
      trigger: 'manual',
    });
    expect(result).not.toBeNull();
    expect(calls.length).toBe(2); // one invalid + one valid retry
    const cps = await listCheckpoints('rc1');
    expect(cps).toHaveLength(1);
    expect(cps[0]?.summaryMarkdown).toContain('Established Facts');
    expect(cps[0]?.trigger).toBe('manual');
  });

  it('passes the compaction timeout to the one-shot call', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    const now = Date.now();
    await db.chats.add({
      id: 'rc2',
      personaId: 'p',
      title: null,
      resolvedMindspaceId: 'm',
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    for (let i = 0; i < 20; i += 1) {
      await db.messages.add({
        id: `n${i}`,
        chatId: 'rc2',
        role: i % 2 === 0 ? 'user' : 'persona',
        contentBlocks: [{ type: 'text', text: `message ${i} with enough words to count` }] as never,
        createdAt: now + i,
        updatedAt: now + i,
        bookmarked: false,
        streamingState: 'complete',
      });
    }
    const chat = await db.chats.get('rc2');
    if (!chat) throw new Error('chat missing');
    await runCompaction({
      chat,
      persona: { id: 'p', name: 'Fable' } as never,
      provider: {} as never,
      providerConfig: {} as never,
      apiKey: 'k',
      offering: {
        context: { recommended: 512, max: 512 },
        upstreamSlug: 'test-model',
        canonicalRef: 'test/test-model',
        adapter: { kind: 'direct' },
      } as never,
      trigger: 'manual',
    });
    expect(vi.mocked(runOneShotCompletion).mock.calls[0]?.[0]).toMatchObject({
      timeoutMs: 180_000,
    });
  });
});
