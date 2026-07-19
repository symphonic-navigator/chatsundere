// SPDX-License-Identifier: AGPL-3.0-only
import { getOffering, getProvider } from '@chatsundere/llm-unified';
import { useSessionStore } from '@chatsundere/ui-shared';
import { type PersonaRow, getClientDataDb } from '../boot/client-data-db.js';
import { providerApiKeySlot } from '../data/providers.js';
import { resolveBackgroundBundle } from '../data/resolve-background-offering.js';
import { openSecret } from '../lib/secrets.js';
import type { MemoryConsolidationArgs, MemoryPipelineArgs } from './pipeline.js';

type Db = ReturnType<typeof getClientDataDb>;
type MasterKey = NonNullable<ReturnType<typeof useSessionStore.getState>['mk']>;

/**
 * Resolve the model/credential bundle for a persona's background memory action —
 * provider, offering, decrypted API key, and the background-helper swap. Shared
 * by both the chat-based and persona-based entry points. `who` prefixes errors.
 */
async function resolvePersonaBundle(
  persona: PersonaRow,
  who: string,
  db: Db,
  mk: MasterKey,
): Promise<Omit<MemoryPipelineArgs, 'persona' | 'chat'>> {
  const provider = await db.providers.get(persona.providerId);
  if (!provider) throw new Error(`${who}: provider not found`);

  const providerDef = getProvider(provider.templateId);
  if (!providerDef) throw new Error(`${who}: unknown provider template "${provider.templateId}"`);

  const offering = getOffering(provider.templateId, persona.modelId);
  if (!offering)
    throw new Error(
      `${who}: no offering for "${persona.modelId}" on provider "${provider.templateId}" — re-pick the model`,
    );

  const apiKey = await openSecret(provider.apiKey, mk, providerApiKeySlot(provider));

  // Manual memory runs on the persona's background helper when set + reachable,
  // else the persona's own model (silent fallback — same as the auto pipeline).
  return resolveBackgroundBundle(
    persona,
    {
      provider: providerDef,
      providerConfig: {
        baseUrl: providerDef.baseUrl,
        routing:
          providerDef.corsHint === 'requires-proxy' ? { kind: 'cors-proxy' } : { kind: 'direct' },
      },
      apiKey,
      offering,
    },
    { db, mk },
  );
}

/**
 * Resolve args for a chat-scoped memory action (extraction). Loads the chat to
 * reach its persona, then the persona's model bundle.
 */
export async function resolveMemoryPipelineArgs(
  chatId: string,
  who: string,
): Promise<MemoryPipelineArgs> {
  const db = getClientDataDb();
  const mk = useSessionStore.getState().mk;
  if (!mk) throw new Error(`${who}: master key unavailable — re-authenticate`);

  const chat = await db.chats.get(chatId);
  if (!chat) throw new Error(`${who}: chat not found`);

  const persona = await db.personas.get(chat.personaId);
  if (!persona) throw new Error(`${who}: persona not found`);

  const bundle = await resolvePersonaBundle(persona, who, db, mk);
  return { persona, chat, ...bundle };
}

/**
 * Resolve args for a persona-scoped consolidation (dreaming). Loads the persona
 * directly — no chat needed — so "Consolidate now" is reachable from the hub.
 */
export async function resolveMemoryConsolidationArgs(
  personaId: string,
  who: string,
): Promise<MemoryConsolidationArgs> {
  const db = getClientDataDb();
  const mk = useSessionStore.getState().mk;
  if (!mk) throw new Error(`${who}: master key unavailable — re-authenticate`);

  const persona = await db.personas.get(personaId);
  if (!persona) throw new Error(`${who}: persona not found`);

  const bundle = await resolvePersonaBundle(persona, who, db, mk);
  return { persona, ...bundle };
}
