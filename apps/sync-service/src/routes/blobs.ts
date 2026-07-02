// SPDX-License-Identifier: AGPL-3.0-only

import { fromBase64Url } from '@chatsundere/crypto';
import type { SyncBlobErrorCode } from '@chatsundere/shared-types';
import type { Context, Hono } from 'hono';
import type { BlobBackend } from '../blobs/s3.js';
import { blobKey } from '../blobs/s3.js';
import {
  commitBlob,
  deleteBlobRow,
  findBlob,
  flooredBytes,
  getAccountTotal,
  listBlobs,
} from '../blobs/store.js';
import { authenticate } from '../http/authenticate.js';
import type { SyncDeps } from '../http/deps.js';

// The blob transport (blob spec §7). Four endpoints under the sync namespace,
// same JWT + deny-list auth as the record channel. Blobs are immutable,
// rev-less, doorbell-less; the referencing record rides the ordinary channel.
//
// NOTE: these routes are deliberately NOT wrapped in the record channel's
// `bodyLimit` middleware (blob spec §7.1 exemption). That middleware is mounted
// per-route on POST /api/v1/sync/changes only; applied service-wide it would cap
// blob PUTs below MAX_BLOB_BYTES. The blob routes' sole body ceiling is
// MAX_BLOB_BYTES, checked from Content-Length below.

const BLOB_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const MIN_BODY_BYTES = 28; // nonce (12) + GCM tag (16)
const CIPHERTEXT_HASH_BYTES = 32;

// Error/JSON statuses (excludes 204 No-Content — DELETE uses c.body(null, 204)).
type HttpStatus = 400 | 401 | 404 | 409 | 411 | 413 | 429 | 501 | 503 | 507;

/** A validation failure raised while streaming the upload (length lie / stall). */
class UploadValidationError extends Error {}

function errorBody(
  code: SyncBlobErrorCode | 'bad_request',
  message: string,
  extra: { usedBytes?: number; quotaBytes?: number; maxBlobBytes?: number } = {},
): { error: Record<string, unknown> } {
  return { error: { code, message, ...extra } };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Wraps the request body in a stream that counts bytes, hashes incrementally
 * (Bun.CryptoHasher, per probe 2), aborts on overrun past the declared length,
 * and aborts on inactivity (the §8 idle watchdog, reset on every chunk). The
 * wrapped stream is what gets forwarded to S3 — the service never buffers the
 * whole blob.
 */
function instrumentUpload(
  source: ReadableStream<Uint8Array>,
  declared: number,
  idleMs: number,
): { stream: ReadableStream<Uint8Array>; result: () => { count: number; hash: Uint8Array } } {
  const hasher = new Bun.CryptoHasher('sha256');
  let count = 0;
  const reader = source.getReader();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  const clear = (): void => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = null;
  };
  const arm = (): void => {
    clear();
    watchdog = setTimeout(() => {
      controllerRef?.error(new UploadValidationError('upload stalled past the idle timeout'));
      void reader.cancel().catch(() => {});
    }, idleMs);
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      arm();
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        clear();
        controller.close();
        return;
      }
      count += value.byteLength;
      if (count > declared) {
        clear();
        controller.error(new UploadValidationError('body exceeded the declared Content-Length'));
        return;
      }
      hasher.update(value);
      arm();
      controller.enqueue(value);
    },
    cancel() {
      clear();
      void reader.cancel().catch(() => {});
    },
  });
  return { stream, result: () => ({ count, hash: new Uint8Array(hasher.digest()) }) };
}

/**
 * Streams a stored blob to the client while hashing it incrementally; on the
 * last byte it compares against the row's `ciphertext_hash` and reports (not
 * prevents — the bytes are already sent) a mismatch as a DB/S3 inconsistency.
 */
function verifyingDownload(
  source: ReadableStream<Uint8Array>,
  expected: Uint8Array,
  onInconsistency: () => void,
): ReadableStream<Uint8Array> {
  const hasher = new Bun.CryptoHasher('sha256');
  const reader = source.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        if (!bytesEqual(new Uint8Array(hasher.digest()), expected)) onInconsistency();
        controller.close();
        return;
      }
      hasher.update(value);
      controller.enqueue(value);
    },
    cancel() {
      void reader.cancel().catch(() => {});
    },
  });
}

interface BlobHooks {
  onUpload?: (outcome: string) => void;
  onDownload?: (outcome: string) => void;
  onDelete?: () => void;
  onBackendError?: () => void;
  onInconsistency?: () => void;
  observeBytes?: (bytes: number) => void;
}

/** Registers the four blob routes (blob spec §7). `hooks` carries the §8 metrics. */
export function registerBlobRoutes(app: Hono, deps: SyncDeps, hooks: BlobHooks = {}): void {
  const { env, db, allow } = deps;
  const noop = (): void => {};
  const onUpload = hooks.onUpload ?? noop;
  const onDownload = hooks.onDownload ?? noop;
  const onDelete = hooks.onDelete ?? noop;
  const onBackendError = hooks.onBackendError ?? noop;
  const onInconsistency = hooks.onInconsistency ?? noop;
  const observeBytes = hooks.observeBytes ?? noop;

  const disabled = (c: Context) =>
    c.json(errorBody('blobs_disabled', 'This instance has no blob storage configured'), 501);

  // --- PUT /api/v1/sync/blobs/:blobId (spec §7.1) ---------------------------
  app.put('/api/v1/sync/blobs/:blobId', async (c) => {
    const auth = await authenticate(c, deps);
    if (!auth.ok) return auth.response;
    const sub = auth.claims.sub;
    const backend = deps.blobBackend;
    if (!backend) return disabled(c);

    const blobId = c.req.param('blobId');
    if (!BLOB_ID_RE.test(blobId)) {
      return c.json(errorBody('bad_request', 'malformed blobId'), 400);
    }

    // 1. Validate x-ciphertext-hash (decodes to exactly 32 bytes).
    const hashHeader = c.req.header('x-ciphertext-hash');
    let expectedHash: Uint8Array;
    try {
      expectedHash = fromBase64Url(hashHeader ?? '');
    } catch {
      return c.json(errorBody('bad_request', 'malformed x-ciphertext-hash'), 400);
    }
    if (!hashHeader || expectedHash.length !== CIPHERTEXT_HASH_BYTES) {
      return c.json(errorBody('bad_request', 'x-ciphertext-hash must decode to 32 bytes'), 400);
    }

    // 2. Content-Length present (chunked refused), within [28, MAX_BLOB_BYTES].
    const lenHeader = c.req.header('content-length');
    if (lenHeader === undefined) {
      return c.json(errorBody('bad_request', 'Content-Length is required'), 411);
    }
    const declared = Number(lenHeader);
    if (!Number.isInteger(declared) || declared < MIN_BODY_BYTES) {
      return c.json(errorBody('bad_request', 'body is too small to be a sealed blob'), 400);
    }
    if (declared > env.MAX_BLOB_BYTES) {
      onUpload('blob_too_large');
      return c.json(
        errorBody('blob_too_large', 'blob exceeds the maximum size', {
          maxBlobBytes: env.MAX_BLOB_BYTES,
        }),
        413,
      );
    }

    // 3. Existence check FIRST (spec §7.1 step 3): a lost-ack retry must not be
    //    rejected by a false quota_exceeded at a full account.
    const existing = await findBlob(db, sub, blobId);
    if (existing) {
      if (bytesEqual(existing.ciphertextHash, expectedHash)) {
        onUpload('idempotent');
        return c.json({ status: 'ok' }, 200); // nothing re-stored, nothing double-counted
      }
      onUpload('blob_exists');
      return c.json(errorBody('blob_exists', 'a different blob already exists under this id'), 409);
    }

    // 4. Quota PRE-check (cheap fast-fail only; step 6 enforces under the lock).
    const preTotal = await getAccountTotal(db, sub);
    if (preTotal + flooredBytes(declared, env.BLOB_QUOTA_FLOOR_BYTES) > env.ACCOUNT_QUOTA_BYTES) {
      onUpload('quota_exceeded');
      return c.json(
        errorBody('quota_exceeded', 'account storage quota exceeded', {
          usedBytes: preTotal,
          quotaBytes: env.ACCOUNT_QUOTA_BYTES,
        }),
        507,
      );
    }

    // 5. Stream to S3 while counting + hashing, with the idle watchdog.
    const body = c.req.raw.body;
    if (!body) return c.json(errorBody('bad_request', 'missing request body'), 400);
    const key = blobKey(sub, blobId);
    const { stream, result } = instrumentUpload(
      body,
      declared,
      env.BLOB_UPLOAD_IDLE_TIMEOUT_S * 1000,
    );

    const fail = async (
      status: HttpStatus,
      code: SyncBlobErrorCode | 'bad_request',
      msg: string,
    ) => {
      await backend.delete(key).catch(() => {}); // best-effort, retrying delete
      return c.json(errorBody(code, msg), status);
    };

    try {
      await backend.putStream(key, stream, declared);
    } catch (e) {
      if (e instanceof UploadValidationError) return fail(400, 'bad_request', e.message);
      onBackendError();
      onUpload('backend_error');
      return fail(503, 'blob_backend_unavailable', 'the object store is unavailable');
    }

    const { count, hash } = result();
    if (count !== declared) {
      onUpload('length_mismatch');
      return fail(400, 'bad_request', 'body byte count did not match Content-Length');
    }
    if (!bytesEqual(hash, expectedHash)) {
      onUpload('hash_mismatch');
      return fail(400, 'hash_mismatch', 'body did not hash to x-ciphertext-hash');
    }

    // 6. Commit under the lock (re-verifies quota).
    const commit = await commitBlob(db, sub, blobId, declared, expectedHash, {
      quotaBytes: env.ACCOUNT_QUOTA_BYTES,
      floorBytes: env.BLOB_QUOTA_FLOOR_BYTES,
    });
    if (commit.status === 'quota_exceeded') {
      onUpload('quota_exceeded');
      return fail(507, 'quota_exceeded', 'account storage quota exceeded');
    }
    onUpload('created');
    observeBytes(declared);
    return c.json({ status: 'created' }, 201);
  });

  // --- GET /api/v1/sync/blobs (listing, spec §7.4) --------------------------
  app.get('/api/v1/sync/blobs', async (c) => {
    const auth = await authenticate(c, deps);
    if (!auth.ok) return auth.response;
    if (!deps.blobBackend) return disabled(c);
    const { blobs, totalBytes } = await listBlobs(db, auth.claims.sub);
    return c.json({ blobs, totalBytes, quotaBytes: env.ACCOUNT_QUOTA_BYTES });
  });

  // --- GET /api/v1/sync/blobs/:blobId (download, spec §7.2) -----------------
  app.get('/api/v1/sync/blobs/:blobId', async (c) => {
    const auth = await authenticate(c, deps);
    if (!auth.ok) return auth.response;
    const sub = auth.claims.sub;
    const backend = deps.blobBackend;
    if (!backend) return disabled(c);

    const blobId = c.req.param('blobId');
    if (!BLOB_ID_RE.test(blobId)) return c.json(errorBody('bad_request', 'malformed blobId'), 400);

    const row = await findBlob(db, sub, blobId);
    if (!row) {
      onDownload('not_found');
      return c.json(errorBody('not_found', 'no such blob'), 404);
    }

    let obj: { stream: ReadableStream<Uint8Array>; length: number } | null;
    try {
      obj = await backend.getStream(blobKey(sub, blobId));
    } catch {
      onBackendError();
      onDownload('backend_error');
      return c.json(errorBody('blob_backend_unavailable', 'the object store is unavailable'), 503);
    }
    if (!obj) {
      // Row present, object gone (backup skew) — 404 + inconsistency (spec §7.2).
      onInconsistency();
      onDownload('missing_object');
      return c.json(errorBody('not_found', 'no such blob'), 404);
    }

    onDownload('ok');
    c.header('Content-Type', 'application/octet-stream');
    c.header('Content-Length', String(obj.length));
    c.header('Cache-Control', 'no-store');
    return c.body(verifyingDownload(obj.stream, row.ciphertextHash, onInconsistency));
  });

  // --- DELETE /api/v1/sync/blobs/:blobId (spec §7.3) ------------------------
  app.delete('/api/v1/sync/blobs/:blobId', async (c) => {
    const auth = await authenticate(c, deps);
    if (!auth.ok) return auth.response;
    const sub = auth.claims.sub;
    const backend = deps.blobBackend;
    if (!backend) return disabled(c);

    const blobId = c.req.param('blobId');
    if (!BLOB_ID_RE.test(blobId)) return c.json(errorBody('bad_request', 'malformed blobId'), 400);

    // Shares the per-account delete-rate window with record tombstones — the
    // SAME limiter key `del:<sub>` the record channel uses (spec §7.3).
    if (!(await allow(`del:${sub}`, env.RATE_LIMIT_DELETE_PER_MIN, 60))) {
      c.header('Retry-After', '60');
      return c.json(errorBody('delete_rate_limited', 'delete rate limit exceeded'), 429);
    }

    // DB-first (spec §7.3): commit the row delete + quota credit, then S3 after.
    await deleteBlobRow(db, sub, blobId, env.BLOB_QUOTA_FLOOR_BYTES);
    await backend.delete(blobKey(sub, blobId)).catch(() => {}); // best-effort; orphan → sweep
    onDelete();
    return c.body(null, 204);
  });
}
