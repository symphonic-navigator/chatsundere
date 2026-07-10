// SPDX-License-Identifier: AGPL-3.0-only

import { createHmac } from 'node:crypto';
import { loadEnv } from '../env.js';

/** AES-256-GCM ciphertext length for a wrapped 32-byte AMK: 32-byte plaintext + 16-byte GCM tag
 *  (packages/crypto/src/primitives/aead.ts, packages/crypto/src/types.ts asMasterKey/asAmk). */
const WRAPPED_MK_BYTES = 48;
/** AES-GCM nonce length, matching NONCE_BYTES in packages/crypto/src/primitives/aead.ts. */
const WRAP_NONCE_BYTES = 12;

/**
 * Derives a deterministic, shape-realistic decoy OPAQUE wrap for a username
 * that has no real `auth_methods` row to serve — i.e. an unknown username or
 * a suspended user's login/start call.
 *
 * Closes Finding #10a: without this, POST /api/v1/opaque/login/start leaked
 * account existence through the wrap fields alone — `wrapped_mk_opaque: null`
 * for an absent/suspended user vs a real base64url blob for an active one —
 * even though the OPAQUE ke2 itself was already masked via
 * `registrationRecord: null`. The client never legitimately reaches these
 * bytes on a fake/suspended session: /finish always 401s before a fake
 * login_response can ever produce a valid session key (see login.ts, the
 * `state.fake === 'true'` branch and the post-update `!user` branch), so
 * returning plausible-but-unusable bytes here is safe.
 *
 * Deterministic per lowercased username — stable across repeated calls, so a
 * prober who calls /start twice for the same unknown username never sees "a
 * fresh decoy every time" as a distinguishing tell of its own. Derived via
 * HMAC-SHA256 keyed by DECOY_WRAP_KEY, a secret dedicated to this purpose
 * (never reused for OPAQUE, JWT, invitation, refresh-token, or pending-code
 * material — leak-domain isolation, mirroring HMAC_KEY_PENDING_CODES'
 * rationale in codes/token.ts): without that key, the decoy bytes are
 * indistinguishable from a real wrap to anyone who does not hold it.
 *
 * The AAD is the one exception: it is deliberately NOT secret-derived. A real
 * wrap's AAD is `${username}::opaque::v1` — a public formula
 * (packages/crypto/src/primitives/aad.ts) built purely from the username, so
 * echoing that exact formula here makes the decoy's AAD byte-for-byte
 * indistinguishable from a genuine one rather than merely length-matched.
 * Genuine usernames are always lowercase (validated at registration/rename,
 * stored citext), so a real AAD is always built from the lowercased form
 * regardless of request casing — the decoy AAD is derived from the same
 * lowercased form here, otherwise a mixed-case request (`"Alice"`) would echo
 * its raw case back for an unknown account while a real account's AAD stays
 * lowercase, turning the case-fold itself into a 100%-reliable existence
 * oracle.
 */
export function deriveDecoyWrap(username: string): {
  wrapped_mk_opaque: string;
  wrap_nonce_opaque: string;
  wrap_aad_opaque: string;
} {
  const { DECOY_WRAP_KEY } = loadEnv();
  const lowerUsername = username.toLowerCase();
  const label = `decoy-wrap:${lowerUsername}`;

  // HMAC-SHA256 yields 32 bytes/block; expand via counter-mode labelled
  // blocks to cover the 48-byte ciphertext + 12-byte nonce (60 bytes, 2 blocks).
  const block0 = createHmac('sha256', DECOY_WRAP_KEY).update(`${label}:0`).digest();
  const block1 = createHmac('sha256', DECOY_WRAP_KEY).update(`${label}:1`).digest();
  const expanded = Buffer.concat([block0, block1]);

  const ciphertext = expanded.subarray(0, WRAPPED_MK_BYTES);
  const nonce = expanded.subarray(WRAPPED_MK_BYTES, WRAPPED_MK_BYTES + WRAP_NONCE_BYTES);
  const aad = Buffer.from(`${lowerUsername}::opaque::v1`, 'utf8');

  return {
    wrapped_mk_opaque: ciphertext.toString('base64url'),
    wrap_nonce_opaque: nonce.toString('base64url'),
    wrap_aad_opaque: aad.toString('base64url'),
  };
}
