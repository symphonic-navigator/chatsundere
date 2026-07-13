// SPDX-License-Identifier: AGPL-3.0-only
import type { Env } from '../env.js';

/**
 * Single source of truth for join QR/deep-link URLs (spec 2026-07-13 §2.3).
 * With APP_PUBLIC_URL set the link lands on the user-client's /join route so a
 * native-camera scan reaches a real screen; without it we fall back to the
 * legacy auth-origin form — with the /auth suffix stripped, which the pairing
 * and bootstrap mints previously forgot (blocker B1).
 *
 * An operator-chosen `suggestedUsername` (invitation mints only) rides along as
 * a `u` query param so the client can pre-fill the join form before any server
 * round. It is deliberately NOT secret — unlike the code, which stays in the
 * URL fragment so it never reaches a server — so a query param is the right
 * home. Omitted entirely when unset, keeping the QR payload (and its density)
 * unchanged for code-only mints such as pairing.
 */
export function buildJoinQrUrl(env: Env, code: string, suggestedUsername?: string | null): string {
  const serverBase = env.API_BASE_URL.replace(/\/auth$/, '');
  const app = env.APP_PUBLIC_URL?.replace(/\/$/, '');
  const u = suggestedUsername ? `u=${encodeURIComponent(suggestedUsername)}` : null;
  if (app) {
    const query = `server=${encodeURIComponent(serverBase)}${u ? `&${u}` : ''}`;
    return `${app}/join?${query}#${code}`;
  }
  return `${serverBase}/join${u ? `?${u}` : ''}#${code}`;
}
