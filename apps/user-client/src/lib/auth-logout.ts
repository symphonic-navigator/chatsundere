// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { apiFetch } from './fetch.js';

/**
 * Revoke THIS device's server session (spec: sync-lifecycle hardening). A
 * thin, best-effort wrapper around `POST /api/v1/auth/logout` — the shared
 * building block for "decouple this device" and "complete wipe", both of
 * which must keep going even if the server call fails. Never throws:
 * any failure (network, non-2xx, no linked server) resolves to `false`.
 *
 * `baseUrlOverride` lets a caller supply the auth base explicitly instead of
 * reading it from the account-link store — needed when decouple's retry runs
 * AFTER `decoupleDevice()` has already cleared the store's `baseUrl` to
 * `null` via `setLocalOnly()`. Without an override the retry would always
 * short-circuit to `false` with no network call, making it a dead control.
 */
export async function logoutCurrentSession(baseUrlOverride?: string): Promise<boolean> {
  const baseUrl = baseUrlOverride ?? useAccountLinkStore.getState().baseUrl;
  if (baseUrl === null) return false;
  try {
    await apiFetch<void>({
      baseUrl,
      path: '/api/v1/auth/logout',
      method: 'POST',
      authMode: 'bearer',
      // Background origin (§5.2): a refused refresh during logout must latch
      // auth-degraded rather than recurse into closeAndForget — the caller is
      // already tearing the session down and must not be interrupted.
      origin: 'background',
    });
    return true;
  } catch {
    return false;
  }
}
