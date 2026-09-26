// SPDX-License-Identifier: AGPL-3.0-only
import { type Offering, getOffering, getProvider } from '@chatsundere/llm-unified';
import type { PersonaRow, ProviderRow } from '../boot/client-data-db.js';

/** Why a persona's model can or cannot be composed against (spec 2026-09-26 §3.1). */
export type OfferingResolution =
  | { kind: 'ok'; offering: Offering }
  | { kind: 'provider-unavailable'; templateId: string }
  | { kind: 'model-unknown'; templateId: string; modelId: string };

/** Resolves a persona's offering against this build's catalogue, naming the reason when it fails. */
export function resolveOffering(
  persona: Pick<PersonaRow, 'providerId' | 'modelId'>,
  provider: Pick<ProviderRow, 'templateId' | 'apiKey'> | undefined,
): OfferingResolution {
  const templateId = provider?.templateId ?? persona.providerId;
  // A provider this build has never heard of (synced from a newer client) cannot
  // be set up here at all; only an update can help, so offer that path.
  if (!getProvider(templateId)) {
    return { kind: 'model-unknown', templateId, modelId: persona.modelId };
  }
  // apiKey === null is the synced, reversible "removed" state, not a missing row.
  if (!provider || provider.apiKey === null) {
    return { kind: 'provider-unavailable', templateId };
  }
  const offering = persona.modelId ? getOffering(provider.templateId, persona.modelId) : undefined;
  return offering
    ? { kind: 'ok', offering }
    : { kind: 'model-unknown', templateId: provider.templateId, modelId: persona.modelId };
}
