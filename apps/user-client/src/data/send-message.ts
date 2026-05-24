// SPDX-License-Identifier: AGPL-3.0-only
import { getProvider } from '@chatsundere/llm-unified';
import { useSessionStore } from '@chatsundere/ui-shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import { getClientDataDb } from '../boot/client-data-db.js';
import type { ReasoningState } from '../lib/reasoning-resolver.js';
import { openSecret } from '../lib/secrets.js';
import { useStreamManagerStore } from '../state/stream-manager.store.js';

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
 * 2. Resolve the persona → provider → ProviderDefinition → KnownModel chain.
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

      // ── Step 2: Resolve persona → provider → model chain ────────────────
      const chat = await db.chats.get(chatId);
      if (!chat) throw new Error('useSendMessage: chat vanished after creation');

      const persona = await db.personas.get(chat.personaId);
      if (!persona) throw new Error('useSendMessage: persona not found');

      const provider = await db.providers.get(persona.providerId);
      if (!provider) throw new Error('useSendMessage: provider not found');

      const settings = await db.settings.get(1);
      if (!settings) throw new Error('useSendMessage: settings row missing');

      const providerDef = getProvider(provider.templateId);
      if (!providerDef)
        throw new Error(`useSendMessage: unknown provider template "${provider.templateId}"`);

      const model = providerDef.knownModels.find((m) => m.id === persona.modelId);
      if (!model)
        throw new Error(
          `useSendMessage: model "${persona.modelId}" not found in provider "${provider.templateId}"`,
        );

      // ── Step 3: Decrypt secrets ─────────────────────────────────────────
      const apiKey = await openSecret(provider.apiKey, mk, `provider/${provider.id}/api-key`);

      const corsProxyUrl = settings.corsProxy?.url ?? null;
      const corsProxyKey = settings.corsProxy
        ? await openSecret(settings.corsProxy.sharedKey, mk, 'cors-proxy/shared-key')
        : null;

      // ── Step 4: Fetch prior messages and hand off to stream-manager ──────
      const priorMessages = await db.messages.where('chatId').equals(chatId).sortBy('createdAt');

      await useStreamManagerStore.getState().start({
        chatId,
        userText: args.text,
        chat,
        persona,
        provider: providerDef,
        providerConfig: { baseUrl: provider.baseUrl, routing: provider.routing },
        apiKey,
        corsProxyUrl,
        corsProxyKey,
        model,
        priorMessages,
        userMessageText: args.text,
        reasoning: args.reasoning,
        globalUnlocker: settings.globalUnlockerPrompt,
        globalAboutMe: settings.globalAboutMe,
      });

      // ── Step 5: Return chatId ────────────────────────────────────────────
      return chatId;
    },

    onSuccess: (chatId) => {
      void qc.invalidateQueries({ queryKey: ['chat', chatId] });
      void qc.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// useRegenerate
// ─────────────────────────────────────────────────────────────────────────────

export interface RegenerateArgs {
  chatId: string;
  reasoning: ReasoningState;
}

/**
 * Regenerate the last persona response by:
 *
 * 1. Aborting any live stream for the chat (discard the draft).
 * 2. Finding the last user-message to obtain the original prompt text.
 * 3. Deleting the last user-message and every message after it (the
 *    stale persona response).
 * 4. Re-delegating to `useStreamManagerStore.start`, which inserts a
 *    fresh user-message + draft persona-message and opens a new stream.
 *
 * The stream-manager remains unmodified — no `reuseUserMessage` flag
 * needed. Subtractive deletion keeps the implementation simple.
 */
export function useRegenerate() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: RegenerateArgs): Promise<void> => {
      const db = getClientDataDb();

      // ── Step 1: Abort any live stream for this chat ──────────────────────
      const mgr = useStreamManagerStore.getState();
      if (mgr.has(args.chatId)) await mgr.abortDiscard(args.chatId);

      // ── Step 2: Find the last user-message — its text is the prompt to replay ──
      const msgs = await db.messages.where('chatId').equals(args.chatId).sortBy('createdAt');
      const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
      if (!lastUser) throw new Error('useRegenerate: no prior user-message');
      const text = lastUser.contentBlocks
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('');

      // ── Step 3: Delete the last user-message + everything after it ───────
      const toDelete = msgs.filter((m) => m.createdAt >= lastUser.createdAt).map((m) => m.id);
      await db.messages.bulkDelete(toDelete);

      // ── Step 4: Resolve the provider chain, decrypt secrets, re-send ─────
      const chat = await db.chats.get(args.chatId);
      if (!chat) throw new Error('useRegenerate: chat vanished');

      const persona = await db.personas.get(chat.personaId);
      if (!persona) throw new Error('useRegenerate: persona vanished');

      const provider = await db.providers.get(persona.providerId);
      if (!provider) throw new Error('useRegenerate: provider vanished');

      const settings = await db.settings.get(1);
      if (!settings) throw new Error('useRegenerate: settings vanished');

      const providerDef = getProvider(provider.templateId);
      if (!providerDef)
        throw new Error(`useRegenerate: unknown provider template "${provider.templateId}"`);

      const model = providerDef.knownModels.find((m) => m.id === persona.modelId);
      if (!model)
        throw new Error(
          `useRegenerate: model "${persona.modelId}" not found in provider "${provider.templateId}"`,
        );

      const mk = useSessionStore.getState().mk;
      if (!mk) throw new Error('useRegenerate: master key unavailable — re-authenticate');

      const apiKey = await openSecret(provider.apiKey, mk, `provider/${provider.id}/api-key`);

      const corsProxyUrl = settings.corsProxy?.url ?? null;
      const corsProxyKey = settings.corsProxy
        ? await openSecret(settings.corsProxy.sharedKey, mk, 'cors-proxy/shared-key')
        : null;

      // Prior messages are now the cleaned history (without the deleted exchange).
      const priorMessages = await db.messages
        .where('chatId')
        .equals(args.chatId)
        .sortBy('createdAt');

      await useStreamManagerStore.getState().start({
        chatId: args.chatId,
        userText: text,
        chat,
        persona,
        provider: providerDef,
        providerConfig: { baseUrl: provider.baseUrl, routing: provider.routing },
        apiKey,
        corsProxyUrl,
        corsProxyKey,
        model,
        priorMessages,
        userMessageText: text,
        reasoning: args.reasoning,
        globalUnlocker: settings.globalUnlockerPrompt,
        globalAboutMe: settings.globalAboutMe,
      });
    },

    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['chat', vars.chatId] });
    },
  });
}
