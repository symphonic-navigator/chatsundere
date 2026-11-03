// SPDX-License-Identifier: AGPL-3.0-only

// Local copy on purpose: the standalone callback page imports this file, and the
// crypto barrel would drag a large shared chunk into that page.
function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** What the relay page hands back after the authorisation redirect. */
export type CallbackPayload =
  | { code: string; state: string; iss?: string }
  | { error: string; state: string };

const PREFIX = 'csm1.';
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Serialises a callback for pasting: `csm1.` + base64url of the JSON. */
export function encodeCallbackPayload(p: CallbackPayload): string {
  return PREFIX + toBase64Url(new TextEncoder().encode(JSON.stringify(p)));
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** Parses a pasted callback; null for anything that is not exactly the expected shape. */
export function decodeCallbackPayload(s: string): CallbackPayload | null {
  const text = s.trim();
  if (!text.startsWith(PREFIX)) return null;
  const body = text.slice(PREFIX.length);
  if (!BASE64URL.test(body)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(body)));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  if (!nonEmptyString(o.state)) return null;
  if ('code' in o) {
    if ('error' in o || !nonEmptyString(o.code)) return null;
    if ('iss' in o) {
      return typeof o.iss === 'string' ? { code: o.code, state: o.state, iss: o.iss } : null;
    }
    return { code: o.code, state: o.state };
  }
  if (nonEmptyString(o.error)) return { error: o.error, state: o.state };
  return null;
}
