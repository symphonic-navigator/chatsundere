// SPDX-License-Identifier: AGPL-3.0-only

import * as v from 'valibot';

// ── Schema ─────────────────────────────────────────────────────────────────

export const InvitationQrPayload = v.object({
  v: v.literal(1),
  kind: v.literal('invitation'),
  token: v.pipe(v.string(), v.minLength(16)),
  base_url: v.pipe(v.string(), v.url()),
  role: v.union([v.literal('primary_admin'), v.literal('admin'), v.literal('user')]),
  issuer_label: v.nullable(v.string()),
});

export type InvitationQrPayload = v.InferOutput<typeof InvitationQrPayload>;

// ── Parse helpers ────────────────────────────────────────────────────────────

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Parse the raw string that a QR scan yields. The QR encodes the invitation
 * JSON directly (not a URL wrapper). Accepts both the bare JSON form and the
 * URL deep-link form (`https://<server>/link?payload=<base64url-json>`).
 */
export function parseInvitationPayload(raw: string): ParseResult<InvitationQrPayload> {
  const trimmed = raw.trim();

  // Try URL deep-link form first so that scanning a link QR also works here.
  const fromUrl = tryExtractFromUrl(trimmed);
  const jsonString = fromUrl ?? trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return { ok: false, error: 'not valid JSON' };
  }

  const result = v.safeParse(InvitationQrPayload, parsed);
  if (!result.success) {
    return { ok: false, error: 'schema mismatch' };
  }
  return { ok: true, value: result.output };
}

/**
 * Parse a `https://<server>/link?payload=<base64url-json>` deep link.
 * The payload query param contains base64url-encoded invitation JSON.
 *
 * Accepts either the full URL form or bare JSON (same as
 * `parseInvitationPayload`) so callers can use either entry point
 * interchangeably.
 */
export function parseInvitationUrl(raw: string): ParseResult<InvitationQrPayload> {
  const trimmed = raw.trim();

  // If it looks like JSON, defer to the standard parser.
  if (trimmed.startsWith('{')) {
    return parseInvitationPayload(trimmed);
  }

  const jsonString = tryExtractFromUrl(trimmed);
  if (!jsonString) {
    return { ok: false, error: 'not a valid invitation URL or JSON' };
  }

  return parseInvitationPayload(jsonString);
}

/** Extract the JSON string from the `payload` query parameter of a deep link. */
function tryExtractFromUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const payload = url.searchParams.get('payload');
    if (!payload) return null;
    // Decode base64url to a UTF-8 string.
    return base64UrlDecode(payload);
  } catch {
    return null;
  }
}

function base64UrlDecode(input: string): string {
  // Replace base64url chars with standard base64 and pad.
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return atob(padded);
}

// ── Camera scan ──────────────────────────────────────────────────────────────

export interface ScanResult {
  raw: string;
}

/**
 * Scan a single QR code from the user's camera.
 *
 * Uses `BarcodeDetector` when available (Chrome/Edge). Falls back to the
 * `qr-scanner` library via dynamic import for other browsers.
 *
 * Resolves with the raw decoded string on success. The returned cleanup
 * function must be called when the caller is done (on unmount or cancellation)
 * to stop the video stream.
 *
 * @param videoEl  A `<video>` element that this function will attach the
 *                 camera stream to.
 * @param onResult Called with each distinct decoded string.
 * @returns        A cleanup function that stops the stream.
 */
export async function scanWithCamera(
  videoEl: HTMLVideoElement,
  onResult: (raw: string) => void,
): Promise<() => void> {
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    return scanWithBarcodeDetector(videoEl, onResult);
  }
  return scanWithQrScannerLib(videoEl, onResult);
}

// ── BarcodeDetector path ─────────────────────────────────────────────────────

// The BarcodeDetector API is not in the standard TypeScript DOM lib yet.
declare class BarcodeDetector {
  constructor(options?: { formats: string[] });
  detect(image: ImageBitmapSource): Promise<{ rawValue: string }[]>;
}

async function scanWithBarcodeDetector(
  videoEl: HTMLVideoElement,
  onResult: (raw: string) => void,
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' },
  });

  videoEl.srcObject = stream;
  await videoEl.play();

  const detector = new BarcodeDetector({ formats: ['qr_code'] });
  let rafId: ReturnType<typeof requestAnimationFrame>;
  let stopped = false;
  const seen = new Set<string>();

  async function tick() {
    if (stopped) return;
    try {
      const results = await detector.detect(videoEl);
      for (const r of results) {
        if (!seen.has(r.rawValue)) {
          seen.add(r.rawValue);
          onResult(r.rawValue);
        }
      }
    } catch {
      // Detection frame errors are non-fatal; keep polling.
    }
    if (!stopped) {
      rafId = requestAnimationFrame(() => void tick());
    }
  }

  rafId = requestAnimationFrame(() => void tick());

  return () => {
    stopped = true;
    cancelAnimationFrame(rafId);
    for (const track of stream.getTracks()) track.stop();
    videoEl.srcObject = null;
  };
}

// ── qr-scanner fallback ──────────────────────────────────────────────────────

async function scanWithQrScannerLib(
  videoEl: HTMLVideoElement,
  onResult: (raw: string) => void,
): Promise<() => void> {
  const { default: QrScanner } = await import('qr-scanner');
  const seen = new Set<string>();
  const scanner = new QrScanner(
    videoEl,
    (result) => {
      const raw = typeof result === 'string' ? result : result.data;
      if (!seen.has(raw)) {
        seen.add(raw);
        onResult(raw);
      }
    },
    { preferredCamera: 'environment' },
  );
  await scanner.start();
  return () => {
    scanner.stop();
    scanner.destroy();
  };
}
