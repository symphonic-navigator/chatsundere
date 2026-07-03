// SPDX-License-Identifier: AGPL-3.0-only
import {
  type OneShotArgs,
  type ReasoningIntent,
  type StreamChunk,
  type WireContentPart,
  getCanonical,
  getOffering,
  getProvider,
  getProxyAuthSource,
  runOneShotCompletion,
} from '@chatsundere/llm-unified';
import { useSessionStore } from '@chatsundere/ui-shared';
import { uuidv7 } from 'uuidv7';
import { create } from 'zustand';
import { blobToDataUrl } from '../attachments/blob-data-url.js';
import { resolveAttachmentParts } from '../attachments/resolve-send.js';
import { describeImage } from '../attachments/substitute-vision.js';
import { imageDisposition } from '../attachments/vision-gate.js';
import { buildUserWireContent } from '../attachments/wire-injection.js';
import {
  type AttachmentRow,
  type ContentBlock,
  type PillRow,
  getClientDataDb,
} from '../boot/client-data-db.js';
import { applyActiveCompaction } from '../compaction/apply.js';
import { releaseCompactionLock, tryAcquireCompactionLock } from '../compaction/mutex.js';
import { wouldOverflow } from '../compaction/overflow.js';
import { type CompactionArgs, runCompaction } from '../compaction/runner.js';
import { shouldFireValve } from '../compaction/trigger.js';
import {
  attachPendingToMessage,
  listMessageAttachments,
  snapshotPendingDocumentReferences,
} from '../data/attachments.js';
import { QK } from '../data/queryKeys.js';
import { buildIntegrationContext } from '../integrations/build-context.js';
import type { OfferingRef } from '../integrations/types.js';
import { buildWebTools } from '../integrations/web/build-web-tools.js';
import { renderKnowledgeAwareness } from '../knowledge/query-tool.js';
import { flattenAnswerText } from '../lib/content-blocks.js';
import { resolveContextWindow } from '../lib/context-window.js';
import {
  type DiagnosticReport,
  buildEnvironmentSnapshot,
  createDiagnosticsCollector,
} from '../lib/model-debug.js';
import { buildOpenerInstruction } from '../lib/opener.js';
import { isProxyAvailable } from '../lib/proxy-auth.js';
import { queryClient } from '../lib/queryClient.js';
import { openSecret } from '../lib/secrets.js';
import { type StartStreamArgs, runStreamEngine } from '../lib/stream-engine.js';
import { generateTitleAsync } from '../lib/title-generator.js';
import { contextUtilisation, estimateTokens } from '../lib/token-estimator.js';
import { MAX_TOOL_ROUNDS, runToolLoop } from '../lib/tool-loop.js';
import { runMemoryPipeline } from '../memory/pipeline.js';
import { loadMemoryContext } from '../memory/repo.js';
import { enqueueSync, isLinkedForSync, mutateSynced } from '../sync/enqueue.js';
import { scheduleClass1Sync } from '../sync/triggers.js';
import { EXPERT_MAX_ROUNDS, type ExpertBase } from '../tools/ask-expert.js';
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
  /** True when the stream is generating an opener (greeting) message. Used by
   *  abortPreserve to clear openerPending when the user stops the opener. */
  isOpener?: boolean;
}

type StartArgs = Omit<StartStreamArgs, 'signal' | 'onChunk'> & {
  chatId: string;
  userText: string;
  /** The persona's selected web backends, from settings; absent = none. */
  webInterfacing?: { search: OfferingRef | null; fetch: OfferingRef | null };
  /** Global substitute-vision model ref "providerTemplateId:upstreamSlug"; null = none. */
  substituteVisionModel?: string | null;
  /**
   * The substitute model's resolved one-shot call context (provider, decrypted
   * api-key, target). Resolved in the send path because it needs the MasterKey,
   * which the store never touches. Absent when no substitute is set.
   */
  substituteOneShotBase?: Omit<OneShotArgs, 'messages' | 'bodyExtras'>;
  /**
   * Per-send knowledge context (effective libraries + retrieve closure), resolved
   * in the send path. Absent/null = no libraries assigned → no knowledge tool.
   */
  knowledge?: import('../knowledge/query-tool.js').KnowledgeContext | null;
  /** Band-2 lore segment text for this send; '' when nothing fired. */
  loreContext?: string;
  /** Lore result driving the kb-injection pill; null/absent when nothing fired. */
  lore?: import('../knowledge/lore.js').LoreResult | null;
  /** Resolved expert model call context; absent = no ask_expert tool offered. */
  expertBase?: ExpertBase;
  /** Display label for the expert model (e.g. "DeepSeek R2"). */
  expertModelLabel?: string;
  /** Reasoning intent for the expert call (typically max-effort). */
  expertReasoning?: ReasoningIntent;
  /** Resolved expert web backends; null = no web tools for the expert. */
  expertWeb?: import('../lib/resolve-expert-web.js').ResolvedExpertWeb | null;
  /** Per-send MCP tool context (active servers + key opener + approval hook),
   *  resolved in the send path which holds the MasterKey. null/absent = no MCP tools. */
  mcp?: import('../mcp/mcp-tools.js').McpToolContext | null;
  /** Per-send image-generation context, resolved in the send path which holds
   *  the MasterKey. null/absent = no generate_image tool. */
  images?: import('../tools/generate-image.js').ImageToolContext | null;
};

export type RegenerateStreamArgs = StartArgs & {
  /** Existing persona MessageRow to re-roll into (cleared, then streamed). */
  targetMessageId: string;
};

/** Arguments required to generate or re-generate an opener greeting. A strict
 *  subset of StartArgs — no user text, no attachments, no tool contexts. */
export type OpenerArgs = {
  chatId: string;
  chat: import('../boot/client-data-db.js').ChatRow;
  persona: import('../boot/client-data-db.js').PersonaRow;
  provider: import('@chatsundere/llm-unified').ProviderDefinition;
  providerConfig: import('@chatsundere/llm-unified').ProviderConfig;
  apiKey: string;
  offering: import('@chatsundere/llm-unified').Offering;
  reasoning: import('../lib/reasoning-resolver.js').ReasoningState;
  globalInstructions: string;
  globalAboutMe: string;
  screenEffectsEnabled: boolean;
};

export type RegenerateOpenerArgs = OpenerArgs & {
  targetMessageId: string;
};

interface StreamManagerStore {
  streams: Map<string, StreamHandle>;
  /** Set to 'blocking' while a synchronous pre-send compaction is in progress
   *  (Layer 3 overflow failsafe). Null at all other times. */
  compactingState: 'blocking' | null;
  /** Last failure report per chat (in-memory; perishable — lost on reload). */
  diagnostics: Map<string, DiagnosticReport>;
  clearDiagnostics: (chatId: string) => void;
  start: (args: StartArgs) => Promise<void>;
  regenerate: (args: RegenerateStreamArgs) => Promise<void>;
  startOpener: (args: OpenerArgs) => Promise<void>;
  regenerateOpener: (args: RegenerateOpenerArgs) => Promise<void>;
  abortDiscard: (chatId: string) => Promise<void>;
  abortAllForPersonaDiscard: (personaId: string) => Promise<void>;
  abortPreserve: (chatId: string) => Promise<void>;
  abortAllForPersonaPreserve: (personaId: string) => Promise<void>;
  has: (chatId: string) => boolean;
  getDraftMessage: (chatId: string) => { id: string; contentBlocks: ContentBlock[] } | null;
  /**
   * Resolve provider credentials from Dexie + session and run a manual
   * compaction. Throws when credentials are unavailable or the model call
   * fails. Returns null when there is nothing new to compact (already
   * up-to-date).
   */
  compactNow: (
    chatId: string,
  ) => Promise<import('../boot/client-data-db.js').CompactionCheckpointRow | null>;
}

/** Extract the provider/chat fields shared by every `runCompaction` call site. */
function compactionArgsFrom(args: StartArgs): Omit<CompactionArgs, 'trigger'> {
  return {
    chat: args.chat,
    persona: args.persona,
    provider: args.provider,
    providerConfig: args.providerConfig,
    apiKey: args.apiKey,
    offering: args.offering,
  };
}

function fireCompactionValve(args: StartArgs, usedTokens: number): void {
  const window = resolveContextWindow(args.persona, args.offering);
  const fillPct = contextUtilisation(usedTokens, window);
  if (!shouldFireValve(fillPct)) return;
  if (!tryAcquireCompactionLock(args.chat.id)) return;
  void runCompaction({ ...compactionArgsFrom(args), trigger: 'auto' })
    .then((cp) => {
      if (cp) {
        void queryClient.invalidateQueries({ queryKey: QK.chat(args.chat.id) });
        void queryClient.invalidateQueries({ queryKey: QK.compaction(args.chat.id) });
      }
    })
    .catch(() => {
      // runCompaction logs nothing user-facing; the valve is best-effort.
    })
    .finally(() => releaseCompactionLock(args.chat.id));
}

function fireMemoryPipeline(args: StartArgs): void {
  const personaId = args.persona.id;
  void runMemoryPipeline({
    persona: args.persona,
    chat: args.chat,
    provider: args.provider,
    providerConfig: args.providerConfig,
    apiKey: args.apiKey,
    offering: args.offering,
  })
    .then(async () => {
      // Refresh the badge/overlay after background writes (no useLiveQuery in this project).
      void queryClient.invalidateQueries({ queryKey: QK.memory(personaId) });
      // The "Learn from this chat" disabled-state is keyed by chatId (not personaId),
      // so it is not covered by the QK.memory prefix above — refresh it explicitly.
      void queryClient.invalidateQueries({ queryKey: QK.unextractedCount(args.chat.id) });
      // First-run note: the first time memory produces anything, invite the user once.
      // Benign race: two pipelines resolving in the same window can both pass the
      // !memoryIntroShown check before either writes it → at most one duplicate toast,
      // once in a persona's lifetime. Not worth a transaction.
      const db = getClientDataDb();
      const persona = await db.personas.get(personaId);
      if (persona && !(persona.memoryIntroShown ?? false)) {
        const produced = (await db.memoryJournal.where('personaId').equals(personaId).count()) > 0;
        if (produced) {
          toastStore.show({
            message: `${persona.name} is starting to remember you — manage this in the persona's Memory section.`,
            tone: 'info',
            durationMs: 9000,
          });
          await db.personas.update(personaId, { memoryIntroShown: true });
          void queryClient.invalidateQueries({ queryKey: QK.persona(personaId) });
        }
      }
    })
    .catch(() => {
      // runMemoryPipeline logs its own errors; never disturb the send path.
    });
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
  compactingState: null,
  diagnostics: new Map(),
  clearDiagnostics: (chatId) =>
    set((s) => {
      if (!s.diagnostics.has(chatId)) return s;
      const m = new Map(s.diagnostics);
      m.delete(chatId);
      return { diagnostics: m };
    }),

  has: (chatId) => get().streams.has(chatId),

  getDraftMessage: (chatId) => {
    const h = get().streams.get(chatId);
    return h ? { id: h.draftMessageId, contentBlocks: h.contentBuffer } : null;
  },

  compactNow: async (chatId) => {
    const db = getClientDataDb();
    const mk = useSessionStore.getState().mk;
    if (!mk) throw new Error('compactNow: master key unavailable — re-authenticate');

    const chat = await db.chats.get(chatId);
    if (!chat) throw new Error('compactNow: chat not found');

    const persona = await db.personas.get(chat.personaId);
    if (!persona) throw new Error('compactNow: persona not found');

    const provider = await db.providers.get(persona.providerId);
    if (!provider) throw new Error('compactNow: provider not found');

    const providerDef = getProvider(provider.templateId);
    if (!providerDef)
      throw new Error(`compactNow: unknown provider template "${provider.templateId}"`);

    const offering = getOffering(provider.templateId, persona.modelId);
    if (!offering) throw new Error(`compactNow: no offering for "${persona.modelId}"`);

    const apiKey = await openSecret(provider.apiKey, mk, `provider/${provider.id}/api-key`);

    const providerConfig: import('@chatsundere/llm-unified').ProviderConfig = {
      baseUrl: providerDef.baseUrl,
      routing:
        providerDef.corsHint === 'requires-proxy' ? { kind: 'cors-proxy' } : { kind: 'direct' },
    };

    const compactionArgs: CompactionArgs = {
      chat,
      persona,
      provider: providerDef,
      providerConfig,
      apiKey,
      offering,
      trigger: 'manual',
    };

    if (!tryAcquireCompactionLock(chatId)) {
      throw new Error('Compaction already in progress for this chat');
    }
    try {
      return await runCompaction(compactionArgs);
    } finally {
      releaseCompactionLock(chatId);
    }
  },

  start: async (args) => {
    if (get().streams.has(args.chatId)) {
      throw new Error('stream-manager.start: a stream is already live for this chat');
    }

    // Layer 3 overflow failsafe: estimate the would-be context size for this
    // send (history + incoming user turn). This runs BEFORE the user message is
    // inserted and BEFORE draftInput is cleared, so that returning early on a
    // failed block-compact leaves the composer intact.
    const contextWindow = resolveContextWindow(args.persona, args.offering);
    // Estimate the realistic sent size: if a checkpoint is active, only the tail
    // (+ the injected summary) is sent, not the full history.
    const projected = await applyActiveCompaction(args.chat, args.priorMessages, '');
    const projectedUsed =
      projected.priorMessages.reduce(
        (sum, m) => sum + estimateTokens(flattenAnswerText(m.contentBlocks)),
        0,
      ) +
      estimateTokens(projected.memoryContext) +
      estimateTokens(args.userText);
    if (wouldOverflow(projectedUsed, contextWindow)) {
      // Only block-compact if the background valve isn't already compacting this
      // chat. If it is, let it finish — truncateToWindow remains the hard backstop
      // for this one send, and the valve's checkpoint applies on the next send.
      if (tryAcquireCompactionLock(args.chat.id)) {
        set({ compactingState: 'blocking' });
        let compactionFailed = false;
        try {
          await runCompaction({ ...compactionArgsFrom(args), trigger: 'overflow' });
          void queryClient.invalidateQueries({ queryKey: QK.compaction(args.chat.id) });
        } catch {
          compactionFailed = true;
        } finally {
          set({ compactingState: null });
          releaseCompactionLock(args.chat.id);
        }
        if (compactionFailed) {
          toastStore.show({
            message: "Couldn't compact just now — your message is kept.",
            tone: 'warn',
            durationMs: 8000,
            action: { label: 'Retry', onClick: () => void get().start(args) },
          });
          return; // typed/pasted message is preserved in the composer; do not send.
        }
      }
    }

    const db = getClientDataDb();
    const now = Date.now();
    const userMessageId = uuidv7();
    const draftMessageId = uuidv7();

    const linked = isLinkedForSync();
    await db.transaction(
      'rw',
      [db.messages, db.chats, db.attachments, db.documents, db.personas, db.syncOutbox],
      async (tx) => {
        await db.messages.add({
          id: userMessageId,
          chatId: args.chatId,
          role: 'user',
          contentBlocks: [{ type: 'text', text: args.userText }],
          createdAt: now,
          updatedAt: now,
          bookmarked: false,
          streamingState: 'complete',
        });
        // Class-1: the user message is already complete on insert → enqueue it.
        // The persona draft below is incomplete and is enqueued at completion.
        if (linked) enqueueSync(tx, 'messages', userMessageId, 'upsert');
        await db.messages.add({
          id: draftMessageId,
          chatId: args.chatId,
          role: 'persona',
          contentBlocks: [],
          createdAt: now + 1,
          updatedAt: now + 1,
          bookmarked: false,
          streamingState: 'incomplete',
        });
        // Lazy-mode re-home: at compose time a brand-new chat had no row, so the
        // Cockpit keyed its pending attachments under chatId = '' (see chat-page.tsx,
        // InteractionMode `chatId={chat?.id ?? activeChatId ?? ''}`). By send time the
        // real chat exists (created in useSendMessage) — adopt those orphaned rows
        // onto this chat before binding them to the user message, so they are not lost.
        if (args.chatId !== '') {
          const orphans = await db.attachments
            .where('chatId')
            .equals('')
            .filter((a) => a.messageId === null)
            .toArray();
          await Promise.all(
            orphans.map((a) => db.attachments.update(a.id, { chatId: args.chatId })),
          );
        }
        // Snapshot-on-send: freeze any still-referenced knowledge documents so the sent
        // message is decoupled from later edits/deletes of the source (WYSIWYG).
        await snapshotPendingDocumentReferences(args.chatId);
        // Bind all pending attachments for this chat to the new user message atomically.
        await attachPendingToMessage(args.chatId, userMessageId);
        await db.chats.update(args.chatId, {
          lastMessageAt: now + 1,
          draftInput: '',
          openerPending: false,
        });
        await db.personas.update(args.persona.id, { lastInteractionAt: now + 1 });
      },
    );
    if (linked) scheduleClass1Sync();
    void queryClient.invalidateQueries({ queryKey: QK.personas });

    // The persona response goes live immediately; runIntoDraft resolves the user
    // turn's attachments (running substitute-vision describes as live pills)
    // inside the live stream for a fresh send.
    runIntoDraft(args, draftMessageId, set, get, false, userMessageId);
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

  startOpener: async (args) => {
    // Idempotence guard 1: bail immediately if a stream is already live for this chat.
    if (get().streams.has(args.chatId)) return;

    const db = getClientDataDb();
    const now = Date.now();
    const draftMessageId = uuidv7();

    // Idempotence guard 2: re-check inside the creation transaction.
    let shouldProceed = false;
    await db.transaction('rw', db.messages, db.chats, async () => {
      const chat = await db.chats.get(args.chatId);
      if (!chat?.openerPending) return;
      const messageCount = await db.messages.where('chatId').equals(args.chatId).count();
      if (messageCount > 0) return;
      await db.messages.add({
        id: draftMessageId,
        chatId: args.chatId,
        role: 'persona',
        kind: 'opener',
        contentBlocks: [],
        createdAt: now,
        updatedAt: now,
        bookmarked: false,
        streamingState: 'incomplete',
      });
      shouldProceed = true;
    });

    if (!shouldProceed) return;

    // Invalidate the chat query so the live opener bubble is visible during streaming.
    void queryClient.invalidateQueries({ queryKey: ['chats', args.chatId] });

    await runOpenerStream(args, draftMessageId, set, get, { reroll: false });
  },

  regenerateOpener: async (args) => {
    // Bail when a stream is already live for this chat.
    if (get().streams.has(args.chatId)) return;

    const db = getClientDataDb();
    const now = Date.now();

    // Clear the existing opener row so it renders as a fresh draft.
    await db.transaction('rw', db.messages, db.chats, async () => {
      await db.messages.update(args.targetMessageId, {
        contentBlocks: [],
        streamingState: 'incomplete',
      });
      await db.chats.update(args.chatId, { lastMessageAt: now });
    });

    // Invalidate the chat query so the cleared draft row is visible during streaming.
    void queryClient.invalidateQueries({ queryKey: ['chats', args.chatId] });

    await runOpenerStream(args, args.targetMessageId, set, get, { reroll: true });
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

  abortPreserve: async (chatId) => {
    const h = get().streams.get(chatId);
    if (!h) return;
    // Abort first, then remove the handle synchronously before any await so the
    // aborted stream's rejection in runOpenerStream/runIntoDraft sees no handle
    // and exits via the early-return guard rather than hitting the failure path
    // that would delete the row we are about to persist.
    h.controller.abort();
    set((s) => {
      const m = new Map(s.streams);
      m.delete(chatId);
      return { streams: m };
    });
    const db = getClientDataDb();
    // Persist the partial buffer + mark incomplete so the StreamInterruptedFooter
    // offers Retry — for a fresh send AND a regenerate (unlike abortDiscard, which
    // deletes a fresh-send draft). The user decides: keep what they have, or retry.
    await db.messages.update(h.draftMessageId, {
      contentBlocks: h.contentBuffer,
      streamingState: 'incomplete',
    });
    if (h.isOpener) {
      await db.chats.update(chatId, { openerPending: false });
    }
    void queryClient.invalidateQueries({ queryKey: ['chats', chatId] });
    void queryClient.invalidateQueries({ queryKey: ['chats'] });
  },

  abortAllForPersonaPreserve: async (personaId) => {
    const matching = [...get().streams.values()].filter((h) => h.personaId === personaId);
    for (const h of matching) await get().abortPreserve(h.chatId);
  },
}));

/**
 * Resolve a user turn's bound attachments into the wire `content` for that turn:
 * a plain string when there are no attachments (unchanged behaviour), else a
 * multimodal `WireContentPart[]`. Images are sent directly when the active model
 * has vision; otherwise routed through the substitute-vision model (description
 * cached on the row); otherwise emitted as a text placeholder. Failures degrade
 * gracefully to the plain user text — a vision hiccup must not block the send.
 *
 * NOTE (prior-turn replay, spec §9): only the CURRENT user turn's attachments are
 * resolved here. Re-injecting attachments from PRIOR user messages on replay would
 * require resolving per-prior-message parts and a new attachment-parts mapping in
 * `buildEngineWireMessages` (which currently flattens history to text-only). That
 * is deferred — the current-turn path is the must-have. See the task report.
 */
async function resolveUserContent(
  args: StartArgs,
  userMessageId: string,
  // signal reserved for describe cancellation (outer abort already tears down the send)
  _signal: AbortSignal,
  callbacks: {
    onDescribeStart: (a: AttachmentRow) => void;
    onDescribeEnd: (
      a: AttachmentRow,
      outcome: { ok: true; text: string } | { ok: false; error: string },
    ) => void;
  },
): Promise<string | WireContentPart[]> {
  const db = getClientDataDb();
  try {
    const atts = await listMessageAttachments(userMessageId);
    if (atts.length === 0) return args.userText;

    // Refs are "providerTemplateId:upstreamSlug" (see settings substitute picker).
    // The active provider's template id is ProviderDefinition.id (args.provider.id).
    const activeRef = `${args.provider.id}:${args.offering.upstreamSlug}`;
    const substituteRef = args.substituteVisionModel ?? null;
    const lookup = (ref: string) => {
      const idx = ref.indexOf(':');
      if (idx < 0) return undefined;
      return getOffering(ref.slice(0, idx), ref.slice(idx + 1));
    };
    const disposition = imageDisposition(activeRef, substituteRef, lookup);

    const base = args.substituteOneShotBase;
    const parts = await resolveAttachmentParts(atts, disposition, substituteRef, {
      toDataUrl: blobToDataUrl,
      describe: async (dataUrl, model) => {
        if (!base) throw new Error('substitute-vision: no resolved one-shot context');
        return describeImage({
          dataUrl,
          model,
          runOneShot: runOneShotCompletion,
          oneShotBase: base,
        });
      },
      cacheDescription: async (id, model, text) => {
        // Class-2 record edit on a sent attachment (WS-D §5). A background job
        // (substitute-vision) — offline-defer so a describe never throws or
        // loses its cache; it converges on the next online edit / recovery.
        await mutateSynced({
          collection: 'attachments',
          key: id,
          tables: ['attachments'],
          deferWhenOffline: true,
          write: async (tx) => {
            await tx
              .table('attachments')
              .update(id, { visionDescription: { model, text }, updatedAt: Date.now() });
          },
        });
      },
      onDescribeStart: callbacks.onDescribeStart,
      onDescribeEnd: callbacks.onDescribeEnd,
    });
    return buildUserWireContent(args.userText, parts);
  } catch (err) {
    console.error('[stream-manager] attachment resolution failed; sending text only', err);
    return args.userText;
  }
}

/**
 * Stream one turn into an already-persisted draft persona-message
 * (`draftMessageId`), mirroring tokens into a live handle and persisting the
 * final/partial content on success/failure. Shared by `start` (fresh send)
 * and `regenerate` (re-roll of the last answer). Does NOT insert any rows —
 * the caller owns row creation/clearing.
 */
async function runIntoDraft(
  args: StartArgs,
  draftMessageId: string,
  set: (fn: (s: StreamManagerStore) => Partial<StreamManagerStore>) => void,
  get: () => StreamManagerStore,
  reusedDraft: boolean,
  userMessageId: string | null = null,
): Promise<void> {
  const db = getClientDataDb();
  const now = Date.now();
  const controller = new AbortController();
  const diag = createDiagnosticsCollector();
  // A fresh attempt clears any stale failure report for this chat.
  set((s) => {
    if (!s.diagnostics.has(args.chatId)) return s;
    const m = new Map(s.diagnostics);
    m.delete(args.chatId);
    return { diagnostics: m };
  });
  // Lore pill: deterministic, built up-front (unlike tool-call pills from the engine) and closed over by both the finalise and error paths below.
  const lorePill: PillRow | null =
    args.lore && args.lore.entries.length > 0
      ? {
          id: uuidv7(),
          messageId: '',
          kind: 'kb-injection',
          positionHint: 'above-text',
          status: 'completed',
          payload: {
            entries: args.lore.entries,
            omittedCount: args.lore.omittedCount,
            truncatedCount: args.lore.truncatedCount,
          },
          createdAt: now,
        }
      : null;
  const handle: StreamHandle = {
    chatId: args.chatId,
    personaId: args.persona.id,
    draftMessageId,
    controller,
    status: 'streaming',
    contentBuffer: lorePill ? [{ type: 'pill', pillId: lorePill.id }] : [],
    pillBuffer: lorePill ? [lorePill] : [],
    startedAt: now,
    reusedDraft,
  };

  set((s) => {
    const m = new Map(s.streams);
    m.set(args.chatId, handle);
    return { streams: m };
  });

  // Vision pills emitted during the live describe phase (fresh send only).
  // Declared here so the .then finalise path can close over them and persist
  // them alongside lore and tool-call pills.
  const visionPills: PillRow[] = [];
  // Friendly display name for the substitute model (the raw ref is
  // "templateId:slug"); mirrors how the expert pill resolves its label.
  const substituteLabel = ((): string => {
    const ref = args.substituteVisionModel;
    if (!ref) return 'vision model';
    const idx = ref.indexOf(':');
    if (idx < 0) return ref;
    const off = getOffering(ref.slice(0, idx), ref.slice(idx + 1));
    return getCanonical(off?.canonicalRef ?? '')?.displayName ?? off?.upstreamSlug ?? ref;
  })();

  // Resolve the fresh user turn's attachments into wire content, emitting a live
  // describe_image pill per uncached substitute image (ahead of the lore pill).
  // Regenerate (reusedDraft) keeps args.userMessageText as-is (no re-describe).
  let userMessageText = args.userMessageText;
  if (!reusedDraft && userMessageId) {
    const rebuildBuffers = (): void => {
      set((s) => {
        const live = s.streams.get(args.chatId);
        if (!live) return s;
        const contentBuffer: ContentBlock[] = [
          ...visionPills.map((vp) => ({ type: 'pill', pillId: vp.id }) as ContentBlock),
          ...(lorePill ? [{ type: 'pill', pillId: lorePill.id } as ContentBlock] : []),
        ];
        const pillBuffer: PillRow[] = [...visionPills, ...(lorePill ? [lorePill] : [])];
        const m = new Map(s.streams);
        m.set(args.chatId, { ...live, contentBuffer, pillBuffer });
        return { streams: m };
      });
    };
    userMessageText = await resolveUserContent(args, userMessageId, controller.signal, {
      onDescribeStart: (a) => {
        visionPills.push({
          id: uuidv7(),
          messageId: '',
          kind: 'tool-call',
          positionHint: 'above-text',
          status: 'pending',
          payload: {
            name: 'describe_image',
            model: substituteLabel,
            fileName: a.fileName,
          },
          createdAt: Date.now(),
        });
        rebuildBuffers();
      },
      onDescribeEnd: (a, outcome) => {
        const vp = visionPills.find(
          (x) =>
            (x.payload as { fileName?: string }).fileName === a.fileName && x.status === 'pending',
        );
        if (vp) {
          vp.status = outcome.ok ? 'completed' : 'failed';
          vp.payload = {
            ...(vp.payload as Record<string, unknown>),
            ...(outcome.ok ? { result: outcome.text } : { error: outcome.error }),
          };
        }
        rebuildBuffers();
      },
    });
  }

  const toolsActive = args.offering.profile.toolCalls.supported;
  const integrationCtx = buildIntegrationContext(
    args.persona,
    args.webInterfacing ?? { search: null, fetch: null },
    useSessionStore.getState().mk,
    {
      useProxy: isProxyAvailable(),
      webSearchTierId: useCurrentChatStore.getState().webSearchTierId,
    },
    {
      chatId: args.chatId,
      personaId: args.persona.id,
      personaOffering: {
        providerId: args.offering.providerId,
        upstreamSlug: args.offering.upstreamSlug,
      },
    },
  );
  const knowledge = args.knowledge ?? null;
  const expert = args.expertBase
    ? {
        base: args.expertBase,
        modelLabel: args.expertModelLabel ?? 'expert',
        reasoning: args.expertReasoning ?? { enabled: true },
        runtimeEnabled: useCurrentChatStore.getState().askExpert,
        web: args.expertWeb
          ? {
              tools: buildWebTools({
                search: args.expertWeb.search,
                fetch: args.expertWeb.fetch,
                ctx: args.expertWeb.ctx,
                getKey: integrationCtx.getKey,
              }),
              maxRounds: EXPERT_MAX_ROUNDS,
            }
          : undefined,
      }
    : null;
  const memoryCtx =
    (args.persona.useMemory ?? true)
      ? {
          personaId: args.persona.id,
          onWritten: () =>
            void queryClient.invalidateQueries({ queryKey: QK.memory(args.persona.id) }),
        }
      : null;
  const activeTools = toolsActive
    ? resolveActiveTools(
        integrationCtx,
        knowledge,
        expert,
        args.mcp ?? null,
        args.images ?? null,
        memoryCtx,
      )
    : [];
  const activeToolDefs = toolDefs(activeTools);
  const toolsInstruction = systemPromptSegment(activeTools) ?? '';
  const knowledgeLibrariesContext =
    toolsActive && knowledge ? renderKnowledgeAwareness(knowledge.libraries) : '';
  const memoryContext =
    (args.persona.useMemory ?? true) ? await loadMemoryContext(args.persona.id) : '';
  const compacted = await applyActiveCompaction(args.chat, args.priorMessages, memoryContext);

  const onChunk = (chunk: StreamChunk): void => {
    diag.markChunk(chunk);
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
    dispatch: (name, toolArgs, signal, onProgress) =>
      dispatchTool(activeTools, name, toolArgs, signal, onProgress),
    signal: controller.signal,
    streamOnce: (toolExchange, tools) =>
      runStreamEngine({
        ...args,
        priorMessages: compacted.priorMessages,
        userMessageText,
        toolsInstruction,
        knowledgeLibrariesContext,
        memoryContext: compacted.memoryContext,
        loreContext: args.loreContext ?? '',
        tools,
        toolExchange,
        signal: controller.signal,
        onChunk,
        onDiagnostics: diag.sink,
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

      // Vision pills (describe_image) come first, then the lore pill, then tool-call rows.
      const allPillRows = [...visionPills, ...(lorePill ? [lorePill] : []), ...result.pillRows];
      const pillsWithMessageId = allPillRows.map((p) => ({
        ...p,
        messageId: draftMessageId,
      }));
      // Content blocks: vision pill refs first, then lore pill ref, then engine blocks.
      const finalContentBlocks = [
        ...visionPills.map((vp) => ({ type: 'pill' as const, pillId: vp.id })),
        ...(lorePill ? [{ type: 'pill' as const, pillId: lorePill.id }] : []),
        ...result.finalContentBlocks,
      ];

      const linked = isLinkedForSync();
      await db.transaction('rw', [db.messages, db.pills, db.chats, db.syncOutbox], async (tx) => {
        await db.messages.update(draftMessageId, {
          contentBlocks: finalContentBlocks,
          streamingState: 'complete',
        });
        if (pillsWithMessageId.length) await db.pills.bulkAdd(pillsWithMessageId);
        // Class-1: the persona message is now complete, and its pills are terminal.
        // chats.lastMessageAt is a device-local derived recompute (§5), not enqueued.
        if (linked) {
          enqueueSync(tx, 'messages', draftMessageId, 'upsert');
          for (const p of pillsWithMessageId) enqueueSync(tx, 'pills', p.id, 'upsert');
        }
        await db.chats.update(args.chatId, { lastMessageAt: Date.now() });
      });
      if (linked) scheduleClass1Sync();

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
          .filter(
            (m) => m.role === 'persona' && m.streamingState === 'complete' && m.kind !== 'opener',
          )
          .count();
        if (personaMsgCount === 1) {
          void fireTitleGen(args, result.finalContentBlocks);
        }
      }

      // Memory pipeline (best-effort, no await). Self-gates on useMemory,
      // volume thresholds, and the per-persona mutex.
      fireMemoryPipeline(args);
      // Compaction valve (best-effort, no await). Fires when context fill
      // exceeds the 90 % threshold and no compaction is already in flight.
      fireCompactionValve(args, result.usedTokens);

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
      // Persist the lore pill row and any vision pill rows so the pill blocks
      // already seeded into contentBuffer can resolve — without this the
      // pointers would dangle when the incomplete message is reloaded from
      // Dexie. put() (not add()) is idempotent against a prior partial persist
      // on retry.
      if (lorePill !== null) {
        await db.pills.put({ ...lorePill, messageId: draftMessageId });
      }
      for (const vp of visionPills) {
        await db.pills.put({ ...vp, messageId: draftMessageId });
      }
      void queryClient.invalidateQueries({ queryKey: ['chats', args.chatId] });

      // Build and store the diagnostic report. Strictly additive and last in the
      // recovery sequence — the draft is already persisted as incomplete above, so
      // even if report-building somehow threw it could not block recovery.
      const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      diag.markError(errMsg);
      const routing = args.providerConfig.routing.kind === 'cors-proxy' ? 'cors-proxy' : 'direct';
      const report = diag.build({
        kind: 'chat-failure',
        provider: {
          displayName: args.provider.displayName,
          routing,
          targetHost: (() => {
            try {
              return new URL(args.provider.baseUrl).host;
            } catch {
              return args.provider.baseUrl;
            }
          })(),
          ...(() => {
            if (routing !== 'cors-proxy') return {};
            const proxyUrl = getProxyAuthSource()?.getUrl() ?? null;
            if (proxyUrl === null) return {};
            try {
              return { proxyHost: new URL(proxyUrl).host };
            } catch {
              return { proxyHost: proxyUrl };
            }
          })(),
        },
        model: args.offering.upstreamSlug,
        whenIso: new Date().toISOString(),
        env: buildEnvironmentSnapshot(),
        outcome: 'failed',
        outcomeDetail: 'stream failed during chat',
      });
      set((s) => {
        const m = new Map(s.diagnostics);
        m.set(args.chatId, report);
        return { diagnostics: m };
      });

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
 * Stream one opener turn into an already-persisted draft persona-message with
 * `kind: 'opener'`. Mirrors `runIntoDraft`'s handle/chunk/finalise patterns but
 * calls `runStreamEngine` directly (no tool loop) and drives the
 * opener-specific success/failure contract.
 *
 * `opts.reroll` distinguishes the initial generation (false) from a
 * regeneration (true). The two paths differ only in their error handling:
 * initial failure deletes the draft and rethrows; reroll keeps it incomplete.
 */
async function runOpenerStream(
  args: OpenerArgs,
  draftMessageId: string,
  set: (fn: (s: StreamManagerStore) => Partial<StreamManagerStore>) => void,
  get: () => StreamManagerStore,
  opts: { reroll: boolean },
): Promise<void> {
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
    reusedDraft: opts.reroll,
    isOpener: true,
  };

  set((s) => {
    const m = new Map(s.streams);
    m.set(args.chatId, handle);
    return { streams: m };
  });

  const onChunk = (chunk: import('@chatsundere/llm-unified').StreamChunk): void => {
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

  const enginePromise = runStreamEngine({
    chat: args.chat,
    persona: args.persona,
    provider: args.provider,
    providerConfig: args.providerConfig,
    apiKey: args.apiKey,
    offering: args.offering,
    priorMessages: [],
    userMessageText: buildOpenerInstruction(args.persona.greetingInstructions),
    reasoning: args.reasoning,
    globalInstructions: args.globalInstructions,
    globalAboutMe: args.globalAboutMe,
    screenEffectsEnabled: args.screenEffectsEnabled,
    job: 'greeting',
    signal: controller.signal,
    onChunk,
  });

  return enginePromise
    .then(async (result) => {
      const current = get().streams.get(args.chatId);
      if (!current) return;

      set((s) => {
        const live = s.streams.get(args.chatId);
        if (!live) return s;
        const m = new Map(s.streams);
        m.set(args.chatId, { ...live, status: 'finalising' });
        return { streams: m };
      });

      const linked = isLinkedForSync();
      await db.transaction('rw', [db.messages, db.chats, db.syncOutbox], async (tx) => {
        await db.messages.update(draftMessageId, {
          contentBlocks: result.finalContentBlocks,
          streamingState: 'complete',
        });
        // Class-1: the opener message is now complete → enqueue it. The chats
        // lastMessageAt/openerPending writes are device-local (§5), not enqueued.
        if (linked) enqueueSync(tx, 'messages', draftMessageId, 'upsert');
        await db.chats.update(args.chatId, {
          lastMessageAt: Date.now(),
          openerPending: false,
        });
      });
      if (linked) scheduleClass1Sync();

      void queryClient.invalidateQueries({ queryKey: ['chats', args.chatId] });
      void queryClient.invalidateQueries({ queryKey: ['chats'] });

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
      const current = get().streams.get(args.chatId);

      if (!opts.reroll) {
        // Initial generation failure path.
        if (!current) {
          // Handle already gone (abortPreserve already cleaned up) — return silently.
          return;
        }
        // Delete the draft row; keep openerPending set (no chat update).
        await db.messages.delete(draftMessageId);
        set((s) => {
          const m = new Map(s.streams);
          m.delete(args.chatId);
          return { streams: m };
        });
        void queryClient.invalidateQueries({ queryKey: ['chats', args.chatId] });
        void queryClient.invalidateQueries({ queryKey: ['chats'] });
        throw err;
      }

      // Reroll failure path: keep partial as incomplete, show toast, no rethrow.
      if (!current) return;

      console.error('[stream-manager] opener re-roll failed for chat', args.chatId, err);

      await db.messages.update(draftMessageId, {
        contentBlocks: current.contentBuffer,
        streamingState: 'incomplete',
      });

      set((s) => {
        const m = new Map(s.streams);
        m.delete(args.chatId);
        return { streams: m };
      });

      void queryClient.invalidateQueries({ queryKey: ['chats', args.chatId] });

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
