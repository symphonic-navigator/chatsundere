import { type StreamChunk, getOffering } from '@chatsundere/llm-unified';
import * as llm from '@chatsundere/llm-unified';
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { nanoGpt } from '../../../../packages/llm-unified/src/providers/nano-gpt.js';
import type { MessageRow } from '../../src/boot/client-data-db.js';
import {
  type StartStreamArgs,
  type StreamEngineResult,
  runStreamEngine,
} from '../../src/lib/stream-engine';

// nano-gpt deepseek-v4-flash offering (steps reasoning)
// biome-ignore lint/style/noNonNullAssertion: test fixture — this slug is guaranteed to exist in the catalogue
const baseOffering = getOffering('nano-gpt', 'deepseek/deepseek-v4-flash')!;

/**
 * Build a minimal StartStreamArgs for the engine. Tests override only the
 * fields they exercise; everything else comes from this baseline.
 */
function makeArgs(overrides: Partial<StartStreamArgs> = {}): StartStreamArgs {
  const model = nanoGpt.offerings[0];
  if (!model) throw new Error('nano-gpt has no offerings');
  return {
    chat: {
      id: 'c1',
      personaId: 'p1',
      title: null,
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
    },
    persona: {
      id: 'p1',
      name: 'A',
      tagline: '',
      colour: '#fff',
      font: 'serif',
      instructions: 'You are A.',
      canonicalId: null,
      providerId: 'pr1',
      modelId: model.upstreamSlug,
      mindspaceId: null,
      aboutMeOverride: null,
      textureOverride: null,
      temperature: 0.5,
      adultPersona: false,
      chatsundereTonality: true,
      createdAt: 1,
      updatedAt: 1,
    },
    provider: nanoGpt,
    providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
    apiKey: 'k',
    corsProxyUrl: null,
    corsProxyKey: null,
    offering: baseOffering,
    priorMessages: [],
    userMessageText: 'hi',
    reasoning: { kind: 'on' },
    globalInstructions: '',
    globalAboutMe: '',
    signal: new AbortController().signal,
    onChunk: vi.fn(),
    ...overrides,
  };
}

const fakeChunks: StreamChunk[] = [
  { type: 'token', text: 'Hello ' },
  { type: 'token', text: 'world' },
  { type: 'tool-call', toolCallId: 't1', name: 'web_search', argumentsJson: '{}' },
  { type: 'token', text: '!' },
  { type: 'finish', reason: 'stop' },
];

describe('runStreamEngine', () => {
  it('orders text + tool-call into contentBlocks and emits one PillRow', async () => {
    vi.spyOn(llm, 'streamCompletion').mockImplementation(async function* () {
      for (const c of fakeChunks) yield c;
    });
    const onChunk = vi.fn();
    const result: StreamEngineResult = await runStreamEngine(
      makeArgs({ userMessageText: 'Hi', globalInstructions: 'unlock!', onChunk }),
    );
    expect(result.finishReason).toBe('stop');
    expect(result.finalContentBlocks.map((b) => b.type)).toEqual(['text', 'pill', 'text']);
    expect(result.finalContentBlocks[0]).toEqual({ type: 'text', text: 'Hello world' });
    expect(result.finalContentBlocks[2]).toEqual({ type: 'text', text: '!' });
    expect(result.pillRows.length).toBe(1);
    expect(result.pillRows[0]?.kind).toBe('tool-call');
    expect(result.pillRows[0]?.positionHint).toBe('inline');
    expect(result.pillRows[0]?.status).toBe('completed');
    expect(onChunk).toHaveBeenCalledTimes(5);
  });

  it('composes the system prompt with global unlocker visible in the wire-body', async () => {
    let capturedMessages: unknown = null;
    vi.spyOn(llm, 'streamCompletion').mockImplementation(async function* (args) {
      capturedMessages = (args as { messages: unknown }).messages;
      yield { type: 'finish', reason: 'stop' };
    });
    await runStreamEngine(
      makeArgs({
        persona: {
          id: 'p1',
          name: 'A',
          tagline: '',
          colour: '#fff',
          font: 'serif',
          instructions: 'persona body',
          canonicalId: null,
          providerId: 'pr1',
          modelId: 'deepseek/deepseek-v4-flash',
          mindspaceId: null,
          aboutMeOverride: null,
          textureOverride: null,
          temperature: 0.5,
          adultPersona: false,
          chatsundereTonality: true,
          createdAt: 1,
          updatedAt: 1,
        },
        globalInstructions: 'GLOBAL-UNLOCK',
        globalAboutMe: 'about-me',
      }),
    );
    const msgs = capturedMessages as Array<{ role: string; content: string }>;
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[0]?.content).toContain('GLOBAL-UNLOCK');
    expect(msgs[0]?.content).toContain('about-me');
    expect(msgs[0]?.content).toContain('persona body');
  });

  it('throws on error chunk', async () => {
    vi.spyOn(llm, 'streamCompletion').mockImplementation(async function* () {
      yield { type: 'error', message: 'rate limited' };
    });
    await expect(runStreamEngine(makeArgs())).rejects.toThrow(/rate limited/);
  });

  it('coalesces adjacent reasoning chunks into a single reasoning block in finalContentBlocks', async () => {
    vi.spyOn(llm, 'streamCompletion').mockImplementation(async function* () {
      yield { type: 'reasoning', text: 'planning … ' };
      yield { type: 'reasoning', text: 'more thought' };
      yield { type: 'token', text: 'Hello ' };
      yield { type: 'token', text: 'world.' };
      yield { type: 'finish', reason: 'stop' };
    });
    const result = await runStreamEngine(makeArgs());
    expect(result.finalContentBlocks).toEqual([
      { type: 'reasoning', text: 'planning … more thought' },
      { type: 'text', text: 'Hello world.' },
    ]);
  });

  it('passes reasoning chunks through the onChunk callback', async () => {
    vi.spyOn(llm, 'streamCompletion').mockImplementation(async function* () {
      yield { type: 'reasoning', text: 'a' };
      yield { type: 'reasoning', text: 'b' };
      yield { type: 'token', text: 'answer' };
      yield { type: 'finish', reason: 'stop' };
    });
    const onChunk = vi.fn();
    await runStreamEngine(makeArgs({ onChunk }));
    const reasoningCalls = onChunk.mock.calls.filter(
      (call) => (call[0] as StreamChunk).type === 'reasoning',
    );
    expect(reasoningCalls.length).toBe(2);
  });

  it('toWireMessage filters reasoning blocks from priorMessages history', async () => {
    let capturedMessages: unknown = null;
    vi.spyOn(llm, 'streamCompletion').mockImplementation(async function* (args) {
      capturedMessages = (args as { messages: unknown }).messages;
      yield { type: 'token', text: 'ok' };
      yield { type: 'finish', reason: 'stop' };
    });
    const priorWithReasoning: MessageRow = {
      id: 'm-prior',
      chatId: 'c1',
      role: 'persona',
      contentBlocks: [
        { type: 'reasoning', text: 'past thought' },
        { type: 'text', text: 'past answer' },
      ],
      createdAt: 1,
      bookmarked: false,
      streamingState: 'complete',
    };
    await runStreamEngine(makeArgs({ priorMessages: [priorWithReasoning] }));
    const msgs = capturedMessages as Array<{ role: string; content: string }>;
    const assistantEntry = msgs.find((m) => m.role === 'assistant');
    expect(assistantEntry?.content).toBe('past answer');
  });
});
