// SPDX-License-Identifier: AGPL-3.0-only
import { getOffering, getProvider } from '@chatsundere/llm-unified';
import type { Offering, ProviderConfig, ProviderDefinition } from '@chatsundere/llm-unified';
import { useSessionStore } from '@chatsundere/ui-shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import { type ChatRow, type PersonaRow, getClientDataDb } from '../boot/client-data-db.js';
import type { ReasoningState } from '../lib/reasoning-resolver.js';
import { openSecret } from '../lib/secrets.js';
import { useStreamManagerStore } from '../state/stream-manager.store.js';

// ─────────────────────────────────────────────────────────────────────────────
// resolvePersonaContext — shared helper
// ─────────────────────────────────────────────────────────────────────────────

interface PersonaContext {
  chat: ChatRow;
  persona: PersonaRow;
  providerDef: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  offering: Offering;
  globalInstructions: string;
  globalAboutMe: string;
}

/**
 * Resolve the persona → provider → ProviderDefinition → Offering chain for a
 * chat and decrypt its api-key + (optional) CORS-proxy key via the master key.
 * Shared by useSendMessage and useRegenerate. `who` prefixes error messages so
 * the originating hook is identifiable.
 */
async function resolvePersonaContext(chatId: string, who: string): Promise<PersonaContext> {
  const db = getClientDataDb();
  const mk = useSessionStore.getState().mk;
  if (!mk) throw new Error(`${who}: master key unavailable — re-authenticate`);

  const chat = await db.chats.get(chatId);
  if (!chat) throw new Error(`${who}: chat not found`);

  const persona = await db.personas.get(chat.personaId);
  if (!persona) throw new Error(`${who}: persona not found`);

  const provider = await db.providers.get(persona.providerId);
  if (!provider) throw new Error(`${who}: provider not found`);

  const settings = await db.settings.get(1);
  if (!settings) throw new Error(`${who}: settings row missing`);

  const providerDef = getProvider(provider.templateId);
  if (!providerDef) throw new Error(`${who}: unknown provider template "${provider.templateId}"`);

  const offering = getOffering(provider.templateId, persona.modelId);
  if (!offering)
    throw new Error(
      `${who}: no offering for "${persona.modelId}" on provider "${provider.templateId}" — re-pick the model`,
    );

  const apiKey = await openSecret(provider.apiKey, mk, `provider/${provider.id}/api-key`);
  const corsProxyUrl = settings.corsProxy?.url ?? null;
  const corsProxyKey = settings.corsProxy
    ? await openSecret(settings.corsProxy.sharedKey, mk, 'cors-proxy/shared-key')
    : null;

  return {
    chat,
    persona,
    providerDef,
    providerConfig: {
      baseUrl: providerDef.baseUrl,
      routing:
        providerDef.corsHint === 'requires-proxy' ? { kind: 'cors-proxy' } : { kind: 'direct' },
    },
    apiKey,
    corsProxyUrl,
    corsProxyKey,
    offering,
    globalInstructions: settings.globalInstructions,
    globalAboutMe: settings.globalAboutMe,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// useSendMessage
// ─────────────────────────────────────────────────────────────────────────────

export interface SendMessageArgs {
  /** `null` for lazy chats — the hook creates the ChatRow inline. */
  chatId: string | null;
  /** Required when `chatId` is `null`; identifies which persona to use. */
  personaId: string;
  text: string;
  reasoning: ReasoningState;
}

/**
 * Orchestrate the full send-flow:
 *
 * 1. For lazy chats (`chatId === null`): create the ChatRow, snapshotting the
 *    persona's mindspace at the time of first send.
 * 2. Resolve the persona → provider → ProviderDefinition → Offering chain.
 * 3. Decrypt the api-key and (if configured) the CORS-proxy shared key via
 *    `openSecret` using the master key held in `useSessionStore`.
 * 4. Delegate to `useStreamManagerStore.start(...)` for the actual streaming.
 * 5. Return the `chatId` (useful for the lazy-chat navigation redirect).
 *
 * The hook intentionally does NOT clear `draftInput` — that is handled
 * atomically inside `useStreamManagerStore.start` as part of its DB
 * transaction.
 */
export function useSendMessage() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: SendMessageArgs): Promise<string> => {
      const db = getClientDataDb();
      const mk = useSessionStore.getState().mk;
      if (!mk) throw new Error('useSendMessage: master key unavailable — re-authenticate');

      // ── Step 1: Lazy-chat creation ──────────────────────────────────────
      let chatId = args.chatId;
      if (!chatId) {
        const persona = await db.personas.get(args.personaId);
        if (!persona) throw new Error('useSendMessage: persona not found');

        const settings = await db.settings.get(1);
        const resolvedMindspaceId = persona.mindspaceId ?? settings?.defaultMindspaceId;
        if (!resolvedMindspaceId) throw new Error('useSendMessage: no mindspace to snapshot');

        chatId = uuidv7();
        const now = Date.now();
        await db.chats.add({
          id: chatId,
          personaId: args.personaId,
          title: null,
          resolvedMindspaceId,
          createdAt: now,
          lastMessageAt: now,
          bookmarkedMessageCount: 0,
          draftInput: '',
        });
      }

      // ── Resolve persona chain + decrypt secrets ─────────────────────────
      const ctx = await resolvePersonaContext(chatId, 'useSendMessage');

      // ── Fetch prior messages and hand off to stream-manager ─────────────
      const priorMessages = await db.messages.where('chatId').equals(chatId).sortBy('createdAt');

      await useStreamManagerStore.getState().start({
        chatId,
        userText: args.text,
        chat: ctx.chat,
        persona: ctx.persona,
        provider: ctx.providerDef,
        // Per Decision 22: baseUrl + routing are derived from the static
        // ProviderDefinition, not from the persisted ProviderRow (which only
        // stores templateId, apiKey and the enabled flag authoritatively).
        providerConfig: ctx.providerConfig,
        apiKey: ctx.apiKey,
        corsProxyUrl: ctx.corsProxyUrl,
        corsProxyKey: ctx.corsProxyKey,
        offering: ctx.offering,
        priorMessages,
        userMessageText: args.text,
        reasoning: args.reasoning,
        globalInstructions: ctx.globalInstructions,
        globalAboutMe: ctx.globalAboutMe,
      });

      return chatId;
    },

    onSuccess: (chatId) => {
      void qc.invalidateQueries({ queryKey: ['chats', chatId] });
      void qc.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// useRegenerate — non-destructive re-roll of the last persona answer
// ─────────────────────────────────────────────────────────────────────────────

export interface RegenerateArgs {
  chatId: string;
  reasoning: ReasoningState;
}

/**
 * Re-roll the last persona response without touching the user message:
 *
 * 1. Abort any live stream for the chat (discard its draft).
 * 2. Find the last complete persona message `T` (the answer to re-roll) and the
 *    last user message before it (the prompt to replay). No `T` → no-op (throw).
 * 3. Build the wire context: priorMessages = everything before that user
 *    message; userMessageText = that user message's text. The old answer `T`
 *    is excluded, so the model answers as if the prompt were new.
 * 4. Delegate to `stream-manager.regenerate`, which clears `T` and streams the
 *    fresh answer into it. On failure `T` stays incomplete → the existing
 *    StreamInterruptedFooter offers Retry. The user message is never at risk.
 */
export function useRegenerate() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: RegenerateArgs): Promise<void> => {
      const db = getClientDataDb();

      // Abort any live stream for this chat.
      const mgr = useStreamManagerStore.getState();
      if (mgr.has(args.chatId)) await mgr.abortDiscard(args.chatId);

      // Locate the answer to re-roll + the prompt to replay.
      const msgs = await db.messages.where('chatId').equals(args.chatId).sortBy('createdAt');
      const target = [...msgs]
        .reverse()
        .find((m) => m.role === 'persona' && m.streamingState === 'complete');
      if (!target) throw new Error('useRegenerate: no last persona message');

      const lastUser = [...msgs]
        .reverse()
        .find((m) => m.role === 'user' && m.createdAt < target.createdAt);
      if (!lastUser) throw new Error('useRegenerate: no prior user-message');
      const userMessageText = lastUser.contentBlocks
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('');

      // Prior context excludes that user message and everything after it.
      const priorMessages = msgs.filter((m) => m.createdAt < lastUser.createdAt);

      // Resolve persona chain + decrypt, then re-roll.
      const ctx = await resolvePersonaContext(args.chatId, 'useRegenerate');

      await useStreamManagerStore.getState().regenerate({
        chatId: args.chatId,
        targetMessageId: target.id,
        userText: userMessageText,
        chat: ctx.chat,
        persona: ctx.persona,
        provider: ctx.providerDef,
        providerConfig: ctx.providerConfig,
        apiKey: ctx.apiKey,
        corsProxyUrl: ctx.corsProxyUrl,
        corsProxyKey: ctx.corsProxyKey,
        offering: ctx.offering,
        priorMessages,
        userMessageText,
        reasoning: args.reasoning,
        globalInstructions: ctx.globalInstructions,
        globalAboutMe: ctx.globalAboutMe,
      });
    },

    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['chats', vars.chatId] });
    },
  });
}
