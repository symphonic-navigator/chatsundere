// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Whether WebAuthn is available on this device. Returns true whenever
 * `window.PublicKeyCredential` exists, regardless of whether the device has
 * a user-verifying platform authenticator (Touch ID / Face ID / Windows
 * Hello). Under the UV='preferred' policy (ADR 0022) we accept cross-platform
 * passkeys too — Bitwarden Desktop, Yubikeys, browser-profile passkeys — so
 * UVPAA is no longer the right gate.
 *
 * For "this device has a platform authenticator specifically", use
 * `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`
 * directly.
 */
export function isWebAuthnAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'credentials' in navigator &&
    typeof window.PublicKeyCredential !== 'undefined'
  );
}
