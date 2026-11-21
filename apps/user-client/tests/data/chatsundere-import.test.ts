// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// enqueueDocument must not be called during persona import
const enqueueSpy = vi.fn();
vi.mock('../../src/knowledge/start-ingestion.js', () => ({
  enqueueDocument: (id: string) => enqueueSpy(id),
}));

import {
  type ArtefactRow,
  type ChatRow,
  type CompactionCheckpointRow,
  type MessageRow,
  type PillRow,
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { exportPersona } from '../../src/data/chatsundere-export.js';
import { importPersonaPack } from '../../src/data/chatsundere-import.js';

describe('persona export → import round-trip', () => {
  beforeEach(async () => {
    enqueueSpy.mockClear();
    await _resetClientDataDbForTests();
    await openClientDataDb();
    const db = getClientDataDb();
    // Persona with non-empty mcpOverrides and libraryIds so droppedBindings is exercised.
    // Use '' for providerId/modelId — Dexie.get(undefined) throws; get('') returns undefined.
    await db.personas.add({
      id: 'p1',
      name: 'Fable',
      providerId: '',
      modelId: '',
      mcpOverrides: { 'srv-1': true },
      libraryIds: ['lib-x'],
      useMemory: true,
    } as never);
    await db.chats.add({
      id: 'c1',
      personaId: 'p1',
      title: 't',
      createdAt: 1,
      lastMessageAt: 2,
    } as never);
    await db.messages.add({
      id: 'm1',
      chatId: 'c1',
      role: 'persona',
      contentBlocks: [
        { type: 'text', text: 'hi' },
        { type: 'reasoning', text: 'why' },
      ],
      createdAt: 1,
    } as never);
  });

  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('creates a new persona with fresh ids and preserved content blocks including reasoning', async () => {
    const blob = await exportPersona('p1', { memory: true, artefacts: true, images: false });
    const res = await importPersonaPack(blob, 'Fable (copy)');
    const db = getClientDataDb();

    expect(res.personaId).not.toBe('p1');
    const persona = await db.personas.get(res.personaId);
    expect(persona?.name).toBe('Fable (copy)');

    const chats = await db.chats.where('personaId').equals(res.personaId).toArray();
    expect(chats).toHaveLength(1);
    expect(chats[0]?.id).not.toBe('c1');

    const chatId = chats[0]?.id ?? '';
    const msgs = await db.messages.where('chatId').equals(chatId).toArray();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.contentBlocks).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'reasoning', text: 'why' },
    ]);
  });

  it('degrades live bindings and reports it', async () => {
    const blob = await exportPersona('p1', { memory: true, artefacts: true, images: false });
    const res = await importPersonaPack(blob, 'Fable (copy)');
    const persona = await getClientDataDb().personas.get(res.personaId);

    expect(persona?.mcpOverrides).toEqual({});
    expect(persona?.libraryIds).toEqual([]);
    expect(res.modelBound).toBe(false);
    expect(res.droppedBindings).toBe(true);
  });

  it('never calls enqueueDocument during persona import', async () => {
    const blob = await exportPersona('p1', { memory: true, artefacts: true, images: false });
    await importPersonaPack(blob, 'Fable (copy)');
    expect(enqueueSpy).not.toHaveBeenCalled();
  });
});

describe('persona import — model resolution', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    const db = getClientDataDb();
    await db.providers.add({
      id: 'prov-1',
      templateId: 'mistral',
      displayName: 'Mistral',
      baseUrl: '',
      apiKey: { ciphertext: new Uint8Array([1]), nonce: new Uint8Array([2]), version: 1 },
      routing: { kind: 'direct' },
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    });
    await db.personas.add({
      id: 'p2',
      name: 'Sparks',
      providerId: 'prov-1',
      modelId: 'mistral-small',
      mcpOverrides: {},
      libraryIds: [],
    } as never);
    await db.chats.add({
      id: 'c2',
      personaId: 'p2',
      title: null,
      createdAt: 1,
      lastMessageAt: 1,
    } as never);
  });

  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('resolves modelRef to a local provider and sets modelBound = true', async () => {
    const blob = await exportPersona('p2', { memory: false, artefacts: false, images: false });
    const res = await importPersonaPack(blob, 'Sparks (imported)');
    expect(res.modelBound).toBe(true);
    const persona = await getClientDataDb().personas.get(res.personaId);
    expect(persona?.providerId).toBe('prov-1');
    expect(persona?.modelId).toBe('mistral-small');
  });
});

describe('persona import — cursor remapping (C1/C2 regression)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    const db = getClientDataDb();

    await db.personas.add({
      id: 'p-cursor',
      name: 'Cursor Test',
      providerId: '',
      modelId: '',
      mcpOverrides: {},
      libraryIds: [],
    } as never);

    // Seed the message that will become lastExtractedMessageId on the chat.
    await db.messages.add({
      id: 'msg-cursor',
      chatId: 'chat-cursor',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'hello' }],
      createdAt: 10,
      updatedAt: 10,
      bookmarked: false,
      streamingState: 'complete',
    } satisfies MessageRow);

    // Seed the checkpoint that will become activeCompactionId on the chat.
    await db.compactionCheckpoints.add({
      id: 'cp-cursor',
      chatId: 'chat-cursor',
      createdAt: 20,
      modelId: 'test-model',
      summaryMarkdown: 'compacted portion summary',
      lastMessageIdBefore: 'msg-cursor',
      tailStartMessageId: 'msg-cursor',
      tokensBefore: 100,
      tokensAfter: 50,
      tailTokenCount: 30,
      prevCheckpointId: null,
      trigger: 'manual',
    } satisfies CompactionCheckpointRow);

    // Seed a chat whose cursor fields reference the rows above.
    await db.chats.add({
      id: 'chat-cursor',
      personaId: 'p-cursor',
      title: 'cursor chat',
      createdAt: 1,
      updatedAt: 1,
      lastMessageAt: 2,
      resolvedMindspaceId: '',
      libraryIds: [],
      draftInput: '',
      bookmarkedMessageCount: 0,
      activeCompactionId: 'cp-cursor',
      lastExtractedMessageId: 'msg-cursor',
    } satisfies ChatRow);
  });

  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('remaps activeCompactionId and lastExtractedMessageId to fresh ids on import', async () => {
    const blob = await exportPersona('p-cursor', {
      memory: false,
      artefacts: false,
      images: false,
    });
    const res = await importPersonaPack(blob, 'Cursor Test (imported)');
    const db = getClientDataDb();

    const chats = await db.chats.where('personaId').equals(res.personaId).toArray();
    expect(chats).toHaveLength(1);
    const chat = chats[0];
    expect(chat).toBeDefined();
    if (!chat) return;

    // Cursor ids must be remapped to fresh ids — never the originals.
    expect(chat.activeCompactionId).not.toBeNull();
    expect(chat.activeCompactionId).not.toBe('cp-cursor');
    expect(chat.lastExtractedMessageId).not.toBeNull();
    expect(chat.lastExtractedMessageId).not.toBe('msg-cursor');

    // The checkpoint must exist under the new id and belong to the imported chat.
    const newCpId = chat.activeCompactionId ?? '';
    const checkpoint = await db.compactionCheckpoints.get(newCpId);
    expect(checkpoint).toBeDefined();
    expect(checkpoint?.chatId).toBe(chat.id);

    // The message must exist under the new id and belong to the imported chat.
    const newMsgId = chat.lastExtractedMessageId ?? '';
    const message = await db.messages.get(newMsgId);
    expect(message).toBeDefined();
    expect(message?.chatId).toBe(chat.id);
  });
});

describe('persona import — nested pillId / artefact-ref remapping (C1+I1 regression)', () => {
  beforeEach(async () => {
    enqueueSpy.mockClear();
    await _resetClientDataDbForTests();
    await openClientDataDb();
    const db = getClientDataDb();

    await db.personas.add({
      id: 'p-pill',
      name: 'Pill Test',
      providerId: '',
      modelId: '',
      mcpOverrides: {},
      libraryIds: [],
    } as never);

    await db.chats.add({
      id: 'c-pill',
      personaId: 'p-pill',
      title: 'pill chat',
      createdAt: 1,
      updatedAt: 1,
      lastMessageAt: 2,
      resolvedMindspaceId: '',
      libraryIds: [],
      draftInput: '',
      bookmarkedMessageCount: 0,
    } satisfies ChatRow);

    await db.messages.add({
      id: 'm-pill',
      chatId: 'c-pill',
      role: 'persona',
      contentBlocks: [{ type: 'pill', pillId: 'pill-orig-1' }],
      createdAt: 1,
      updatedAt: 1,
      bookmarked: false,
      streamingState: 'complete',
    } satisfies MessageRow);

    await db.pills.add({
      id: 'pill-orig-1',
      messageId: 'm-pill',
      kind: 'tool-call',
      positionHint: 'inline',
      status: 'completed',
      payload: { artefactId: 'art-orig-1' },
      createdAt: 1,
    } satisfies PillRow);

    await db.artefacts.add({
      id: 'art-orig-1',
      chatId: 'c-pill',
      personaId: 'p-pill',
      projectId: null,
      origin: 'generated',
      kind: 'text',
      format: 'html',
      title: 'Test Artefact',
      fileName: 'test.html',
      mime: 'text/html',
      content: '<p>Hello</p>',
      tags: [],
      favourite: false,
      createdAt: 1,
      updatedAt: 1,
    } satisfies ArtefactRow);
  });

  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('remaps nested pillId in contentBlocks and artefactId in pill payload to fresh ids', async () => {
    const blob = await exportPersona('p-pill', { memory: false, artefacts: true, images: false });
    const res = await importPersonaPack(blob, 'Pill Test (imported)');
    const db = getClientDataDb();

    // Locate the imported chat and its message.
    const chats = await db.chats.where('personaId').equals(res.personaId).toArray();
    expect(chats).toHaveLength(1);
    const chat = chats[0];
    expect(chat).toBeDefined();
    if (!chat) return;

    const msgs = await db.messages.where('chatId').equals(chat.id).toArray();
    expect(msgs).toHaveLength(1);
    const msg = msgs[0];
    expect(msg).toBeDefined();
    if (!msg) return;

    // (a) The pill content-block's pillId must be remapped to a fresh id.
    const pillBlock = msg.contentBlocks.find((b) => b.type === 'pill');
    expect(pillBlock).toBeDefined();
    if (!pillBlock || pillBlock.type !== 'pill') return;
    const newPillId = pillBlock.pillId;
    expect(newPillId).not.toBe('pill-orig-1');

    // (b) A pill row must exist under the new id.
    const pill = await db.pills.get(newPillId);
    expect(pill).toBeDefined();
    if (!pill) return;

    // (c) The pill's payload.artefactId must be remapped to a fresh id.
    const payload = pill.payload as { artefactId?: string };
    expect(payload.artefactId).toBeDefined();
    expect(payload.artefactId).not.toBe('art-orig-1');
    const newArtefactId = payload.artefactId ?? '';

    // (d) The artefact must exist under the new id.
    const artefact = await db.artefacts.get(newArtefactId);
    expect(artefact).toBeDefined();
  });
});

describe('persona export → import round-trip — audio and video artefacts', () => {
  const audioBytes = new Uint8Array([0x49, 0x44, 0x33, 4, 5, 6]);
  const videoBytes = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]);
  const posterBytes = new Uint8Array([0xff, 0xd8, 0xff, 9]);

  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    const db = getClientDataDb();
    await db.personas.add({
      id: 'p-media',
      name: 'Media',
      providerId: '',
      modelId: '',
      mcpOverrides: {},
      libraryIds: [],
    } as never);
    await db.chats.add({
      id: 'c-media',
      personaId: 'p-media',
      title: 'media chat',
      createdAt: 1,
      updatedAt: 1,
      lastMessageAt: 2,
      resolvedMindspaceId: '',
      libraryIds: [],
      draftInput: '',
      bookmarkedMessageCount: 0,
    } satisfies ChatRow);
    await db.messages.add({
      id: 'm-media',
      chatId: 'c-media',
      role: 'persona',
      contentBlocks: [{ type: 'pill', pillId: 'pill-media' }],
      createdAt: 1,
      updatedAt: 1,
      bookmarked: false,
      streamingState: 'complete',
    } satisfies MessageRow);
    await db.pills.add({
      id: 'pill-media',
      messageId: 'm-media',
      kind: 'tool-call',
      positionHint: 'inline',
      status: 'completed',
      payload: {
        name: 'elevenlabs_creative_generate_speech',
        result: 'ok',
        media: [
          {
            key: 'gen:a',
            kind: 'audio',
            mime: 'audio/mpeg',
            title: 'Audio 1',
            status: 'saved',
            artefactId: 'au-orig',
          },
          {
            key: 'gen:v',
            kind: 'video',
            mime: 'video/mp4',
            title: 'Video 1',
            status: 'saved',
            artefactId: 'vi-orig',
          },
        ],
      },
      createdAt: 1,
    } satisfies PillRow);
    const base = {
      chatId: 'c-media',
      personaId: 'p-media',
      projectId: null,
      origin: 'generated' as const,
      content: '',
      tags: ['tune'],
      favourite: true,
      createdAt: 1,
      updatedAt: 1,
    };
    await db.artefacts.add({
      ...base,
      id: 'au-orig',
      kind: 'audio',
      format: 'audio',
      title: 'Theme song',
      fileName: 'theme-song.mp3',
      mime: 'audio/mpeg',
      blob: new Blob([audioBytes], { type: 'audio/mpeg' }),
      mediaMeta: { key: 'gen:a', durationMs: 46_000, serverName: 'ElevenLabs', toolName: 'tts' },
    } satisfies ArtefactRow);
    await db.artefacts.add({
      ...base,
      id: 'vi-orig',
      kind: 'video',
      format: 'video',
      title: 'Clip',
      fileName: 'clip.mp4',
      mime: 'video/mp4',
      blob: new Blob([videoBytes], { type: 'video/mp4' }),
      thumbBlob: new Blob([posterBytes], { type: 'image/jpeg' }),
      mediaMeta: { key: 'gen:v', durationMs: 5_000, serverName: 'ElevenLabs', toolName: 'video' },
    } satisfies ArtefactRow);
  });

  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  async function bytesOf(b: Blob | undefined): Promise<number[]> {
    return b ? [...new Uint8Array(await b.arrayBuffer())] : [];
  }

  it('carries the bytes, the poster, the mime and the media provenance, and keeps the card pointing at them', async () => {
    const blob = await exportPersona('p-media', { memory: false, artefacts: true, images: true });
    const res = await importPersonaPack(blob, 'Media (copy)');
    const db = getClientDataDb();
    const chats = await db.chats.where('personaId').equals(res.personaId).toArray();
    const chatId = chats[0]?.id ?? '';
    const rows = await db.artefacts.where('chatId').equals(chatId).toArray();
    const audio = rows.find((r) => r.kind === 'audio');
    const video = rows.find((r) => r.kind === 'video');

    expect(audio?.id).not.toBe('au-orig');
    expect(audio?.format).toBe('audio');
    expect(audio?.mime).toBe('audio/mpeg');
    expect(audio?.blob?.type).toBe('audio/mpeg');
    expect(await bytesOf(audio?.blob)).toEqual([...audioBytes]);
    expect(audio?.mediaMeta).toEqual({
      key: 'gen:a',
      durationMs: 46_000,
      serverName: 'ElevenLabs',
      toolName: 'tts',
    });
    expect(audio?.tags).toEqual(['tune']);

    expect(video?.blob?.type).toBe('video/mp4');
    expect(await bytesOf(video?.blob)).toEqual([...videoBytes]);
    expect(video?.thumbBlob?.type).toBe('image/jpeg');
    expect(await bytesOf(video?.thumbBlob)).toEqual([...posterBytes]);

    // The media card's saved items must resolve to the imported rows.
    const msgs = await db.messages.where('chatId').equals(chatId).toArray();
    const block = msgs[0]?.contentBlocks.find((b) => b.type === 'pill');
    const pillId = block && block.type === 'pill' ? block.pillId : '';
    const pill = await db.pills.get(pillId);
    const media = (pill?.payload as { media: { artefactId?: string }[] }).media;
    expect(media.map((m) => m.artefactId)).toEqual([audio?.id, video?.id]);
  });

  it('leaves audio and video behind with the images when images are off', async () => {
    const blob = await exportPersona('p-media', { memory: false, artefacts: true, images: false });
    const res = await importPersonaPack(blob, 'Media (copy)');
    const db = getClientDataDb();
    const chats = await db.chats.where('personaId').equals(res.personaId).toArray();
    const rows = await db.artefacts
      .where('chatId')
      .equals(chats[0]?.id ?? '')
      .toArray();
    expect(rows).toHaveLength(0);
  });
});
