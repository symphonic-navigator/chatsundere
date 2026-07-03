// SPDX-License-Identifier: AGPL-3.0-only
import type { BlobErrorBody, BlobListResponse, BlobRef } from '@chatsundere/shared-types';
import { useAccountLinkStore, useSessionStore } from '@chatsundere/ui-shared';
import { joinUrl, refreshAccessToken } from '../lib/fetch.js';
import { effectiveSyncUrl } from '../lib/server-urls.js';

/**
 * Binary blob transport against `<syncUrl>/api/v1/sync/blobs` (blob spec §7,
 * WS-D §3). It mirrors the record channel's bearer + single-401-refresh
 * discipline (`lib/fetch.ts`) but cannot reuse `apiFetch`: blob bodies are raw
 * bytes, not JSON, so this module drives `fetch` directly and shares only the
 * raw `refreshAccessToken` helper and `joinUrl` path seam.
 *
 * SECURITY (spec §11) `[L]`:
 *  - `x-ciphertext-hash` is ALWAYS the caller-supplied LOCAL seal output; this
 *    module never reads or trusts a server-reported hash (§11.2).
 *  - the §6 download size gate counts the received stream and aborts when it
 *    exceeds the MK-authenticated `BlobRef.bytes` — the one size the server
 *    cannot forge. `Content-Length` is advisory only (§11.4).
 *  - `BlobRef`/`blobId` are validated before any URL interpolation or size-gate
 *    use (§11.7), defence-in-depth against a buggy or replayed row.
 *  - no tokens in URLs; inventory/quota responses are display-only (§11.6).
 */

/** 22 base64url chars (16 random bytes) — the server's `BLOB_ID_RE` verbatim. */
const BLOB_ID_RE = /^[A-Za-z0-9_-]{22}$/;

/**
 * Defence-in-depth ceiling for `BlobRef.bytes` (§11.7). A value above this is a
 * corrupt or replayed ref, never an honest sealed body — rejected before it can
 * drive a progress ring or the size gate. Generous (1 GiB) so it never fights a
 * legitimately large image; the server's own `MAX_BLOB_BYTES` is the real limit.
 */
const MAX_SANE_BLOB_BYTES = 1024 * 1024 * 1024;

/** Malformed `BlobRef`/`blobId` (§11.7) — thrown before any fetch. */
export class BlobRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlobRefError';
  }
}

/** GET body failed the §6 size gate or is otherwise corrupt — routes to §7.2. */
export class BlobCorruptBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlobCorruptBodyError';
  }
}

/** GET `404` — a dangling ref (§7.1). */
export class BlobNotFoundError extends Error {
  constructor(message = 'blob not found') {
    super(message);
    this.name = 'BlobNotFoundError';
  }
}

/** `501 blobs_disabled` — disabled is not missing; retry is suppressed (§7.3). */
export class BlobsDisabledError extends Error {
  constructor(message = 'blob storage is disabled on this instance') {
    super(message);
    this.name = 'BlobsDisabledError';
  }
}

/** Any other non-2xx or network failure on a blob request. */
export class BlobTransportError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'BlobTransportError';
  }
}

/** The discriminated outcome of a blob PUT (blob spec §7.1). */
export type PutBlobResult =
  | { status: 'created' } // 201 — newly stored
  | { status: 'ok' } // 200 — idempotent: object already present with this hash
  | { status: 'blob_exists' } // 409 — a divergent body under this id (tamper signal, §7.2)
  | { status: 'blob_too_large'; maxBlobBytes?: number } // 413 (§7.3)
  | { status: 'quota_exceeded'; usedBytes?: number; quotaBytes?: number } // 507 (§7.3)
  | { status: 'blobs_disabled' } // 501 (§7.3)
  | { status: 'error'; httpStatus: number; code?: string };

/**
 * Validate an untrusted `BlobRef` (§11.7). Throws {@link BlobRefError} on a
 * malformed 22-char base64url id or an out-of-range byte size. Call BEFORE the
 * ref drives a URL, a progress ring, or the size gate.
 */
export function validateBlobRef(ref: unknown): BlobRef {
  if (typeof ref !== 'object' || ref === null) {
    throw new BlobRefError('blob ref is not an object');
  }
  const candidate = ref as { blobId?: unknown; bytes?: unknown };
  if (typeof candidate.blobId !== 'string' || !BLOB_ID_RE.test(candidate.blobId)) {
    throw new BlobRefError('blob ref has a malformed blobId');
  }
  if (
    typeof candidate.bytes !== 'number' ||
    !Number.isInteger(candidate.bytes) ||
    candidate.bytes < 0 ||
    candidate.bytes > MAX_SANE_BLOB_BYTES
  ) {
    throw new BlobRefError('blob ref has an out-of-range byte size');
  }
  return { blobId: candidate.blobId, bytes: candidate.bytes };
}

/** Guard a `blobId` before URL interpolation (§11.7). */
function assertBlobId(blobId: string): void {
  if (!BLOB_ID_RE.test(blobId)) throw new BlobRefError('malformed blobId');
}

/** The configured sync base URL, or a transport error when sync is unconfigured. */
function syncBaseUrl(): string {
  const url = effectiveSyncUrl();
  if (!url) throw new BlobTransportError('sync is not configured');
  return url;
}

/** Build a request init carrying the current bearer token + cookie credentials. */
function authInit(base: RequestInit): RequestInit {
  const headers = new Headers(base.headers);
  const token = useSessionStore.getState().session?.accessToken;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return { ...base, headers, credentials: 'include' };
}

/**
 * Bearer fetch with exactly one 401-refresh-retry (mirrors `apiFetch`). The
 * token is re-read for the retry so the refreshed value is used. `base.body`
 * must be a re-sendable value (a `Uint8Array`, never a consumed stream).
 */
async function fetchWithAuth(url: string, base: RequestInit): Promise<Response> {
  let res = await fetch(url, authInit(base));
  if (res.status === 401) {
    // Refresh always targets the AUTH origin — the endpoint and its HTTP-only
    // cookie do not exist on the sync service.
    const authBase = useAccountLinkStore.getState().baseUrl;
    const refreshed = authBase !== null && (await refreshAccessToken(authBase));
    if (refreshed) res = await fetch(url, authInit(base));
  }
  return res;
}

/** Best-effort read of the typed blob error envelope; undefined when absent. */
async function readBlobError(res: Response): Promise<BlobErrorBody['error'] | undefined> {
  try {
    const body = (await res.clone().json()) as Partial<BlobErrorBody>;
    return body.error;
  } catch {
    return undefined;
  }
}

/**
 * PUT a sealed blob body. `hash` is the caller's LOCAL seal output written into
 * the `x-ciphertext-hash` header on EVERY put path — initial, repair, or epoch
 * re-upload (§11.2). Returns a discriminated result; it never throws on a typed
 * server verdict (409/413/quota/disabled), only on a genuine network failure.
 */
export async function putBlob(
  blobId: string,
  body: Uint8Array,
  hash: string,
): Promise<PutBlobResult> {
  assertBlobId(blobId);
  const url = joinUrl(syncBaseUrl(), `/api/v1/sync/blobs/${blobId}`);
  const res = await fetchWithAuth(url, {
    method: 'PUT',
    headers: { 'x-ciphertext-hash': hash, 'Content-Type': 'application/octet-stream' },
    body: body as BodyInit,
  });

  if (res.status === 201) return { status: 'created' };
  if (res.status === 200) return { status: 'ok' };
  if (res.status === 409) return { status: 'blob_exists' };

  const err = await readBlobError(res);
  if (res.status === 413) return { status: 'blob_too_large', maxBlobBytes: err?.maxBlobBytes };
  if (res.status === 507 || err?.code === 'quota_exceeded') {
    return { status: 'quota_exceeded', usedBytes: err?.usedBytes, quotaBytes: err?.quotaBytes };
  }
  if (res.status === 501) return { status: 'blobs_disabled' };
  return { status: 'error', httpStatus: res.status, code: err?.code };
}

/**
 * GET a sealed blob body, enforcing the §6 download size gate: the stream is
 * counted and ABORTED the instant it exceeds the authenticated `ref.bytes`
 * (Content-Length is advisory). An over-size stream is a corrupt body
 * ({@link BlobCorruptBodyError}) routing to §7.2. The returned bytes are still
 * sealed — the caller opens them with `openBlob`, which authenticates content.
 */
export async function getBlob(ref: BlobRef): Promise<Uint8Array> {
  const valid = validateBlobRef(ref);
  const url = joinUrl(syncBaseUrl(), `/api/v1/sync/blobs/${valid.blobId}`);
  const res = await fetchWithAuth(url, { method: 'GET' });

  if (res.status === 404) throw new BlobNotFoundError();
  if (res.status === 501) throw new BlobsDisabledError();
  if (!res.ok) {
    const err = await readBlobError(res);
    throw new BlobTransportError(`blob GET failed with ${res.status}`, res.status, err?.code);
  }
  return readCappedBody(res, valid.bytes);
}

/**
 * Read a response body, aborting as soon as the accumulated length exceeds
 * `limit` (§6). Bounds memory to `limit` plus one chunk even against a
 * maliciously long stream.
 */
async function readCappedBody(res: Response, limit: number): Promise<Uint8Array> {
  const stream = res.body;
  if (!stream) {
    // No readable stream (e.g. an empty body) — buffer, still gated.
    const buffered = new Uint8Array(await res.arrayBuffer());
    if (buffered.length > limit) {
      throw new BlobCorruptBodyError('blob body exceeded the authenticated ref size');
    }
    return buffered;
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new BlobCorruptBodyError('blob body exceeded the authenticated ref size');
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * DELETE a blob. Resolves on `204` and on `404` (already gone — idempotent);
 * any other non-2xx is a {@link BlobTransportError} the caller can surface or
 * retry (e.g. `429 delete_rate_limited`).
 */
export async function deleteBlob(blobId: string): Promise<void> {
  assertBlobId(blobId);
  const url = joinUrl(syncBaseUrl(), `/api/v1/sync/blobs/${blobId}`);
  const res = await fetchWithAuth(url, { method: 'DELETE' });
  if (res.ok || res.status === 404) return;
  const err = await readBlobError(res);
  throw new BlobTransportError(`blob DELETE failed with ${res.status}`, res.status, err?.code);
}

/**
 * List the account's blob inventory (§9). Display-only (§11.6): no engine
 * decision rides on the returned numbers — a lying "full" must never become a
 * write-suppression lever.
 */
export async function listBlobs(): Promise<BlobListResponse> {
  const url = joinUrl(syncBaseUrl(), '/api/v1/sync/blobs');
  const res = await fetchWithAuth(url, { method: 'GET' });
  if (res.status === 501) throw new BlobsDisabledError();
  if (!res.ok) {
    const err = await readBlobError(res);
    throw new BlobTransportError(`blob list failed with ${res.status}`, res.status, err?.code);
  }
  return (await res.json()) as BlobListResponse;
}
