// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Build the AAD bytes for a wrapped MK bundle. The scope distinguishes
 * local-passphrase wrapping from recovery-key wrapping. A single canonical
 * location ensures the format `${username}::<scope>::v1` is never duplicated.
 */
export function makeLocalAccountAad(
  username: string,
  scope: 'local' | 'recovery' | 'opaque',
): Uint8Array {
  return new TextEncoder().encode(`${username}::${scope}::v1`);
}
