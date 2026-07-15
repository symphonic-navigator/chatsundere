// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';
import {
  type Offering,
  type ProviderConfig,
  type ProviderDefinition,
  getOffering,
  getProvider,
} from '@chatsundere/llm-unified';
import { type ClientDataDb, type PersonaRow, getClientDataDb } from '../boot/client-data-db.js';
import { openSecret } from '../lib/secrets.js';
import { providerApiKeySlot } from './providers.js';

/**
 * The full call bundle a background chore (title generation, memory, compaction)
 * needs to invoke a model: provider definition, routing config, decrypted
 * api-key, and offering. A subset of what {@link resolvePersonaContext}
 * assembles for the interactive send.
 */
export interface ChoreCallBundle {
  provider: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  offering: Offering;
}

/** The three tuple fields naming a persona's background helper. */
type HelperRef = Pick<
  PersonaRow,
  'backgroundCanonicalId' | 'backgroundProviderId' | 'backgroundModelId'
>;

/**
 * Whether a persona has a background helper actually configured (all three
 * tuple fields present). Absence ⇒ the persona's own model runs the chores.
 */
export function hasBackgroundHelper(persona: HelperRef): boolean {
  return Boolean(
    persona.backgroundCanonicalId && persona.backgroundProviderId && persona.backgroundModelId,
  );
}

function routingFor(providerDef: ProviderDefinition): ProviderConfig {
  return {
    baseUrl: providerDef.baseUrl,
    routing:
      providerDef.corsHint === 'requires-proxy' ? { kind: 'cors-proxy' } : { kind: 'direct' },
  };
}

/**
 * The call bundle that should run a persona's unattended background chores: the
 * background helper when one is set AND reachable, else the persona's own bundle
 * (`fallback`).
 *
 * Background chores are best-effort and invisible, so any resolution failure —
 * helper unset, its provider row deleted, its offering gone, or a key that will
 * not decrypt — degrades **silently** to the persona's own model rather than
 * surfacing an error on a chore the user never sees. The flagged-main-model
 * warning (persona hub) is where the user is nudged; a chore is never the place
 * to raise an alarm.
 */
export async function resolveBackgroundBundle(
  persona: HelperRef,
  fallback: ChoreCallBundle,
  ctx: { db?: ClientDataDb; mk: MasterKey },
): Promise<ChoreCallBundle> {
  if (!hasBackgroundHelper(persona)) return fallback;
  const db = ctx.db ?? getClientDataDb();
  // hasBackgroundHelper guarantees these are non-empty strings.
  const providerRowId = persona.backgroundProviderId as string;
  const upstreamSlug = persona.backgroundModelId as string;

  try {
    const row = await db.providers.get(providerRowId);
    if (!row) return fallback;
    const providerDef = getProvider(row.templateId);
    if (!providerDef) return fallback;
    const offering = getOffering(row.templateId, upstreamSlug);
    if (!offering) return fallback;
    const apiKey = await openSecret(row.apiKey, ctx.mk, providerApiKeySlot(row));
    return { provider: providerDef, providerConfig: routingFor(providerDef), apiKey, offering };
  } catch {
    return fallback;
  }
}
