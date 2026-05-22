// SPDX-License-Identifier: AGPL-3.0-only
import QrScanner from 'qr-scanner';
import { isValidCode } from './code-input.js';

export interface ParsedJoin {
  baseUrl: string;
  code: string;
}

export type ParseJoinResult =
  | { ok: true; value: ParsedJoin }
  | { ok: false; error: 'malformed' | 'bad_scheme' | 'missing_join_segment' | 'bad_fragment' };

export function parseJoinUrl(raw: string): ParseJoinResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'malformed' };
  }

  const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    return { ok: false, error: 'bad_scheme' };
  }

  if (!url.pathname.endsWith('/join')) {
    return { ok: false, error: 'missing_join_segment' };
  }

  const fragment = url.hash.startsWith('#') ? url.hash.slice(1) : '';
  if (!isValidCode(fragment)) {
    return { ok: false, error: 'bad_fragment' };
  }

  // Base URL = origin + everything up to /join (inclusive of trailing slash).
  const basePath = url.pathname.slice(0, -'join'.length);
  const baseUrl = `${url.origin}${basePath}`;

  return { ok: true, value: { baseUrl, code: fragment } };
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
