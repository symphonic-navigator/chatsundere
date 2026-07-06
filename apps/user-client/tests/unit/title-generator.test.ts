import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import * as llm from '@chatsundere/llm-unified';
import { getOffering } from '@chatsundere/llm-unified';
import { uuidv7 } from 'uuidv7';
import { nanoGpt } from '../../../../packages/llm-unified/src/providers/nano-gpt';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';
import type { ChatRow, PersonaRow } from '../../src/boot/client-data-db';
import {
  TITLE_INSTRUCTION,
  fallbackTitle,
  generateTitleAsync,
  sanitiseTitle,
} from '../../src/lib/title-generator';

describe('sanitiseTitle', () => {
  it('strips surrounding straight + smart quotes', () => {
    expect(sanitiseTitle('"hello"')).toBe('hello');
    expect(sanitiseTitle("'hi there'")).toBe('hi there');
    expect(sanitiseTitle('“fancy”')).toBe('fancy');
  });
  it('collapses consecutive whitespace', () => {
    expect(sanitiseTitle('a    b\tc')).toBe('a b c');
  });
  it('trims surrounding whitespace', () => {
    expect(sanitiseTitle('   hi   ')).toBe('hi');
  });
  it('caps at 60 chars', () => {
    const longTitle = 'a'.repeat(80);
    expect(sanitiseTitle(longTitle)?.length).toBe(60);
  });
  it('empty / whitespace-only → null', () => {
    expect(sanitiseTitle('')).toBeNull();
    expect(sanitiseTitle('   ')).toBeNull();
  });
});

describe('fallbackTitle', () => {
  it('formats as "New chat — D MMM, HH:mm" British convention', () => {
    const ts = new Date('2026-05-24T18:06:00').getTime();
    expect(fallbackTitle(ts)).toBe('New chat — 24 May, 18:06');
  });
  it('pads minutes with leading zero', () => {
    const ts = new Date('2026-05-24T09:05:00').getTime();
    expect(fallbackTitle(ts)).toBe('New chat — 24 May, 09:05');
  });
});

async function seed() {
  const db = await openClientDataDb();
  const personaId = uuidv7();
  const firstOffering = nanoGpt.offerings[0];
  if (!firstOffering) throw new Error('nano-gpt has no offerings');
  const offering = getOffering('nano-gpt', firstOffering.upstreamSlug);
  if (!offering) throw new Error(`no offering for nano-gpt / ${firstOffering.upstreamSlug}`);
  await db.personas.add({
    id: personaId,
    name: 'Aurum',
    tagline: '',
    colour: '#c9a84c',
    font: 'serif',
    instructions: 'inst',
    canonicalId: null,
    providerId: 'pr',
    modelId: firstOffering.upstreamSlug,
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
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
    createdAt: 1,
    updatedAt: 1,
  });
  await db.providers.add({
    id: 'pr',
    templateId: 'nano-gpt',
    displayName: 'nano-gpt',
    baseUrl: nanoGpt.baseUrl,
    apiKey: { iv: new Uint8Array(), ciphertext: new Uint8Array() } as never,
    routing: { kind: 'direct' },
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  });
  const chatId = uuidv7();
  await db.chats.add({
    id: chatId,
    personaId,
    title: null,
    resolvedMindspaceId: 'm1',
    createdAt: 1717000000000,
    updatedAt: 1717000000000,
    lastMessageAt: 1717000000000,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: [],
  });
  const chat = (await db.chats.get(chatId)) as ChatRow;
  const persona = (await db.personas.get(personaId)) as PersonaRow;
  const provider = nanoGpt;
  const providerConfig = { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' as const } };
  return { db, chatId, personaId, chat, persona, provider, providerConfig, offering };
}

describe('generateTitleAsync', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
  });
  afterEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
    vi.restoreAllMocks();
  });

  it('success path writes sanitised title', async () => {
    const { db, chatId, offering } = await seed();
    const oneShotSpy = vi
      .spyOn(llm, 'runOneShotCompletion')
      .mockResolvedValue(' "Aurum and Chris on textures" ');
    const chat = (await db.chats.get(chatId)) as ChatRow;
    const persona = (await db.personas.get(chat.personaId)) as PersonaRow;
    const provider = await db.providers.get(persona.providerId);
    if (!provider) throw new Error('no provider');
    await generateTitleAsync({
      chat,
      persona,
      provider: nanoGpt,
      providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
      apiKey: 'k',
      offering,
      firstUserMessage: 'tell me about textures',
      firstPersonaResponse: 'There are three options...',
      globalInstructions: 'UNLOCK',
      globalAboutMe: 'I am Chris.',
    });
    const updated = await db.chats.get(chatId);
    expect(updated?.title).toBe('Aurum and Chris on textures');

    // verify globalInstructions IS in the system prompt passed to runOneShotCompletion.
    // Note: aboutMe is a band-2 (CHAT_ONLY) segment and is intentionally absent
    // from title-job prompts — only band-1 segments (tonality, nsfw, global,
    // persona) appear in the title job.
    const callArgs = oneShotSpy.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const sysMsg = callArgs.messages.find((m) => m.role === 'system');
    expect(sysMsg?.content).toContain('UNLOCK');
    expect(sysMsg?.content).not.toContain('I am Chris.');
  });

  it('error path writes fallback title', async () => {
    const { db, chatId, offering } = await seed();
    vi.spyOn(llm, 'runOneShotCompletion').mockRejectedValue(new Error('500'));
    const chat = (await db.chats.get(chatId)) as ChatRow;
    const persona = (await db.personas.get(chat.personaId)) as PersonaRow;
    await generateTitleAsync({
      chat,
      persona,
      provider: nanoGpt,
      providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
      apiKey: 'k',
      offering,
      firstUserMessage: 'x',
      firstPersonaResponse: 'y',
      globalInstructions: '',
      globalAboutMe: '',
    });
    const updated = await db.chats.get(chatId);
    expect(updated?.title).toMatch(/^New chat — \d{1,2} \w{3}, \d{2}:\d{2}$/);
  });

  it('empty-content result falls back', async () => {
    const { db, chatId, offering } = await seed();
    vi.spyOn(llm, 'runOneShotCompletion').mockResolvedValue('   ');
    const chat = (await db.chats.get(chatId)) as ChatRow;
    const persona = (await db.personas.get(chat.personaId)) as PersonaRow;
    await generateTitleAsync({
      chat,
      persona,
      provider: nanoGpt,
      providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
      apiKey: 'k',
      offering,
      firstUserMessage: 'x',
      firstPersonaResponse: 'y',
      globalInstructions: '',
      globalAboutMe: '',
    });
    const updated = await db.chats.get(chatId);
    expect(updated?.title).toMatch(/^New chat — /);
  });
});

describe('TITLE_INSTRUCTION', () => {
  it('does not contain any unconditional NSFW clause', () => {
    expect(TITLE_INSTRUCTION).not.toMatch(/fully uncensored/i);
    expect(TITLE_INSTRUCTION).not.toMatch(/do not censor/i);
  });
  it('asks the model to use the conversation language (not forced EN)', () => {
    expect(TITLE_INSTRUCTION).toMatch(/language of the conversation/i);
    expect(TITLE_INSTRUCTION).not.toMatch(/British English/i);
  });
  it('caps the title at 60 characters in the instruction text', () => {
    expect(TITLE_INSTRUCTION).toMatch(/60/);
  });
});

describe('generateTitleAsync race-guard', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips the title write when the chat was manually titled mid-call', async () => {
    const { chat, persona, provider, providerConfig, offering, db } = await seed();
    let release!: (s: string) => void;
    const blocker = new Promise<string>((resolve) => {
      release = resolve;
    });
    vi.spyOn(llm, 'runOneShotCompletion').mockReturnValue(blocker as unknown as Promise<string>);

    const inFlight = generateTitleAsync({
      chat,
      persona,
      provider,
      providerConfig,
      apiKey: 'k',
      offering,
      firstUserMessage: 'hi',
      firstPersonaResponse: 'hello',
      globalInstructions: 'unlock',
      globalAboutMe: '',
    });

    // While the LLM call is in flight, the user manually titles the chat.
    await db.chats.update(chat.id, { title: 'manual' });

    // Now let the LLM return.
    release('AI generated');
    await inFlight;

    const after = await db.chats.get(chat.id);
    expect(after?.title).toBe('manual');
  });

  it('skips the fallback write when the chat was manually titled before failure', async () => {
    const { chat, persona, provider, providerConfig, offering, db } = await seed();
    let reject!: (err: Error) => void;
    const blocker = new Promise<string>((_resolve, rej) => {
      reject = rej;
    });
    vi.spyOn(llm, 'runOneShotCompletion').mockReturnValue(blocker as unknown as Promise<string>);

    const inFlight = generateTitleAsync({
      chat,
      persona,
      provider,
      providerConfig,
      apiKey: 'k',
      offering,
      firstUserMessage: 'hi',
      firstPersonaResponse: 'hello',
      globalInstructions: 'unlock',
      globalAboutMe: '',
    });

    await db.chats.update(chat.id, { title: 'manual' });
    reject(new Error('boom'));
    await inFlight;

    const after = await db.chats.get(chat.id);
    expect(after?.title).toBe('manual');
  });
});

describe('generateTitleAsync invalidates TanStack queries', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('invalidates QK.chat(id) and QK.chats on the success path', async () => {
    const { chat, persona, provider, providerConfig, offering } = await seed();
    vi.spyOn(llm, 'runOneShotCompletion').mockResolvedValue('AI title');

    const { queryClient } = await import('../../src/lib/queryClient');
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    await generateTitleAsync({
      chat,
      persona,
      provider,
      providerConfig,
      apiKey: 'k',
      offering,
      firstUserMessage: 'hi',
      firstPersonaResponse: 'hello',
      globalInstructions: 'unlock',
      globalAboutMe: '',
    });

    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(['chats', chat.id]);
    expect(keys).toContainEqual(['chats']);
  });

  it('invalidates on the fallback path too', async () => {
    const { chat, persona, provider, providerConfig, offering } = await seed();
    vi.spyOn(llm, 'runOneShotCompletion').mockRejectedValue(new Error('boom'));

    const { queryClient } = await import('../../src/lib/queryClient');
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    await generateTitleAsync({
      chat,
      persona,
      provider,
      providerConfig,
      apiKey: 'k',
      offering,
      firstUserMessage: 'hi',
      firstPersonaResponse: 'hello',
      globalInstructions: 'unlock',
      globalAboutMe: '',
    });

    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(['chats', chat.id]);
    expect(keys).toContainEqual(['chats']);
  });
});
