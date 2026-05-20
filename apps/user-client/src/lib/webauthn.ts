// SPDX-License-Identifier: AGPL-3.0-only

import { PRF_INPUT_SALT } from '@chatsundere/crypto';
import { useSessionStore } from '@chatsundere/ui-shared';
import { getDb } from '../boot/open-db.js';

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * Thrown when the authenticator does not support the PRF extension (ADR 0005).
 * Callers must catch this and tell the user why biometric setup was refused.
 */
export class PrfRequiredError extends Error {
  constructor() {
    super(
      'This authenticator does not support the PRF extension. ' +
        'A PRF-capable passkey is required to protect your master key. ' +
        'Please use a different authenticator.',
    );
    this.name = 'PrfRequiredError';
  }
}

// ── Register local biometric ─────────────────────────────────────────────────

export interface RegisterLocalBiometricResult {
  credentialId: Uint8Array;
  publicKey: Uint8Array;
  aaguid: string | null;
  prfOutput: Uint8Array;
}

/**
 * Drive `navigator.credentials.create()` with the PRF extension for a new
 * biometric credential, then persist the wrapped MK via the session's
 * `registerLocalBiometric()` method.
 *
 * Per ADR 0005: credentials without PRF support are refused (`PrfRequiredError`).
 * The raw MK never leaves the session closure — only the derived PRF output
 * and metadata are handled here.
 *
 * @param label  Human-readable label for this biometric (e.g. "Face ID on iPhone").
 */
export async function registerLocalBiometric(label: string): Promise<void> {
  const session = useSessionStore.getState().session;
  if (!session) throw new Error('no active session');

  const userId = new TextEncoder().encode(session.userId);
  const challenge = crypto.getRandomValues(new Uint8Array(32)) as Uint8Array<ArrayBuffer>;
  const prfSalt = await PRF_INPUT_SALT;

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'Chatsundere', id: window.location.hostname },
      user: {
        id: userId,
        name: session.username,
        displayName: session.username,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        userVerification: 'required',
        residentKey: 'preferred',
      },
      extensions: {
        // .slice() copies the bytes into a fresh ArrayBuffer, satisfying the
        // BufferSource constraint that requires Uint8Array<ArrayBuffer> not
        // Uint8Array<ArrayBufferLike>.
        prf: { eval: { first: prfSalt.slice() } },
      },
    },
  })) as PublicKeyCredential | null;

  if (!credential) throw new PrfRequiredError();

  const response = credential.response as AuthenticatorAttestationResponse;

  // The standard type does not expose PRF extension outputs — this cast is
  // the standard workaround for the prf extension shape.
  const extResults = credential.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  const prfFirst = extResults.prf?.results?.first;
  if (!prfFirst) throw new PrfRequiredError();

  const credentialId = new Uint8Array(credential.rawId);

  // Parse the AAGUID and COSE-encoded public key from the authenticatorData.
  // `response.getPublicKey()` would give us SPKI/DER, but the assertion verifier
  // (@simplewebauthn/server) expects a CBOR-encoded COSE_Key.
  const authData = new Uint8Array(response.getAuthenticatorData());
  const aaguid = parseAaguid(authData);
  const cosePublicKey = extractCosePublicKey(authData);

  await session.registerLocalBiometric({
    db: getDb(),
    credentialId,
    publicKey: cosePublicKey,
    aaguid,
    prfOutput: new Uint8Array(prfFirst),
    label,
  });
}

// ── COSE public key extraction ───────────────────────────────────────────────

/**
 * Extract the CBOR-encoded COSE_Key public key from an attestation's
 * authenticatorData. The slice runs to the end of authData; any trailing
 * extension bytes are tolerated by the downstream CBOR parser because COSE
 * keys are self-delimiting CBOR maps.
 *
 * authenticatorData layout for attestation (CTAP2 / WebAuthn §6.1):
 *   [0..31]    rpIdHash (32 bytes)
 *   [32]       flags (1 byte)
 *   [33..36]   signCount (4 bytes)
 *   [37..52]   aaguid (16 bytes)              — when AT flag bit 6 is set
 *   [53..54]   credentialIdLength (uint16 BE)
 *   [55..55+L] credentialId (L bytes)
 *   [55+L..]   credentialPublicKey (COSE_Key) — to end of slice
 */
function extractCosePublicKey(authData: Uint8Array): Uint8Array {
  if (authData.length < 55) {
    throw new Error('authenticatorData too short for attested credential data');
  }
  const flags = authData[32];
  if (flags === undefined || (flags & 0x40) === 0) {
    throw new Error('authenticatorData has no attested credential data (AT flag not set)');
  }
  const high = authData[53];
  const low = authData[54];
  if (high === undefined || low === undefined) {
    throw new Error('authenticatorData truncated at credentialIdLength');
  }
  const credIdLen = (high << 8) | low;
  const start = 55 + credIdLen;
  if (authData.length <= start) {
    throw new Error('authenticatorData missing COSE public key');
  }
  return authData.slice(start);
}

// ── AAGUID parsing ────────────────────────────────────────────────────────────

/**
 * Extract the AAGUID from the authenticatorData byte array and return it in
 * the standard `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` UUID string form.
 * Returns null when the authenticator reports a zero AAGUID (privacy-preserving
 * authenticators do this deliberately).
 *
 * authenticatorData layout (CTAP2 / WebAuthn §6.1):
 *   [0..31]   rpIdHash (32 bytes)
 *   [32]      flags (1 byte)
 *   [33..36]  signCount (4 bytes)
 *   [37..52]  aaguid (16 bytes)  — present only when AT flag is set
 */
function parseAaguid(authData: Uint8Array): string | null {
  if (authData.length < 53) return null;
  const flags = authData[32];
  // AT flag is bit 6.
  if (!flags || (flags & 0x40) === 0) return null;

  const bytes = authData.slice(37, 53);
  // Zero AAGUID means the authenticator chose not to disclose its identity.
  if (bytes.every((b) => b === 0)) return null;

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
