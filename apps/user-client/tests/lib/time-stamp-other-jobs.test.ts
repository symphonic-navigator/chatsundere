// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import * as llm from '@chatsundere/llm-unified';
import { type StreamChunk, type WireMessage, getOffering } from '@chatsundere/llm-unified';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoGpt } from '../../../../packages/llm-unified/src/providers/nano-gpt.js';
import {
  type MessageRow,
  type PersonaRow,
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  COMPACTION_SYSTEM_PROMPT,
  buildCompactionTranscript,
} from '../../src/compaction/compaction-prompt.js';
import { messageToSource } from '../../src/compaction/runner.js';
import { authorArtefact } from '../../src/lib/artefact-author.js';
import { buildEngineWireMessages } from '../../src/lib/stream-engine.js';
import { resolveTimeAwareness } from '../../src/lib/time-awareness.js';
import { generateTitleAsync } from '../../src/lib/title-generator.js';
import { buildSummaryMessages } from '../../src/lib/tool-summary.js';
import { buildExtractionPrompt } from '../../src/memory/extraction-prompt.js';
import { getUnextractedUserText } from '../../src/memory/repo.js';
import { type ExpertBase, createAskExpertTool } from '../../src/tools/ask-expert.js';

// Stamps belong to the chat job's wire only (spec Part A, Non-goals). With the
// switch on, every other job's inputs are built from the same stored rows and
// must contain no `<sent`: the stamp is rendered at wire time, never stored.

// biome-ignore lint/style/noNonNullAssertion: test fixture — this slug is guaranteed to exist in the catalogue
const offering = getOffering('nano-gpt', 'deepseek/deepseek-v4-flash')!;
const T0 = Date.parse('2026-11-18T20:14:00Z');

const persona: PersonaRow = {
  id: 'p1',
  name: 'A',
  tagline: '',
  colour: '#fff',
  font: 'serif',
  instructions: 'You are A.',
  canonicalId: null,
  providerId: 'pr1',
  modelId: offering.upstreamSlug,
  mindspaceId: null,
  aboutMeOverride: null,
  textureOverride: null,
  temperature: 0.5,
  adultPersona: false,
  chatsundereTonality: true,
  contextWindow: null,
  libraryIds: [],
  askExpertDefault: false,
  mcpOverrides: {},
  roleplay: false,
  narration: 'first',
  greetingEnabled: false,
  greetingInstructions: '',
  voice: null,
  narratorVoice: null,
  timeAwareness: true,
  createdAt: 1,
  updatedAt: 1,
};

const rows: MessageRow[] = [
  {
    id: 'm1',
    chatId: 'c1',
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'I love hiking in the Alps.' }],
    createdAt: T0,
    utcOffsetMinutes: 60,
    updatedAt: T0,
    bookmarked: false,
    streamingState: 'complete',
  },
  {
    id: 'm2',
    chatId: 'c1',
    role: 'persona',
    contentBlocks: [{ type: 'text', text: 'Which peak is your favourite?' }],
    createdAt: T0 + 1,
    updatedAt: T0 + 1,
    bookmarked: false,
    streamingState: 'complete',
  },
  {
    id: 'm3',
    chatId: 'c1',
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'The Zugspitze, and I prefer tea to coffee.' }],
    createdAt: T0 + 2,
    utcOffsetMinutes: 60,
    updatedAt: T0 + 2,
    bookmarked: false,
    streamingState: 'complete',
  },
];

beforeEach(async () => {
  await openClientDataDb();
  const db = getClientDataDb();
  await db.chats.add({
    id: 'c1',
    personaId: 'p1',
    title: null,
    resolvedMindspaceId: 'm1',
    createdAt: T0,
    updatedAt: T0,
    lastMessageAt: T0 + 2,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: [],
  });
  await db.messages.bulkAdd(rows);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await _resetClientDataDbForTests();
});

describe('no <sent> outside the chat job', () => {
  it('the fixture is stamped on the chat wire, so the checks below are meaningful', () => {
    expect(resolveTimeAwareness(persona)).toBe(true);
    const wire = buildEngineWireMessages('SYS', rows.slice(0, 2), 'next', [], undefined, {});
    expect(JSON.stringify(wire)).toContain('<sent>');
  });

  it('title generation', async () => {
    let sent: WireMessage[] = [];
    vi.spyOn(llm, 'runOneShotCompletion').mockImplementation(async (a) => {
      sent = a.messages;
      return 'Alpine hiking';
    });
    const chat = await getClientDataDb().chats.get('c1');
    if (!chat) throw new Error('fixture chat missing');
    await generateTitleAsync({
      chat,
      persona,
      provider: nanoGpt,
      providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
      apiKey: 'k',
      offering,
      firstUserMessage: 'I love hiking in the Alps.',
      firstPersonaResponse: 'Which peak is your favourite?',
      globalInstructions: '',
      globalAboutMe: '',
    });
    expect(sent.length).toBeGreaterThan(0);
    expect(JSON.stringify(sent)).not.toContain('<sent');
  });

  it('memory extraction', async () => {
    const { texts } = await getUnextractedUserText('c1', null, 50);
    expect(texts.length).toBe(2);
    const prompt = buildExtractionPrompt({ memoryBody: null, journalEntries: [], messages: texts });
    expect(prompt).not.toContain('<sent');
  });

  it('the compaction summariser input', () => {
    const transcript = buildCompactionTranscript(
      rows.map((r) => messageToSource(r, new Map())),
      null,
    );
    expect(transcript).toContain('Zugspitze');
    expect(`${COMPACTION_SYSTEM_PROMPT}\n${transcript}`).not.toContain('<sent');
  });

  it('the tool summary', () => {
    const msgs = buildSummaryMessages(
      {
        id: 'pl1',
        messageId: 'm2',
        kind: 'tool-call',
        positionHint: 'inline',
        status: 'completed',
        payload: { name: 'web_fetch', argumentsJson: '{}', result: 'x'.repeat(5000) },
        createdAt: T0,
      },
      false,
    );
    expect(JSON.stringify(msgs)).not.toContain('<sent');
  });

  it('ask_expert', async () => {
    let sent: WireMessage[] = [];
    const streamFn = vi.fn((opts: { messages: WireMessage[] }) => {
      sent = opts.messages;
      return (async function* (): AsyncIterable<StreamChunk> {
        yield { type: 'token', text: 'answer' };
      })();
    }) as never;
    const tool = createAskExpertTool(
      {} as ExpertBase,
      'Expert',
      { enabled: false },
      true,
      streamFn,
    );
    await tool.execute({ question: 'What is a Lie group?' });
    expect(sent.length).toBe(2);
    expect(JSON.stringify(sent)).not.toContain('<sent');
  });

  it('the artefact author', async () => {
    let sent: WireMessage[] = [];
    const streamFn = vi.fn((opts: { messages: WireMessage[] }) => {
      sent = opts.messages;
      return (async function* (): AsyncIterable<StreamChunk> {
        yield { type: 'token', text: '# Doc' };
      })();
    }) as never;
    await authorArtefact({
      base: {} as ExpertBase,
      brief: 'A packing list for the Zugspitze.',
      format: 'markdown',
      contentAxisPrompt: '',
      reasoning: { enabled: false },
      streamFn,
    });
    expect(sent.length).toBe(2);
    expect(JSON.stringify(sent)).not.toContain('<sent');
  });
});
