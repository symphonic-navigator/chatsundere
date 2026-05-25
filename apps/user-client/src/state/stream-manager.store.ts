// SPDX-License-Identifier: AGPL-3.0-only
import { uuidv7 } from 'uuidv7';
import { create } from 'zustand';
import { type ContentBlock, type PillRow, getClientDataDb } from '../boot/client-data-db.js';
import { queryClient } from '../lib/queryClient.js';
import { type StartStreamArgs, runStreamEngine } from '../lib/stream-engine.js';
import { generateTitleAsync } from '../lib/title-generator.js';
import { toastStore } from './toast.store.js';

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
      onChunk: (chunk) => {
        // Mirror tokens into the handle so ChatStream can render the draft
        // as it grows. We *replace* the handle on each chunk so a zustand
        // selector that returns `streams.get(chatId)` sees a fresh object
        // reference — bumping just the Map identity isn't enough because
        // selector subscribers compare via Object.is on the inner value.
        if (chunk.type !== 'token') return;
        set((s) => {
          const live = s.streams.get(args.chatId);
          if (!live) return s;
          const nextBuf = [...live.contentBuffer];
          appendTextBlock(nextBuf, chunk.text);
          const nextHandle = { ...live, contentBuffer: nextBuf };
          const m = new Map(s.streams);
          m.set(args.chatId, nextHandle);
          return { streams: m };
        });
      },
    })
      .then(async (result) => {
        const current = get().streams.get(args.chatId);
        if (!current) return;

        // Rotate the handle reference so subscribers (notably ChatStream's
        // scroll-to-bottom useEffect, which keys on streamHandle identity)
        // see the status transition. In-place mutation here used to silently
        // break that — the handle ref stayed identical until streams.delete
        // 200ms later, opening a window for scroll drift right after the
        // last token landed.
        set((s) => {
          const live = s.streams.get(args.chatId);
          if (!live) return s;
          const m = new Map(s.streams);
          m.set(args.chatId, { ...live, status: 'finalising' });
          return { streams: m };
        });

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

        // TanStack-Query has no idea the underlying Dexie rows just changed.
        // Invalidate both the single-chat key (for the active ChatPage) and
        // the chat-list key (entrance-hall continue card, my-history later).
        void queryClient.invalidateQueries({ queryKey: ['chats', args.chatId] });
        void queryClient.invalidateQueries({ queryKey: ['chats'] });

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

        // Same reasoning as the finalising transition above — rotate so
        // subscribers re-render and the auto-follow scroll lands at the
        // post-completion bottom.
        set((s) => {
          const live = s.streams.get(args.chatId);
          if (!live) return s;
          const m = new Map(s.streams);
          m.set(args.chatId, { ...live, status: 'done' });
          return { streams: m };
        });

        setTimeout(() => {
          set((s) => {
            const m = new Map(s.streams);
            m.delete(args.chatId);
            return { streams: m };
          });
        }, 200);
      })
      .catch(async (err) => {
        // Aborts go through abortDiscard, which deletes the handle before
        // the rejection lands here; the early-return below handles that.
        const current = get().streams.get(args.chatId);
        if (!current) return;

        console.error('[stream-manager] stream failed for chat', args.chatId, err);

        // Persist whatever was buffered so the StreamInterruptedFooter can
        // offer Retry/Discard when the user revisits the chat.
        await db.messages.update(draftMessageId, {
          contentBlocks: current.contentBuffer,
          streamingState: 'incomplete',
        });
        void queryClient.invalidateQueries({ queryKey: ['chats', args.chatId] });

        // Free the slot so the Cockpit Send button re-enables for this
        // chat and the BackgroundStreamBadge stops counting this stream.
        set((s) => {
          const m = new Map(s.streams);
          m.delete(args.chatId);
          return { streams: m };
        });

        // Surface the failure for the away-from-chat case — the inline
        // footer covers the in-chat case.
        toastStore.show({
          message: `${args.persona.name} couldn't reach the model — retry from the chat`,
          tone: 'warn',
          durationMs: 6000,
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

/** Append `text` to the tail of `buf`, coalescing with the trailing text block.
 *  Replaces the trailing block with a new reference so React-based subscribers
 *  watching specific blocks re-render on every token append. */
function appendTextBlock(buf: ContentBlock[], text: string): void {
  const last = buf[buf.length - 1];
  if (last && last.type === 'text') {
    buf[buf.length - 1] = { type: 'text', text: last.text + text };
  } else {
    buf.push({ type: 'text', text });
  }
}
