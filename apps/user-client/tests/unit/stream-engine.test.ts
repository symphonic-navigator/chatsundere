import type { StreamChunk } from '@chatsundere/llm-unified';
import * as llm from '@chatsundere/llm-unified';
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { nanoGpt } from '../../../../packages/llm-unified/src/providers/nano-gpt.js';
import { type StreamEngineResult, runStreamEngine } from '../../src/lib/stream-engine';

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
    const model = nanoGpt.knownModels[0];
    if (!model) throw new Error('no model');
    const result: StreamEngineResult = await runStreamEngine({
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
        name: 'Aurum',
        tagline: '',
        colour: '#c9a84c',
        font: 'serif',
        instructions: 'You are Aurum.',
        providerId: 'pr1',
        modelId: model.id,
        mindspaceId: null,
        aboutMeOverride: null,
        textureOverride: null,
        temperature: 0.85,
        adultPersona: false,
        createdAt: 1,
        updatedAt: 1,
      },
      provider: nanoGpt,
      providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      model,
      priorMessages: [],
      userMessageText: 'Hi',
      reasoning: { mode: 'on' },
      globalUnlocker: 'unlock!',
      globalAboutMe: '',
      signal: new AbortController().signal,
      onChunk,
    });
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
    const model = nanoGpt.knownModels[0];
    if (!model) throw new Error('no model');
    await runStreamEngine({
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
        instructions: 'persona body',
        providerId: 'pr1',
        modelId: model.id,
        mindspaceId: null,
        aboutMeOverride: null,
        textureOverride: null,
        temperature: 0.5,
        adultPersona: false,
        createdAt: 1,
        updatedAt: 1,
      },
      provider: nanoGpt,
      providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      model,
      priorMessages: [],
      userMessageText: 'hi',
      reasoning: { mode: 'on' },
      globalUnlocker: 'GLOBAL-UNLOCK',
      globalAboutMe: 'about-me',
      signal: new AbortController().signal,
      onChunk: vi.fn(),
    });
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
    const model = nanoGpt.knownModels[0];
    if (!model) throw new Error('no model');
    await expect(
      runStreamEngine({
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
          providerId: 'pr1',
          modelId: model.id,
          mindspaceId: null,
          aboutMeOverride: null,
          textureOverride: null,
          temperature: 0.5,
          adultPersona: false,
          createdAt: 1,
          updatedAt: 1,
        },
        provider: nanoGpt,
        providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
        apiKey: 'k',
        corsProxyUrl: null,
        corsProxyKey: null,
        model,
        priorMessages: [],
        userMessageText: 'hi',
        reasoning: { mode: 'on' },
        globalUnlocker: '',
        globalAboutMe: '',
        signal: new AbortController().signal,
        onChunk: vi.fn(),
      }),
    ).rejects.toThrow(/rate limited/);
  });
});
