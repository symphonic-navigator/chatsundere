// SPDX-License-Identifier: AGPL-3.0-only
/** Validate a server URL per ADR 0023: https required, except loopback. */
export function isValidServerUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    const loopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    return u.protocol === 'https:' || (u.protocol === 'http:' && loopback);
  } catch {
    return false;
  }
}
