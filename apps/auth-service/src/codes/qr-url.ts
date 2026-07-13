// SPDX-License-Identifier: AGPL-3.0-only
import type { Env } from '../env.js';

/**
 * Single source of truth for join QR/deep-link URLs (spec 2026-07-13 §2.3).
 * With APP_PUBLIC_URL set the link lands on the user-client's /join route so a
 * native-camera scan reaches a real screen; without it we fall back to the
 * legacy auth-origin form — with the /auth suffix stripped, which the pairing
 * and bootstrap mints previously forgot (blocker B1).
 */
export function buildJoinQrUrl(env: Env, code: string): string {
  const serverBase = env.API_BASE_URL.replace(/\/auth$/, '');
  const app = env.APP_PUBLIC_URL?.replace(/\/$/, '');
  if (app) return `${app}/join?server=${encodeURIComponent(serverBase)}#${code}`;
  return `${serverBase}/join#${code}`;
}
