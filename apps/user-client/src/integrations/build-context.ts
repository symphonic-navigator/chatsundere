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

/** Call-time routing metadata: whether proxy routing is available and the
 *  cockpit-selected search tier. Assembled by the stream-manager from the
 *  server gate and cockpit settings, then forwarded to the integration context. */
export interface IntegrationRoute {
  useProxy: boolean;
  webSearchTierId: string | null;
}

/** Owner chat + persona + offering context for artefact authoring, assembled
 *  per send by the stream-manager and passed into the integration context. */
export interface ArtefactTarget {
  chatId: string;
  personaId: string;
  personaOffering: OfferingRef;
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
  route: IntegrationRoute,
  artefact: ArtefactTarget,
  getKeyFn: (id: string, mk: MasterKey) => Promise<string | null> = getCredentialKey,
): IntegrationContext {
  return {
    nsfwAllowed: persona.adultPersona,
    location: null,
    webSearch: web.search,
    webFetch: web.fetch,
    useProxy: route.useProxy,
    webSearchTierId: route.webSearchTierId,
    chatId: artefact.chatId,
    personaId: artefact.personaId,
    personaOffering: artefact.personaOffering,
    getKey: (id) => (mk ? getKeyFn(id, mk) : Promise.resolve(null)),
  };
}
