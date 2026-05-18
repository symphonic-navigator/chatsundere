// SPDX-License-Identifier: LGPL-3.0-only

import { hkdfSha256 } from './primitives/kdf.js';
import { type DEK, type MasterKey, asDek } from './types.js';

const INFO_BASE = 'chatsundere-dek-v1::';

/**
 * Derive a per-context Data Encryption Key from the Master Key. Contexts
 * are application-defined strings — e.g., `vault/conversations`,
 * `vault/personas`, `prefs`. Each context yields a distinct DEK; DEKs are
 * never persisted, always re-derived on demand.
 */
export async function deriveDek(mk: MasterKey, context: string): Promise<DEK> {
  if (context.length === 0) throw new Error('context must be non-empty');
  const bytes = await hkdfSha256(mk, new Uint8Array(), `${INFO_BASE}${context}`);
  return asDek(bytes);
}
