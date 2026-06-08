// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';
import { getCanonical, getOffering, getProvider, offeringToTarget } from '@chatsundere/llm-unified';
import type {
  Offering,
  OneShotArgs,
  ProviderConfig,
  ProviderDefinition,
  ReasoningIntent,
} from '@chatsundere/llm-unified';
import { useSessionStore } from '@chatsundere/ui-shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import {
  type ChatRow,
  type MessageRow,
  type PersonaRow,
  type PillRow,
  getClientDataDb,
} from '../boot/client-data-db.js';
import type { OfferingRef } from '../integrations/types.js';
import { buildKnowledgeContext } from '../knowledge/knowledge-context.js';
import { buildLoreContext } from '../knowledge/lore-context.js';
import { KNOWLEDGE_LORE_OPTS } from '../knowledge/lore.js';
import { type ReasoningState, maxReasoningIntent } from '../lib/reasoning-resolver.js';
import { openSecret } from '../lib/secrets.js';
import { usableTemplateIds } from '../lib/usable-providers.js';
import { webBackendOptions } from '../lib/web-backend-options.js';
import { resolveWebBackend } from '../lib/web-backends.js';
import { useStreamManagerStore } from '../state/stream-manager.store.js';
import type { ExpertBase } from '../tools/ask-expert.js';

// ─────────────────────────────────────────────────────────────────────────────
// lastCompanionText — lorebook companion-scan helper
// ─────────────────────────────────────────────────────────────────────────────

/** The most recent complete persona message's text, or null. Used as the
 *  optional companion scan-source for lorebooks (only docs that opt in see it). */
export function lastCompanionText(messages: readonly MessageRow[]): string | null {
  const last = [...messages]
    .reverse()
    .find((m) => m.role === 'persona' && m.streamingState === 'complete');
  if (!last) return null;
  const text = last.contentBlocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return text === '' ? null : text;
}

/** The kb-injection pill payload shape this reader depends on (PillRow.payload is `unknown`). */
type KbInjectionPayload = { entries?: { documentId?: string }[] };

/** Document ids injected by the given kb-injection pills — the lore-cooldown
 *  history. Non-kb-injection pills and entries without a documentId are ignored. */
export function injectedDocIdsFromPills(pills: readonly PillRow[]): Set<string> {
  const ids = new Set<string>();
  for (const pill of pills) {
    if (pill.kind !== 'kb-injection') continue;
    const entries = (pill.payload as KbInjectionPayload | undefined)?.entries ?? [];
    for (const entry of entries) {
      if (entry.documentId) ids.add(entry.documentId);
    }
  }
  return ids;
}

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
  webInterfacing: { search: OfferingRef | null; fetch: OfferingRef | null };
  knowledge: import('../knowledge/query-tool.js').KnowledgeContext | null;
  expertBase: ExpertBase | null;
  expertModelLabel: string | null;
  expertReasoning: ReasoningIntent | null;
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

  const allProviders = await db.providers.toArray();
  const hasProxy = settings.corsProxy != null;
  const webOptions = webBackendOptions(usableTemplateIds(allProviders, hasProxy), hasProxy);
  const webInterfacing = {
    search: resolveWebBackend(settings.webInterfacing?.search ?? null, webOptions, 'search'),
    fetch: resolveWebBackend(settings.webInterfacing?.fetch ?? null, webOptions, 'fetch'),
  };

  const knowledge = await buildKnowledgeContext(persona, chat);

  const expert = await resolveExpert(settings.expertModel ?? null, mk, corsProxyUrl, corsProxyKey);

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
    webInterfacing,
    knowledge,
    expertBase: expert?.base ?? null,
    expertModelLabel: expert?.modelLabel ?? null,
    expertReasoning: expert?.reasoning ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveSubstituteVision — one-shot call context for the global substitute model
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the global substitute-vision model (`settings.substituteVisionModel`,
 * a "providerTemplateId:upstreamSlug" ref) into a one-shot call context: its
 * ProviderDefinition, decrypted api-key (via the MasterKey, same path as the
 * active model), the shared CORS proxy, and the completion target. Returns
 * `null` when no substitute is configured or it cannot be resolved (no enabled
 * provider row / unknown offering) — the send then falls back to placeholders.
 *
 * Decryption happens HERE (not in the store) because only the send path holds
 * the MasterKey; the stream-manager never touches crypto.
 */
async function resolveSubstituteVision(
  ref: string | null,
  mk: MasterKey,
  corsProxyUrl: string | null,
  corsProxyKey: string | null,
): Promise<Omit<OneShotArgs, 'messages' | 'bodyExtras'> | null> {
  if (!ref) return null;
  const idx = ref.indexOf(':');
  if (idx < 0) return null;
  const templateId = ref.slice(0, idx);
  const slug = ref.slice(idx + 1);

  const providerDef = getProvider(templateId);
  const offering = getOffering(templateId, slug);
  if (!providerDef || !offering) return null;

  const db = getClientDataDb();
  const providerRow = (await db.providers.where('templateId').equals(templateId).toArray()).find(
    (p) => p.enabled,
  );
  if (!providerRow) return null;

  let apiKey: string;
  try {
    apiKey = await openSecret(providerRow.apiKey, mk, `provider/${providerRow.id}/api-key`);
  } catch {
    // Corrupt ciphertext (e.g. AES-GCM auth-tag failure) — degrade to no substitute
    // so a text-only send is never blocked by a broken substitute-vision key.
    console.warn('resolveSubstituteVision: failed to decrypt api-key — falling back to null');
    return null;
  }

  return {
    provider: providerDef,
    providerConfig: {
      baseUrl: providerDef.baseUrl,
      routing:
        providerDef.corsHint === 'requires-proxy' ? { kind: 'cors-proxy' } : { kind: 'direct' },
    },
    apiKey,
    corsProxyUrl,
    corsProxyKey,
    target: offeringToTarget(offering),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveExpert — streaming call context for the global expert model
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the global expert model (`settings.expertModel`, a
 * "templateId:upstreamSlug" ref) into the ask_expert tool's streaming call
 * base, its display label, and its MAX reasoning intent. Returns `null` when
 * unconfigured or unresolvable (no enabled provider row / unknown offering /
 * corrupt key) — the tool is simply not offered. Decryption happens here (the
 * send path holds the MasterKey).
 *
 * The model label is taken from the canonical registry
 * (`getCanonical(offering.canonicalRef)?.displayName`) with the upstream slug
 * as a fallback, since `Offering` carries no display name of its own.
 */
export async function resolveExpert(
  ref: string | null,
  mk: MasterKey,
  corsProxyUrl: string | null,
  corsProxyKey: string | null,
): Promise<{ base: ExpertBase; modelLabel: string; reasoning: ReasoningIntent } | null> {
  if (!ref) return null;
  const idx = ref.indexOf(':');
  if (idx < 0) return null;
  const templateId = ref.slice(0, idx);
  const slug = ref.slice(idx + 1);

  const providerDef = getProvider(templateId);
  const offering = getOffering(templateId, slug);
  if (!providerDef || !offering) return null;

  const db = getClientDataDb();
  const providerRow = (await db.providers.where('templateId').equals(templateId).toArray()).find(
    (p) => p.enabled,
  );
  if (!providerRow) return null;

  let apiKey: string;
  try {
    apiKey = await openSecret(providerRow.apiKey, mk, `provider/${providerRow.id}/api-key`);
  } catch {
    console.warn('resolveExpert: failed to decrypt api-key — falling back to null');
    return null;
  }

  const modelLabel =
    getCanonical(offering.canonicalRef ?? '')?.displayName ?? offering.upstreamSlug;

  return {
    base: {
      provider: providerDef,
      providerConfig: {
        baseUrl: providerDef.baseUrl,
        routing:
          providerDef.corsHint === 'requires-proxy' ? { kind: 'cors-proxy' } : { kind: 'direct' },
      },
      apiKey,
      corsProxyUrl,
      corsProxyKey,
      target: offeringToTarget(offering),
    },
    modelLabel,
    reasoning: maxReasoningIntent(offering.profile.reasoning),
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
          libraryIds: [],
        });
      }

      // ── Resolve persona chain + decrypt secrets ─────────────────────────
      const ctx = await resolvePersonaContext(chatId, 'useSendMessage');

      // ── Fetch prior messages and hand off to stream-manager ─────────────
      const priorMessages = await db.messages.where('chatId').equals(chatId).sortBy('createdAt');

      // Resolve the global substitute-vision model's call context (if any) so the
      // store can route images through it when the active model cannot see them.
      const settings = await db.settings.get(1);
      const substituteVisionModel = settings?.substituteVisionModel ?? null;
      const substituteOneShotBase = await resolveSubstituteVision(
        substituteVisionModel,
        mk,
        ctx.corsProxyUrl,
        ctx.corsProxyKey,
      );

      const recentPersonaIds = priorMessages
        .filter((m) => m.role === 'persona')
        .slice(-KNOWLEDGE_LORE_OPTS.cooldownRounds)
        .map((m) => m.id);
      const recentPills = recentPersonaIds.length
        ? await db.pills.where('messageId').anyOf(recentPersonaIds).toArray()
        : [];
      const lore = await buildLoreContext(
        ctx.persona,
        ctx.chat,
        args.text,
        lastCompanionText(priorMessages),
        injectedDocIdsFromPills(recentPills),
      );

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
        webInterfacing: ctx.webInterfacing,
        knowledge: ctx.knowledge,
        loreContext: lore?.loreContext ?? '',
        lore: lore?.lore ?? null,
        substituteVisionModel,
        substituteOneShotBase: substituteOneShotBase ?? undefined,
        expertBase: ctx.expertBase ?? undefined,
        expertModelLabel: ctx.expertModelLabel ?? undefined,
        expertReasoning: ctx.expertReasoning ?? undefined,
      });

      return chatId;
    },

    onSuccess: (chatId) => {
      void qc.invalidateQueries({ queryKey: ['chats', chatId] });
      void qc.invalidateQueries({ queryKey: ['chats'] });
      // The pending attachments were bound to the just-sent message (and any
      // lazy-mode '' orphans were re-homed), so clear the cockpit strip. The
      // prefix covers both the real chat id and the lazy '' key.
      void qc.invalidateQueries({ queryKey: ['attachments', 'pending'] });
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

      const recentPersonaIds = priorMessages
        .filter((m) => m.role === 'persona')
        .slice(-KNOWLEDGE_LORE_OPTS.cooldownRounds)
        .map((m) => m.id);
      const recentPills = recentPersonaIds.length
        ? await db.pills.where('messageId').anyOf(recentPersonaIds).toArray()
        : [];
      const lore = await buildLoreContext(
        ctx.persona,
        ctx.chat,
        userMessageText,
        lastCompanionText(priorMessages),
        injectedDocIdsFromPills(recentPills),
      );

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
        webInterfacing: ctx.webInterfacing,
        knowledge: ctx.knowledge,
        loreContext: lore?.loreContext ?? '',
        lore: lore?.lore ?? null,
        expertBase: ctx.expertBase ?? undefined,
        expertModelLabel: ctx.expertModelLabel ?? undefined,
        expertReasoning: ctx.expertReasoning ?? undefined,
      });
    },

    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['chats', vars.chatId] });
    },
  });
}
