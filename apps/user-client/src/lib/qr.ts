// SPDX-License-Identifier: AGPL-3.0-only
import QrScanner from 'qr-scanner';
import { isValidCode, normaliseCodeInput } from './code-input.js';

export interface ParsedJoin {
  baseUrl: string;
  code: string;
  /**
   * Operator-suggested username carried by the `u` query param (invitation QR
   * mints only). Present only when the param is a well-formed username; a
   * malformed or absent value is dropped, never surfaced — it is a pre-fill
   * hint, so it must not block an otherwise-valid join.
   */
  suggestedUsername?: string;
}

// Mirrors the auth-service username rule (apps/auth-service/src/routes/join.ts
// USERNAME_RE): a suggested name that could never pass finish is not worth
// pre-filling, so we drop it rather than seed a field the server will reject.
const SUGGESTED_USERNAME_RE = /^[a-z][a-z0-9_-]{2,31}$/;

function readSuggestedUsername(url: URL): string | undefined {
  const raw = url.searchParams.get('u');
  if (raw === null) return undefined;
  return SUGGESTED_USERNAME_RE.test(raw) ? raw : undefined;
}

export type ParseJoinResult =
  | { ok: true; value: ParsedJoin }
  | {
      ok: false;
      error:
        | 'malformed'
        | 'bad_scheme'
        | 'missing_join_segment'
        | 'bad_fragment'
        | 'bad_server_param';
    };

// https, or http on loopback (dev). Shared by the outer join URL and, for the
// client-origin form, the decoded `server` param — a QR minted by instance X
// must still resolve to a scheme we're willing to talk to, regardless of
// which instance's app scanned it.
function isAllowedScheme(url: URL): boolean {
  const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback);
}

export function parseJoinUrl(raw: string): ParseJoinResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'malformed' };
  }

  if (!isAllowedScheme(url)) {
    return { ok: false, error: 'bad_scheme' };
  }

  if (!url.pathname.endsWith('/join')) {
    return { ok: false, error: 'missing_join_segment' };
  }

  // Normalise before validating so a pasted legacy join URL gets the same
  // case-fold / confusable-character tolerance (I/L/O/V) as manual code
  // entry — a no-op for an already-canonical fragment from a real QR. Both
  // the new client-origin form and the legacy form read `fragment` below, so
  // normalising once here covers both.
  const rawFragment = url.hash.startsWith('#') ? url.hash.slice(1) : '';
  const fragment = normaliseCodeInput(rawFragment);
  if (!isValidCode(fragment)) {
    return { ok: false, error: 'bad_fragment' };
  }

  // Client-origin form (Task A1): the `server` param names the actual
  // server to join, which is unrelated to the URL's own origin — the QR's
  // origin is just wherever the app is hosted. Never fall back to the
  // legacy derivation on a bad param; that would silently join the wrong
  // server.
  const serverParam = url.searchParams.get('server');
  if (serverParam !== null) {
    let serverUrl: URL;
    try {
      serverUrl = new URL(serverParam);
    } catch {
      return { ok: false, error: 'bad_server_param' };
    }
    if (!isAllowedScheme(serverUrl)) {
      return { ok: false, error: 'bad_server_param' };
    }
    return {
      ok: true,
      value: {
        baseUrl: serverParam,
        code: fragment,
        suggestedUsername: readSuggestedUsername(url),
      },
    };
  }

  // Legacy form: base URL = origin + everything up to /join (inclusive of
  // trailing slash).
  const basePath = url.pathname.slice(0, -'join'.length);
  const baseUrl = `${url.origin}${basePath}`;

  return {
    ok: true,
    value: { baseUrl, code: fragment, suggestedUsername: readSuggestedUsername(url) },
  };
}

export async function scanWithCamera(
  videoEl: HTMLVideoElement,
  onResult: (raw: string) => void,
): Promise<() => void> {
  const scanner = new QrScanner(videoEl, (result) => onResult(result.data), {
    highlightScanRegion: true,
    highlightCodeOutline: true,
  });
  await scanner.start();
  return () => scanner.stop();
}
