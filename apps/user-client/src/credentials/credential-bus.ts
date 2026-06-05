// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';
import { providerKeySource } from './sources/provider-key-source.js';
import type { CredentialId, CredentialSource } from './types.js';

export interface CredentialBus {
  /** Presence check across all sources (MasterKey-free). */
  hasCredential(id: CredentialId): Promise<boolean>;
  /**
   * Retrieve the plaintext key from the first source that serves `id`
   * (MasterKey-gated). `null` when no source serves it. Propagates a crypto
   * throw from the underlying source on a wrong/absent MasterKey.
   */
  getCredentialKey(id: CredentialId, mk: MasterKey): Promise<string | null>;
}

/**
 * Build a credential bus over an ordered source list. Dispatch is first-match:
 * `hasCredential` is true as soon as a source serves the id; `getCredentialKey`
 * returns the first non-null source result. Exported as a factory so tests can
 * inject fake sources.
 */
export function createCredentialBus(sources: CredentialSource[]): CredentialBus {
  return {
    async hasCredential(id) {
      for (const source of sources) {
        if (await source.has(id)) return true;
      }
      return false;
    },
    async getCredentialKey(id, mk) {
      for (const source of sources) {
        const key = await source.get(id, mk);
        if (key !== null) return key;
      }
      return null;
    },
  };
}

/**
 * The default application bus. Today it carries the single provider-key source;
 * a future standalone-key source is appended here.
 */
const defaultBus = createCredentialBus([providerKeySource]);

/** Presence check via the default bus. MasterKey-free. */
export const hasCredential = (id: CredentialId): Promise<boolean> => defaultBus.hasCredential(id);

/** Retrieval via the default bus. MasterKey-gated. */
export const getCredentialKey = (id: CredentialId, mk: MasterKey): Promise<string | null> =>
  defaultBus.getCredentialKey(id, mk);
