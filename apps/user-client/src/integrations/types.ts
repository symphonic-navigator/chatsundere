// SPDX-License-Identifier: AGPL-3.0-only
import type { ServiceKind, WebLocation } from '@chatsundere/llm-unified';
import type { Tool } from '../tools/types.js';

/** A reference to a specific offering. Offerings have no single id — they are
 *  keyed by their provider + upstream slug (see `getOffering`). */
export interface OfferingRef {
  providerId: string;
  upstreamSlug: string;
}

/** Everything an integration needs to decide which tools to contribute and how
 *  to execute them, assembled per send by the stream-manager. */
export interface IntegrationContext {
  /** Explicit content permitted — from the active persona's adultPersona flag. */
  nsfwAllowed: boolean;
  /** Chatsundere tonality unlocker — from the active persona's chatsundereTonality. */
  tonalityEnabled: boolean;
  /** Global user craft/chat instructions (settings); may be empty. */
  globalInstructions: string;
  /** Optional location hint; shape defined, source deferred (null today). */
  location: WebLocation | null;
  /** Selected web search backend, or null when none chosen. */
  webSearch: OfferingRef | null;
  /** Selected web fetch backend, independently chosen, or null. */
  webFetch: OfferingRef | null;
  /** True when web calls should route through the account's authenticated
   *  proxy (mirrors the server 'proxy' gate); false when they go direct. */
  useProxy: boolean;
  /** The cockpit-selected search tier id, or null (→ the offering's default). */
  webSearchTierId: string | null;
  /** Retrieve a provider's plaintext key at call time — credential-bus,
   *  MasterKey-gated. Returns null when no key / no master key. */
  getKey: (providerTemplateId: string) => Promise<string | null>;
  /** Owner chat for artefacts produced this send. */
  chatId: string;
  /** Active persona id — provenance for produced artefacts. */
  personaId: string;
  /** The persona's LLM offering — the model the author subagent runs. */
  personaOffering: OfferingRef;
  /** The artefact-expert offering to build artefacts with, or null to use the
   *  persona model. Pre-resolved per send: set when a global artefact expert is
   *  configured AND this chat has not opted out; null otherwise. */
  artefactExpert: OfferingRef | null;
}

/** A dynamic, credential-gated capability unit — the counterpart to a static
 *  `Tool`. Identified by capability (a single `ServiceKind`), never by provider:
 *  one integration per capability, into which providers plug. Contributes 0..n
 *  tools depending on runtime configuration. */
export interface Integration {
  readonly id: string;
  readonly capability: ServiceKind;
  /** Active tools for this context; `[]` when the capability is not configured. */
  contributesTools(ctx: IntegrationContext): Tool[];
}
