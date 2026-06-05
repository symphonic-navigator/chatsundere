// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';

/**
 * Abstract credential identity. For provider-backed credentials this equals
 * the provider's `templateId` (e.g. 'nano-gpt'). The bus encapsulates which
 * source ultimately serves the id.
 */
export type CredentialId = string;

/**
 * A source of credentials the bus can query. The provider-key source is the
 * only implementation today; a standalone-key source (e.g. a LAN actuator key
 * with no LLM provider behind it) is the documented future extension and is
 * appended to the bus's source list without changing the bus or consumers.
 */
export interface CredentialSource {
  /** Stable discriminator, e.g. 'provider-key'. */
  readonly kind: string;
  /** Presence check — MasterKey-free. `true` iff this source serves `id`. */
  has(id: CredentialId): Promise<boolean>;
  /**
   * Retrieve the plaintext key — MasterKey-gated. Returns `null` if this
   * source does not serve `id`. Throws if the MasterKey is wrong/absent
   * (the AES-GCM auth tag fails).
   */
  get(id: CredentialId, mk: MasterKey): Promise<string | null>;
}

/** Reactive presence snapshot returned by the `useCredential` hook. */
export interface CredentialPresence {
  present: boolean;
  isLoading: boolean;
}
