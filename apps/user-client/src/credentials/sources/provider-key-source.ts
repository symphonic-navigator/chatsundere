// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';
import { type ProviderRow, getClientDataDb } from '../../boot/client-data-db.js';
import { providerApiKeySlot } from '../../data/providers.js';
import { openSecret } from '../../lib/secrets.js';
import type { CredentialId, CredentialSource } from '../types.js';

/**
 * Find the first enabled provider row whose `templateId` equals the credential
 * id. `templateId` is indexed; `enabled` is filtered in memory. Returns
 * `undefined` when none match. First-match is deterministic over Dexie order;
 * duplicate enabled rows for one `templateId` should not occur.
 */
async function findEnabledRow(id: CredentialId): Promise<ProviderRow | undefined> {
  return await getClientDataDb()
    .providers.where('templateId')
    .equals(id)
    .filter((row) => row.enabled)
    .first();
}

/**
 * The provider-backed credential source: passes through the API keys the user
 * already entered as LLM providers. Presence requires an enabled row (per the
 * spec's `enabled`-gating decision); retrieval opens the sealed `apiKey` using
 * the same slot the chat path uses (`provider/<rowId>/api-key`).
 *
 * A disabled row is treated as absent: both `has` and `get` collapse the
 * "no matching row" and "row exists but disabled" cases to `false`/`null`.
 */
export const providerKeySource: CredentialSource = {
  kind: 'provider-key',

  async has(id: CredentialId): Promise<boolean> {
    return (await findEnabledRow(id)) !== undefined;
  },

  async get(id: CredentialId, mk: MasterKey): Promise<string | null> {
    const row = await findEnabledRow(id);
    if (!row) return null;
    return await openSecret(row.apiKey, mk, providerApiKeySlot(row));
  },
};
