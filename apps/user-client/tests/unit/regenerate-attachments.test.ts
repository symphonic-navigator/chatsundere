// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import * as llmUnified from '../../../../packages/llm-unified/src/index';
import { nanoGpt } from '../../../../packages/llm-unified/src/providers/nano-gpt';
import * as resolveSend from '../../src/attachments/resolve-send';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';
import * as engine from '../../src/lib/stream-engine';
import { useStreamManagerStore } from '../../src/state/stream-manager.store';

// Lives in its own file (not stream-manager-store.test.ts) on purpose: that
// suite carries a documented 'c1'-shared-handle race between its early live-
// buffer tests, and adding one more slow test there nudged the suite timing
// enough to surface that latent race. Kept isolated so the regenerate-image
// contract is verified without perturbing the fragile sibling.

async function seedPersonaAndProvider() {
  const db = await openClientDataDb();
  const personaId = 'p1';
  await db.personas.add({
    id: personaId,
    name: 'Aurum',
    tagline: '',
    colour: '#c9a84c',
    font: 'serif',
    instructions: 'You are Aurum.',
    canonicalId: null,
    providerId: 'pr1',
    modelId: nanoGpt.offerings[0]?.upstreamSlug ?? '',
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
    id: 'pr1',
    templateId: 'nano-gpt',
    displayName: 'nano-gpt',
    baseUrl: nanoGpt.baseUrl,
    apiKey: { iv: new Uint8Array(), ciphertext: new Uint8Array() } as never,
    routing: { kind: 'direct' },
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  });
  return { db, personaId };
}

describe('regenerate re-injects the replayed user turn’s attachments (spec §9)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
  });
  afterEach(async () => {
    await _resetClientDataDbForTests({ keepData: false });
    vi.restoreAllMocks();
    useStreamManagerStore.setState({ streams: new Map() });
  });

  it('carries the bound image on a re-roll (edit-replace / plain regenerate)', async () => {
    // Contract (Bug 2 fix): a re-roll must replay the prior user turn's bound
    // attachments, not just its text. Here the active model has no vision and a
    // substitute is set, so resolving the turn's image fires a describe_image
    // pill — its presence on the re-rolled message proves the image was carried.
    const { db, personaId } = await seedPersonaAndProvider();
    const persona = await db.personas.get(personaId);
    const baseModel = nanoGpt.offerings[0];
    const chatId = 'c-regen-image';
    await db.chats.add({
      id: chatId,
      personaId,
      title: 'kept',
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      updatedAt: 1,
      lastMessageAt: 3,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });

    // A user turn whose image attachment is already BOUND (messageId set), plus
    // the persona reply we will re-roll.
    const userMsgId = 'u-regen';
    await db.messages.add({
      id: userMsgId,
      chatId,
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'what is this?' }],
      createdAt: 2,
      updatedAt: 2,
      bookmarked: false,
      streamingState: 'complete',
    });
    const replyId = 'r-regen';
    await db.messages.add({
      id: replyId,
      chatId,
      role: 'persona',
      contentBlocks: [{ type: 'text', text: 'stale answer' }],
      createdAt: 3,
      updatedAt: 3,
      bookmarked: false,
      streamingState: 'complete',
    });
    await db.attachments.add({
      id: 'att-regen-1',
      chatId,
      messageId: userMsgId,
      origin: 'upload',
      kind: 'image',
      fileName: 'photo.jpg',
      mime: 'image/jpeg',
      order: 0,
      state: 'active',
      blob: new Blob(['x'], { type: 'image/jpeg' }),
      createdAt: 2,
      updatedAt: 2,
    });

    // Active model: vision=false; substitute ref: vision=true.
    const activeModel = {
      ...(baseModel as object),
      profile: { toolCalls: { supported: false }, vision: false },
    };
    const substituteRef = 'nano-gpt:gpt-4o-mini';
    vi.spyOn(llmUnified, 'getOffering').mockImplementation((_providerId, slug) => {
      if (slug === 'gpt-4o-mini') {
        return {
          ...(baseModel as object),
          profile: { vision: true, toolCalls: { supported: false } },
        } as never;
      }
      return {
        ...(baseModel as object),
        profile: { vision: false, toolCalls: { supported: false } },
      } as never;
    });
    const partsSpy = vi
      .spyOn(resolveSend, 'resolveAttachmentParts')
      .mockImplementation(async (_atts, _disposition, _sub, deps) => {
        const fakeAtt = { id: 'att-regen-1', fileName: 'photo.jpg', kind: 'image' } as never;
        deps.onDescribeStart?.(fakeAtt);
        deps.onDescribeEnd?.(fakeAtt, { ok: true as const, text: 'A photo of a cat.' });
        return [
          {
            kind: 'image-description' as const,
            fileName: 'photo.jpg',
            model: substituteRef,
            description: 'A photo of a cat.',
          },
        ];
      });

    vi.spyOn(engine, 'runStreamEngine').mockResolvedValue({
      finalContentBlocks: [{ type: 'text', text: 'A cat!' }],
      pillRows: [],
      finishReason: 'stop',
      usedTokens: 0,
    });

    await useStreamManagerStore.getState().regenerate({
      chatId,
      userText: 'what is this?',
      chat: {
        id: chatId,
        personaId,
        title: 'kept',
        resolvedMindspaceId: 'm1',
        createdAt: 1,
        lastMessageAt: 3,
        bookmarkedMessageCount: 0,
        draftInput: '',
        libraryIds: [],
      },
      persona,
      provider: nanoGpt,
      providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' as const } },
      apiKey: 'k',
      offering: activeModel,
      priorMessages: [],
      userMessageText: 'what is this?',
      reasoning: { kind: 'on' as const },
      globalInstructions: '',
      globalAboutMe: '',
      targetMessageId: replyId,
      userMessageId: userMsgId,
      substituteVisionModel: substituteRef,
      substituteOneShotBase: {
        provider: nanoGpt,
        providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' as const } },
        apiKey: 'k',
        target: { slug: 'gpt-4o-mini', bodyExtras: {} },
      },
    } as never);

    // Wait deterministically for the async runIntoDraft resolution + then-chain
    // (polling beats a fixed sleep, which flakes under full-suite load).
    for (let i = 0; i < 100; i++) {
      const r = await db.messages.get(replyId);
      if (r?.streamingState === 'complete') break;
      await new Promise((res) => setTimeout(res, 10));
    }

    // The bound attachment was resolved (not skipped) on the re-roll.
    expect(partsSpy).toHaveBeenCalledTimes(1);

    const pills = await db.pills.toArray();
    const describePill = pills.find(
      (p) => p.kind === 'tool-call' && (p.payload as { name?: string }).name === 'describe_image',
    );
    expect(describePill).toBeDefined();
    expect(describePill?.status).toBe('completed');

    // The re-rolled persona message references the describe_image pill.
    const reply = await db.messages.get(replyId);
    expect(reply?.streamingState).toBe('complete');
    expect(
      reply?.contentBlocks.some((b) => b.type === 'pill' && b.pillId === describePill?.id),
    ).toBe(true);
  });
});
