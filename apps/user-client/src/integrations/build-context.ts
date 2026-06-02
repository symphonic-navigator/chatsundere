// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';
import { getCredentialKey } from '../credentials/credential-bus.js';
import type { IntegrationContext, OfferingRef } from './types.js';

/** The subset of the persona this builder reads. */
interface PersonaNsfw {
  adultPersona: boolean;
}

/** The web-interfacing settings block. */
interface WebSettings {
  search: OfferingRef | null;
  fetch: OfferingRef | null;
}

/**
 * Assemble the per-send IntegrationContext. NSFW comes from the active persona;
 * location is deferred (null today); the web backends come from settings; the
 * key accessor is MasterKey-gated via the credential bus and resolves keys only
 * at call time. `getKeyFn` is injectable for tests (defaults to the real bus).
 */
export function buildIntegrationContext(
  persona: PersonaNsfw,
  web: WebSettings,
  mk: MasterKey | null,
  getKeyFn: (id: string, mk: MasterKey) => Promise<string | null> = getCredentialKey,
): IntegrationContext {
  return {
    nsfwAllowed: persona.adultPersona,
    location: null,
    webSearch: web.search,
    webFetch: web.fetch,
    getKey: (providerTemplateId) => (mk ? getKeyFn(providerTemplateId, mk) : Promise.resolve(null)),
  };
}
