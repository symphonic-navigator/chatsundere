import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import * as llm from '@chatsundere/llm-unified';
import { uuidv7 } from 'uuidv7';
import { nanoGpt } from '../../../../packages/llm-unified/src/providers/nano-gpt';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';
import type { ChatRow, PersonaRow } from '../../src/boot/client-data-db';
import { fallbackTitle, generateTitleAsync, sanitiseTitle } from '../../src/lib/title-generator';

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
  const model = nanoGpt.knownModels[0];
  if (!model) throw new Error('no model');
  await db.personas.add({
    id: personaId,
    name: 'Aurum',
    tagline: '',
    colour: '#c9a84c',
    font: 'serif',
    instructions: 'inst',
    providerId: 'pr',
    modelId: model.id,
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: false,
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
    lastMessageAt: 1717000000000,
    bookmarkedMessageCount: 0,
    draftInput: '',
  });
  return { db, chatId, personaId };
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
    const { db, chatId } = await seed();
    const oneShotSpy = vi
      .spyOn(llm, 'runOneShotCompletion')
      .mockResolvedValue(' "Aurum and Chris on textures" ');
    const chat = (await db.chats.get(chatId)) as ChatRow;
    const persona = (await db.personas.get(chat.personaId)) as PersonaRow;
    const provider = await db.providers.get(persona.providerId);
    if (!provider) throw new Error('no provider');
    const model = nanoGpt.knownModels[0];
    if (!model) throw new Error('no model');
    await generateTitleAsync({
      chat,
      persona,
      provider: nanoGpt,
      providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      model,
      firstUserMessage: 'tell me about textures',
      firstPersonaResponse: 'There are three options...',
      globalUnlocker: 'UNLOCK',
      globalAboutMe: 'I am Chris.',
    });
    const updated = await db.chats.get(chatId);
    expect(updated?.title).toBe('Aurum and Chris on textures');

    // verify globalUnlocker IS in the system prompt passed to runOneShotCompletion
    const callArgs = oneShotSpy.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const sysMsg = callArgs.messages.find((m) => m.role === 'system');
    expect(sysMsg?.content).toContain('UNLOCK');
    expect(sysMsg?.content).toContain('I am Chris.');
  });

  it('error path writes fallback title', async () => {
    const { db, chatId } = await seed();
    vi.spyOn(llm, 'runOneShotCompletion').mockRejectedValue(new Error('500'));
    const chat = (await db.chats.get(chatId)) as ChatRow;
    const persona = (await db.personas.get(chat.personaId)) as PersonaRow;
    const model = nanoGpt.knownModels[0];
    if (!model) throw new Error('no model');
    await generateTitleAsync({
      chat,
      persona,
      provider: nanoGpt,
      providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      model,
      firstUserMessage: 'x',
      firstPersonaResponse: 'y',
      globalUnlocker: '',
      globalAboutMe: '',
    });
    const updated = await db.chats.get(chatId);
    expect(updated?.title).toMatch(/^New chat — \d{1,2} \w{3}, \d{2}:\d{2}$/);
  });

  it('empty-content result falls back', async () => {
    const { db, chatId } = await seed();
    vi.spyOn(llm, 'runOneShotCompletion').mockResolvedValue('   ');
    const chat = (await db.chats.get(chatId)) as ChatRow;
    const persona = (await db.personas.get(chat.personaId)) as PersonaRow;
    const model = nanoGpt.knownModels[0];
    if (!model) throw new Error('no model');
    await generateTitleAsync({
      chat,
      persona,
      provider: nanoGpt,
      providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      model,
      firstUserMessage: 'x',
      firstPersonaResponse: 'y',
      globalUnlocker: '',
      globalAboutMe: '',
    });
    const updated = await db.chats.get(chatId);
    expect(updated?.title).toMatch(/^New chat — /);
  });
});
