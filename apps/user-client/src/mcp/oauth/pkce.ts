// SPDX-License-Identifier: AGPL-3.0-only
import { toBase64Url } from '@chatsundere/crypto';

function randomBase64Url(byteLength: number): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** PKCE S256 challenge (RFC 7636 §4.2) for a verifier. */
export async function s256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}

/** Fresh PKCE pair: a 256-bit verifier (43 characters) and its S256 challenge. */
export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomBase64Url(32);
  return { verifier, challenge: await s256Challenge(verifier) };
}

/** Unguessable `state` value: 256 bits, base64url. */
export function randomState(): string {
  return randomBase64Url(32);
}
