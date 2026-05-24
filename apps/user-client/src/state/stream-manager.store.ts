// SPDX-License-Identifier: AGPL-3.0-only
import { uuidv7 } from 'uuidv7';
import { create } from 'zustand';
import { type ContentBlock, type PillRow, getClientDataDb } from '../boot/client-data-db.js';
import { type StartStreamArgs, runStreamEngine } from '../lib/stream-engine.js';
import { generateTitleAsync } from '../lib/title-generator.js';

export interface StreamHandle {
  chatId: string;
  personaId: string;
  draftMessageId: string;
  controller: AbortController;
  status: 'streaming' | 'finalising' | 'done' | 'error';
  contentBuffer: ContentBlock[];
  pillBuffer: PillRow[];
  startedAt: number;
}

type StartArgs = Omit<StartStreamArgs, 'signal' | 'onChunk'> & {
  chatId: string;
  userText: string;
};

interface StreamManagerStore {
  streams: Map<string, StreamHandle>;
  start: (args: StartArgs) => Promise<void>;
  abortDiscard: (chatId: string) => Promise<void>;
  abortAllForPersonaDiscard: (personaId: string) => Promise<void>;
  has: (chatId: string) => boolean;
  getDraftMessage: (chatId: string) => { id: string; contentBlocks: ContentBlock[] } | null;
}

async function fireTitleGen(args: StartArgs, finalContentBlocks: ContentBlock[]): Promise<void> {
  const firstPersonaResponse = finalContentBlocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
  try {
    await generateTitleAsync({
      chat: args.chat,
      persona: args.persona,
      provider: args.provider,
      providerConfig: args.providerConfig,
      apiKey: args.apiKey,
      corsProxyUrl: args.corsProxyUrl,
      corsProxyKey: args.corsProxyKey,
      model: args.model,
      firstUserMessage: args.userText,
      firstPersonaResponse,
      globalUnlocker: args.globalUnlocker,
      globalAboutMe: args.globalAboutMe,
    });
  } catch {
    // generateTitleAsync handles its own errors → fallback title.
  }
}

export const useStreamManagerStore = create<StreamManagerStore>((set, get) => ({
  streams: new Map(),

  has: (chatId) => get().streams.has(chatId),

  getDraftMessage: (chatId) => {
    const h = get().streams.get(chatId);
    return h ? { id: h.draftMessageId, contentBlocks: h.contentBuffer } : null;
  },

  start: async (args) => {
    const db = getClientDataDb();
    const now = Date.now();
    const userMessageId = uuidv7();
    const draftMessageId = uuidv7();

    await db.transaction('rw', db.messages, db.chats, async () => {
      await db.messages.add({
        id: userMessageId,
        chatId: args.chatId,
        role: 'user',
        contentBlocks: [{ type: 'text', text: args.userText }],
        createdAt: now,
        bookmarked: false,
        streamingState: 'complete',
      });
      await db.messages.add({
        id: draftMessageId,
        chatId: args.chatId,
        role: 'persona',
        contentBlocks: [],
        createdAt: now + 1,
        bookmarked: false,
        streamingState: 'incomplete',
      });
      await db.chats.update(args.chatId, { lastMessageAt: now + 1, draftInput: '' });
    });

    const controller = new AbortController();
    const handle: StreamHandle = {
      chatId: args.chatId,
      personaId: args.persona.id,
      draftMessageId,
      controller,
      status: 'streaming',
      contentBuffer: [],
      pillBuffer: [],
      startedAt: now,
    };

    set((s) => {
      const m = new Map(s.streams);
      m.set(args.chatId, handle);
      return { streams: m };
    });

    runStreamEngine({
      ...args,
      signal: controller.signal,
      onChunk: () => {
        // Live mirroring into handle.contentBuffer is deferred to Phase-3.2
        // (ChatStream live-subscription wire-up). The engine accumulates its
        // own buffer and returns it in finalContentBlocks on resolve.
      },
    })
      .then(async (result) => {
        const current = get().streams.get(args.chatId);
        if (!current) return;
        current.status = 'finalising';

        const pillsWithMessageId = result.pillRows.map((p) => ({
          ...p,
          messageId: draftMessageId,
        }));

        await db.transaction('rw', db.messages, db.pills, db.chats, async () => {
          await db.messages.update(draftMessageId, {
            contentBlocks: result.finalContentBlocks,
            streamingState: 'complete',
          });
          if (pillsWithMessageId.length) await db.pills.bulkAdd(pillsWithMessageId);
          await db.chats.update(args.chatId, { lastMessageAt: Date.now() });
        });

        // Fire title-gen for first persona response (best-effort, no await).
        const chatAfter = await db.chats.get(args.chatId);
        if (chatAfter && chatAfter.title === null) {
          const personaMsgCount = await db.messages
            .where('chatId')
            .equals(args.chatId)
            .filter((m) => m.role === 'persona' && m.streamingState === 'complete')
            .count();
          if (personaMsgCount === 1) {
            void fireTitleGen(args, result.finalContentBlocks);
          }
        }

        current.status = 'done';

        setTimeout(() => {
          set((s) => {
            const m = new Map(s.streams);
            m.delete(args.chatId);
            return { streams: m };
          });
        }, 200);
      })
      .catch(async (_err) => {
        const current = get().streams.get(args.chatId);
        if (!current) return;
        current.status = 'error';
        // Persist whatever was buffered so a recovery footer can pick it up
        // on a fresh boot if the user navigates away without retrying.
        await db.messages.update(draftMessageId, {
          contentBlocks: current.contentBuffer,
          streamingState: 'incomplete',
        });
      });
  },

  abortDiscard: async (chatId) => {
    const h = get().streams.get(chatId);
    if (!h) return;
    h.controller.abort();
    const db = getClientDataDb();
    await db.messages.delete(h.draftMessageId);
    set((s) => {
      const m = new Map(s.streams);
      m.delete(chatId);
      return { streams: m };
    });
  },

  abortAllForPersonaDiscard: async (personaId) => {
    const matching = [...get().streams.values()].filter((h) => h.personaId === personaId);
    for (const h of matching) await get().abortDiscard(h.chatId);
  },
}));
