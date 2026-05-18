// SPDX-License-Identifier: LGPL-3.0-only

/**
 * AAGUIDs of known cloud-synced authenticators that legitimately return
 * `signCount = 0` on every assertion. For these we skip strict monotonic
 * checks; for others we enforce monotonic counters.
 *
 * Updates require an ADR. Source values verified against:
 * https://github.com/passkeydeveloper/passkey-authenticator-aaguids
 */
export const SYNCED_PASSKEY_AAGUIDS: ReadonlySet<string> = new Set([
  // Apple Passkeys (iCloud Keychain)
  'fbfc3007-154e-4ecc-8c0b-6e020557d7bd',
  // Google Password Manager Passkeys
  'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4',
  // 1Password Passkeys
  'bada5566-a7aa-401f-bd96-45619a55120d',
  // Bitwarden Passkeys
  'd548826e-79b4-db40-a3d8-11116f7e8349',
  // Dashlane Passkeys
  '53414d53-554e-4700-0000-000000000000',
]);

export function isSyncedAuthenticator(aaguid: string | null): boolean {
  if (!aaguid) return false;
  return SYNCED_PASSKEY_AAGUIDS.has(aaguid.toLowerCase());
}
