// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';
import type { ProviderRow } from '../boot/client-data-db.js';
import type { EncryptedBlob } from '../lib/secrets.js';
import { openSecret } from '../lib/secrets.js';
import { providerApiKeySlot } from './providers.js';

/**
 * The persona's provider key is stored but can't be opened with the session's
 * master key (typically sealed under an earlier one). Carries only the template
 * id and the provider's display name: never key material, ciphertext or the
 * underlying WebCrypto error, so it is safe to render and to log.
 */
export class ProviderKeyLockedError extends Error {
  override readonly name = 'ProviderKeyLockedError';
  readonly templateId: string;
  readonly providerName: string;

  constructor(templateId: string, providerName: string) {
    super(`The saved key for ${providerName} can't be opened`);
    this.templateId = templateId;
    this.providerName = providerName;
  }
}

/** The session holds no master key, so no stored key can be opened until the passphrase is entered again. */
export class MasterKeyUnavailableError extends Error {
  override readonly name = 'MasterKeyUnavailableError';

  constructor(who: string) {
    super(`${who}: master key unavailable — re-authenticate`);
  }
}

/**
 * Open a persona's provider key, mapping any failure of `openSecret` (and only
 * that call) to {@link ProviderKeyLockedError}. The original error is dropped on
 * purpose: its internals must not travel into UI state or logs.
 */
export async function openProviderKey(
  provider: Pick<ProviderRow, 'id' | 'keySlot' | 'templateId'> & { apiKey: EncryptedBlob },
  providerName: string,
  mk: MasterKey,
): Promise<string> {
  try {
    return await openSecret(provider.apiKey, mk, providerApiKeySlot(provider));
  } catch {
    throw new ProviderKeyLockedError(provider.templateId, providerName);
  }
}

/** Why a send, opener, regenerate or memory action was stopped before any request was built. */
export type SendBlock =
  | { kind: 'key-locked'; templateId: string; providerName: string }
  | { kind: 'passphrase' };

/** Map a rejection to a {@link SendBlock}, or null for any other error (which keeps its old path). */
export function sendBlockOf(e: unknown): SendBlock | null {
  if (e instanceof ProviderKeyLockedError) {
    return { kind: 'key-locked', templateId: e.templateId, providerName: e.providerName };
  }
  if (e instanceof MasterKeyUnavailableError) return { kind: 'passphrase' };
  return null;
}

/** The sentence and the one action a {@link SendBlock} shows. */
export interface SendBlockNote {
  message: string;
  actionLabel: string;
  /** In-app path; carries `?return=` so the repair trip comes home. */
  to: string;
}

/** The sentence item 7 of the 0.5.0 papercuts spec uses wherever the master key is missing. */
export const PASSPHRASE_SENTENCE =
  'Chatsundere needs your passphrase once more before it can use your keys.';

/**
 * The key sentence item 7 uses wherever a saved provider key can't be opened.
 * `where` picks the ending: the chat surfaces say "to keep chatting"; the memory
 * page, where nobody is mid-chat, ends neutrally.
 */
export function keyLockedSentence(providerName: string, where: 'chat' | 'memory' = 'chat'): string {
  const ending =
    where === 'memory' ? 'Enter it again to carry on.' : 'Enter it again to keep chatting.';
  return `Your saved key for ${providerName} can't be opened any more. ${ending}`;
}

/** The login page in its passphrase-only mode, returning to `returnTo` afterwards. */
export function passphraseLoginPath(returnTo: string): string {
  return `/login?return=${encodeURIComponent(returnTo)}&need=passphrase`;
}

/** The provider page with its key field focused, returning to `returnTo` afterwards. */
export function reEnterKeyPath(templateId: string, returnTo: string): string {
  return `/app/settings/providers/${encodeURIComponent(templateId)}?return=${encodeURIComponent(returnTo)}&focus=key`;
}

/** Build the note for a {@link SendBlock}; `returnTo` is the current `pathname + search`. */
export function sendBlockNote(block: SendBlock, returnTo: string): SendBlockNote {
  if (block.kind === 'key-locked') {
    return {
      message: keyLockedSentence(block.providerName),
      actionLabel: 'Re-enter key',
      to: reEnterKeyPath(block.templateId, returnTo),
    };
  }
  return {
    message: PASSPHRASE_SENTENCE,
    actionLabel: 'Enter passphrase',
    to: passphraseLoginPath(returnTo),
  };
}
