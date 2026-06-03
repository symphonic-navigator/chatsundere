// SPDX-License-Identifier: AGPL-3.0-only
import type { StreamChunk } from '@chatsundere/llm-unified';
import { useSessionStore } from '@chatsundere/ui-shared';
import { uuidv7 } from 'uuidv7';
import { create } from 'zustand';
import { type ContentBlock, type PillRow, getClientDataDb } from '../boot/client-data-db.js';
import { buildIntegrationContext } from '../integrations/build-context.js';
import type { OfferingRef } from '../integrations/types.js';
import { queryClient } from '../lib/queryClient.js';
import { type StartStreamArgs, runStreamEngine } from '../lib/stream-engine.js';
import { generateTitleAsync } from '../lib/title-generator.js';
import { MAX_TOOL_ROUNDS, runToolLoop } from '../lib/tool-loop.js';
import {
  dispatch as dispatchTool,
  resolveActiveTools,
  systemPromptSegment,
  toolDefs,
} from '../tools/registry.js';
import { useCurrentChatStore } from './current-chat.store.js';
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
  /** True when the draft is an existing message re-rolled in place (regenerate),
   *  so abort must preserve it as incomplete rather than delete it. */
  reusedDraft: boolean;
}

type StartArgs = Omit<StartStreamArgs, 'signal' | 'onChunk'> & {
  chatId: string;
  userText: string;
  /** The persona's selected web backends, from settings; absent = none. */
  webInterfacing?: { search: OfferingRef | null; fetch: OfferingRef | null };
};

export type RegenerateStreamArgs = StartArgs & {
  /** Existing persona MessageRow to re-roll into (cleared, then streamed). */
  targetMessageId: string;
};

interface StreamManagerStore {
  streams: Map<string, StreamHandle>;
  start: (args: StartArgs) => Promise<void>;
  regenerate: (args: RegenerateStreamArgs) => Promise<void>;
  abortDiscard: (chatId: string) => Promise<void>;
  abortAllForPersonaDiscard: (personaId: string) => Promise<void>;
  abortAllForPersonaPreserve: (personaId: string) => Promise<void>;
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
      offering: args.offering,
      firstUserMessage: args.userText,
      firstPersonaResponse,
      globalInstructions: args.globalInstructions,
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

    runIntoDraft(args, draftMessageId, set, get, false);
  },

  regenerate: async (args) => {
    const db = getClientDataDb();
    const now = Date.now();

    // Clear the target persona message so it renders as a fresh draft, then
    // reuse it as the stream target. The user message is never touched.
    await db.transaction('rw', db.messages, db.chats, async () => {
      await db.messages.update(args.targetMessageId, {
        contentBlocks: [],
        streamingState: 'incomplete',
      });
      await db.chats.update(args.chatId, { lastMessageAt: now });
    });

    runIntoDraft(args, args.targetMessageId, set, get, true);
  },

  abortDiscard: async (chatId) => {
    const h = get().streams.get(chatId);
    if (!h) return;
    h.controller.abort();
    const db = getClientDataDb();
    if (h.reusedDraft) {
      // Regeneration target is an existing user-visible message — preserve the
      // partial buffer as incomplete so the StreamInterruptedFooter offers
      // Retry, rather than deleting the message outright.
      await db.messages.update(h.draftMessageId, {
        contentBlocks: h.contentBuffer,
        streamingState: 'incomplete',
      });
    } else {
      await db.messages.delete(h.draftMessageId);
    }
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

  abortAllForPersonaPreserve: async (personaId) => {
    const matching = [...get().streams.values()].filter((h) => h.personaId === personaId);
    const db = getClientDataDb();
    for (const h of matching) {
      h.controller.abort();
      // Persist the partial buffer + mark as incomplete so the user sees
      // StreamInterruptedFooter on re-visit. No Dexie delete.
      await db.messages.update(h.draftMessageId, {
        contentBlocks: h.contentBuffer,
        streamingState: 'incomplete',
      });
      set((s) => {
        const m = new Map(s.streams);
        m.delete(h.chatId);
        return { streams: m };
      });
    }
  },
}));

/**
 * Stream one turn into an already-persisted draft persona-message
 * (`draftMessageId`), mirroring tokens into a live handle and persisting the
 * final/partial content on success/failure. Shared by `start` (fresh send)
 * and `regenerate` (re-roll of the last answer). Does NOT insert any rows —
 * the caller owns row creation/clearing.
 */
function runIntoDraft(
  args: StartArgs,
  draftMessageId: string,
  set: (fn: (s: StreamManagerStore) => Partial<StreamManagerStore>) => void,
  get: () => StreamManagerStore,
  reusedDraft: boolean,
): void {
  const db = getClientDataDb();
  const now = Date.now();
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
    reusedDraft,
  };

  set((s) => {
    const m = new Map(s.streams);
    m.set(args.chatId, handle);
    return { streams: m };
  });

  const toolsActive = args.offering.profile.toolCalls.supported;
  const integrationCtx = buildIntegrationContext(
    args.persona,
    args.webInterfacing ?? { search: null, fetch: null },
    useSessionStore.getState().mk,
    {
      corsProxyUrl: args.corsProxyUrl,
      corsProxyKey: args.corsProxyKey,
      webSearchTierId: useCurrentChatStore.getState().webSearchTierId,
    },
  );
  const activeTools = toolsActive ? resolveActiveTools(integrationCtx) : [];
  const activeToolDefs = toolDefs(activeTools);
  const toolsInstruction = systemPromptSegment(activeTools) ?? '';

  const onChunk = (chunk: StreamChunk): void => {
    // Mirror tokens and reasoning deltas into the handle so ChatStream
    // can render the draft as it grows. We *replace* the handle on
    // each chunk so a zustand selector that returns `streams.get(chatId)`
    // sees a fresh object reference — bumping just the Map identity
    // isn't enough because selector subscribers compare via Object.is
    // on the inner value.
    if (chunk.type !== 'token' && chunk.type !== 'reasoning') return;
    set((s) => {
      const live = s.streams.get(args.chatId);
      if (!live) return s;
      const nextBuf = [...live.contentBuffer];
      appendStreamChunk(nextBuf, {
        kind: chunk.type === 'reasoning' ? 'reasoning' : 'text',
        text: chunk.text,
      });
      const nextHandle = { ...live, contentBuffer: nextBuf };
      const m = new Map(s.streams);
      m.set(args.chatId, nextHandle);
      return { streams: m };
    });
  };

  runToolLoop({
    toolDefs: activeToolDefs,
    maxRounds: MAX_TOOL_ROUNDS,
    dispatch: (name, toolArgs, signal) => dispatchTool(activeTools, name, toolArgs, signal),
    signal: controller.signal,
    streamOnce: (toolExchange, tools) =>
      runStreamEngine({
        ...args,
        toolsInstruction,
        tools,
        toolExchange,
        signal: controller.signal,
        onChunk,
      }),
    onPillUpdate: (pill) => {
      set((s) => {
        const live = s.streams.get(args.chatId);
        if (!live) return s;
        const pillBuffer = live.pillBuffer.some((p) => p.id === pill.id)
          ? live.pillBuffer.map((p) => (p.id === pill.id ? { ...pill } : p))
          : [...live.pillBuffer, { ...pill }];
        const hasBlock = live.contentBuffer.some((b) => b.type === 'pill' && b.pillId === pill.id);
        const contentBuffer = hasBlock
          ? live.contentBuffer
          : [...live.contentBuffer, { type: 'pill' as const, pillId: pill.id }];
        const m = new Map(s.streams);
        m.set(args.chatId, { ...live, pillBuffer, contentBuffer });
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
}

/**
 * Push a stream chunk as its own block in the live buffer. We
 * deliberately do NOT coalesce here so that the renderer sees the
 * latest token append on each React reconcile — MarkdownContent
 * re-parses the concatenated text on every update, giving a live
 * preview as tokens arrive. Coalescing happens once, engine-side,
 * at stream finalise (see stream-engine.appendText / appendReasoning).
 *
 * The same contract holds for reasoning chunks — every upstream
 * reasoning delta becomes its own sub-block so the ReasoningPill
 * body also receives incremental updates.
 */
function appendStreamChunk(
  buf: ContentBlock[],
  chunk: { kind: 'text' | 'reasoning'; text: string },
): void {
  buf.push(
    chunk.kind === 'reasoning'
      ? { type: 'reasoning', text: chunk.text }
      : { type: 'text', text: chunk.text },
  );
}
