// SPDX-License-Identifier: AGPL-3.0-only
import { getOffering, getProvider } from '@chatsundere/llm-unified';
import { useSessionStore } from '@chatsundere/ui-shared';
import { getClientDataDb } from '../boot/client-data-db.js';
import { openSecret } from '../lib/secrets.js';
import type { MemoryPipelineArgs } from './pipeline.js';

/**
 * Resolve ONLY the credential/offering subset needed for a background memory
 * action. A focused counterpart to send-message.ts's resolvePersonaContext —
 * memory needs no knowledge/expert/image/MCP context.
 *
 * Import sources verified against src/data/send-message.ts:
 *   openSecret      → ../lib/secrets.js
 *   useSessionStore → @chatsundere/ui-shared
 *   getProvider     → @chatsundere/llm-unified
 *   getOffering     → @chatsundere/llm-unified
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
    persona,
    chat,
    provider: providerDef,
    providerConfig: {
      baseUrl: providerDef.baseUrl,
      routing:
        providerDef.corsHint === 'requires-proxy' ? { kind: 'cors-proxy' } : { kind: 'direct' },
    },
    apiKey,
    corsProxyUrl,
    corsProxyKey,
    offering,
  };
}
