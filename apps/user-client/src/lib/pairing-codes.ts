// SPDX-License-Identifier: AGPL-3.0-only

import { apiFetch } from './fetch.js';

/** Wire shape of a pairing code (GET returns code/qr_url as null — HMAC-only storage). */
export interface PairingCode {
  id: string;
  code: string | null;
  qr_url: string | null;
  created_at: string;
  expires_at: string;
  state: 'active';
}

/** Creates a pairing code. Tier-1 gated server-side; the apiFetch step-up gate handles the prompt. */
export function createPairingCode(baseUrl: string): Promise<PairingCode> {
  return apiFetch<PairingCode>({
    baseUrl,
    path: '/api/v1/me/pairing-codes',
    method: 'POST',
    authMode: 'bearer',
  });
}

/** Lists the caller's active pairing codes (code/qr_url always null — never re-shown). */
export async function listPairingCodes(baseUrl: string): Promise<PairingCode[]> {
  const res = await apiFetch<{ pairing_codes: PairingCode[] }>({
    baseUrl,
    path: '/api/v1/me/pairing-codes',
    authMode: 'bearer',
  });
  return res.pairing_codes;
}

/** Revokes an active pairing code by id. */
export function revokePairingCode(baseUrl: string, id: string): Promise<void> {
  return apiFetch<void>({
    baseUrl,
    path: `/api/v1/me/pairing-codes/${id}`,
    method: 'DELETE',
    authMode: 'bearer',
  });
}
