// SPDX-License-Identifier: LGPL-3.0-only

const PRF_SALT_STRING = 'chatsundere-mk-derivation-v1';

/**
 * The fixed app-wide PRF input salt, ready to pass into
 * `extensions.prf.eval.first` when invoking `navigator.credentials`.
 * Computed once at module load.
 */
export const PRF_INPUT_SALT: Promise<Uint8Array> = computeSalt();

async function computeSalt(): Promise<Uint8Array> {
  const buf = new TextEncoder().encode(PRF_SALT_STRING);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buf);
  return new Uint8Array(digest);
}

/** Take an authenticator's PRF output and return a stable credential-id prefix string. */
export function credentialIdPrefix(credentialId: Uint8Array): string {
  // Use the first 8 bytes as a hex prefix — collision-resistant enough to
  // namespace the PRF info string, short enough to keep info compact.
  let out = '';
  for (let i = 0; i < Math.min(8, credentialId.length); i++) {
    out += (credentialId[i] as number).toString(16).padStart(2, '0');
  }
  return out;
}
