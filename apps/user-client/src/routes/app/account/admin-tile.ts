// SPDX-License-Identifier: AGPL-3.0-only

/** Role as carried by the account-link store (the linked backend's role). */
export type BackendRole = 'primary_admin' | 'admin' | 'user' | null;

/** The merged sign-in-security tile label. Must name both capabilities so the
 *  change-passphrase function is not buried behind the biometric hub (spec §5). */
export const SECURITY_TILE_LABEL = 'Passphrase & Biometrics';

/**
 * The admin-client URL to launch, or null when the Admin tile should not appear.
 * Shown only to admins on a backend that advertises an admin-client URL; a pure
 * launcher, never a privilege gate (the admin-client enforces roles server-side).
 */
export function adminLaunchUrl(role: BackendRole, adminUrl: string | undefined): string | null {
  if (role !== 'admin' && role !== 'primary_admin') return null;
  if (!adminUrl) return null;
  return adminUrl;
}

/** Opens the admin-client in a new tab, denying it a handle back to this window. */
export function openAdminConsole(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}
