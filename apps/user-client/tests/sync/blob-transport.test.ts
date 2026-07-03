// SPDX-License-Identifier: AGPL-3.0-only
import type { BlobRef } from '@chatsundere/shared-types';
import { useDiscoveryStore, useSessionStore } from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BlobCorruptBodyError,
  BlobNotFoundError,
  BlobRefError,
  BlobsDisabledError,
  deleteBlob,
  getBlob,
  listBlobs,
  putBlob,
  validateBlobRef,
} from '../../src/sync/blob-transport.js';

const SYNC_URL = 'https://sync.example';
const GOOD_ID = 'AAAAAAAAAAAAAAAAAAAAAA'; // 22 base64url chars

const realFetch = globalThis.fetch;

function seedLinked(): void {
  useDiscoveryStore.setState({
    status: 'ok',
    // biome-ignore lint/suspicious/noExplicitAny: partial store shape for the test
    config: { syncUrl: SYNC_URL, features: ['sync'] } as any,
  });
  useSessionStore.setState({
    session: { accessToken: 'tok', close: () => undefined } as never,
    mk: {} as never,
  });
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(handler: Handler): ReturnType<typeof vi.fn> {
  const fn = vi.fn(handler);
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function streamResponse(chunks: Uint8Array[], status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(stream, { status });
}

describe('blob-transport — validateBlobRef (§11.7)', () => {
  it('accepts a well-formed ref', () => {
    const ref: BlobRef = { blobId: GOOD_ID, bytes: 1028 };
    expect(validateBlobRef(ref)).toEqual(ref);
  });

  it('rejects a short blobId, a non-integer size, a negative size, and a non-object', () => {
    expect(() => validateBlobRef({ blobId: 'short', bytes: 5 })).toThrow(BlobRefError);
    expect(() => validateBlobRef({ blobId: GOOD_ID, bytes: 1.5 })).toThrow(BlobRefError);
    expect(() => validateBlobRef({ blobId: GOOD_ID, bytes: -1 })).toThrow(BlobRefError);
    expect(() => validateBlobRef({ blobId: GOOD_ID, bytes: 2 ** 40 })).toThrow(BlobRefError);
    expect(() => validateBlobRef(null)).toThrow(BlobRefError);
  });
});

describe('blob-transport — verbs', () => {
  beforeEach(() => {
    seedLinked();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
    useDiscoveryStore.setState({ status: 'idle', config: null } as never);
    useSessionStore.setState({ session: null, mk: null });
  });

  it('putBlob PUTs with the caller hash + bearer and maps 201 → created', async () => {
    const fn = mockFetch(() => jsonResponse({ status: 'created' }, 201));
    const result = await putBlob(GOOD_ID, new Uint8Array([1, 2, 3]), 'localhash');
    expect(result).toEqual({ status: 'created' });

    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${SYNC_URL}/api/v1/sync/blobs/${GOOD_ID}`);
    expect(init.method).toBe('PUT');
    const headers = init.headers as Headers;
    // The x-ciphertext-hash is exactly the caller's local seal output (§11.2).
    expect(headers.get('x-ciphertext-hash')).toBe('localhash');
    expect(headers.get('Authorization')).toBe('Bearer tok');
  });

  it('putBlob maps 200 → ok (idempotent re-put)', async () => {
    mockFetch(() => jsonResponse({ status: 'ok' }, 200));
    expect(await putBlob(GOOD_ID, new Uint8Array([1]), 'h')).toEqual({ status: 'ok' });
  });

  it('putBlob maps 409 → blob_exists', async () => {
    mockFetch(() => jsonResponse({ error: { code: 'blob_exists', message: 'x' } }, 409));
    expect(await putBlob(GOOD_ID, new Uint8Array([1]), 'h')).toEqual({ status: 'blob_exists' });
  });

  it('putBlob maps 413 → blob_too_large with the operator limit', async () => {
    mockFetch(() =>
      jsonResponse({ error: { code: 'blob_too_large', message: 'x', maxBlobBytes: 5000 } }, 413),
    );
    expect(await putBlob(GOOD_ID, new Uint8Array([1]), 'h')).toEqual({
      status: 'blob_too_large',
      maxBlobBytes: 5000,
    });
  });

  it('putBlob maps 507 → quota_exceeded with used/quota bytes', async () => {
    mockFetch(() =>
      jsonResponse(
        { error: { code: 'quota_exceeded', message: 'x', usedBytes: 900, quotaBytes: 1000 } },
        507,
      ),
    );
    expect(await putBlob(GOOD_ID, new Uint8Array([1]), 'h')).toEqual({
      status: 'quota_exceeded',
      usedBytes: 900,
      quotaBytes: 1000,
    });
  });

  it('putBlob maps 501 → blobs_disabled', async () => {
    mockFetch(() => jsonResponse({ error: { code: 'blobs_disabled', message: 'x' } }, 501));
    expect(await putBlob(GOOD_ID, new Uint8Array([1]), 'h')).toEqual({ status: 'blobs_disabled' });
  });

  it('getBlob returns the streamed bytes on a within-size body', async () => {
    const bytes = new Uint8Array([10, 20, 30, 40, 50]);
    const fn = mockFetch(() => streamResponse([bytes]));
    const out = await getBlob({ blobId: GOOD_ID, bytes: 5 });
    expect(Array.from(out)).toEqual([10, 20, 30, 40, 50]);
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${SYNC_URL}/api/v1/sync/blobs/${GOOD_ID}`);
    expect(init.method).toBe('GET');
  });

  it('getBlob ABORTS a stream longer than ref.bytes → corrupt-body error (§6 gate)', async () => {
    // ref promises 4 bytes; the server streams 10 — the gate must fire.
    mockFetch(() => streamResponse([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])]));
    await expect(getBlob({ blobId: GOOD_ID, bytes: 4 })).rejects.toBeInstanceOf(
      BlobCorruptBodyError,
    );
  });

  it('getBlob maps 404 → BlobNotFoundError', async () => {
    mockFetch(() => jsonResponse({ error: { code: 'not_found', message: 'x' } }, 404));
    await expect(getBlob({ blobId: GOOD_ID, bytes: 5 })).rejects.toBeInstanceOf(BlobNotFoundError);
  });

  it('getBlob maps 501 → BlobsDisabledError', async () => {
    mockFetch(() => jsonResponse({ error: { code: 'blobs_disabled', message: 'x' } }, 501));
    await expect(getBlob({ blobId: GOOD_ID, bytes: 5 })).rejects.toBeInstanceOf(BlobsDisabledError);
  });

  it('deleteBlob DELETEs and resolves on 204', async () => {
    const fn = mockFetch(() => new Response(null, { status: 204 }));
    await expect(deleteBlob(GOOD_ID)).resolves.toBeUndefined();
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${SYNC_URL}/api/v1/sync/blobs/${GOOD_ID}`);
    expect(init.method).toBe('DELETE');
  });

  it('listBlobs returns the inventory response', async () => {
    const inventory = {
      blobs: [{ blobId: GOOD_ID, bytes: 100 }],
      totalBytes: 100,
      quotaBytes: 1000,
    };
    const fn = mockFetch(() => jsonResponse(inventory, 200));
    expect(await listBlobs()).toEqual(inventory);
    const [url] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${SYNC_URL}/api/v1/sync/blobs`);
  });

  it('refreshes once on a 401 and retries the request', async () => {
    let putCalls = 0;
    let refreshCalls = 0;
    const fn = mockFetch((url) => {
      if (url.includes('/api/v1/token/refresh')) {
        refreshCalls += 1;
        return jsonResponse({ access_token: 'tok2', expires_in: 900 }, 200);
      }
      putCalls += 1;
      if (putCalls === 1) return new Response(null, { status: 401 });
      return jsonResponse({ status: 'created' }, 201);
    });

    const result = await putBlob(GOOD_ID, new Uint8Array([1]), 'h');
    expect(result).toEqual({ status: 'created' });
    expect(refreshCalls).toBe(1);
    expect(putCalls).toBe(2);
    // The retry carries the refreshed token.
    const retryInit = fn.mock.calls.at(-1)?.[1] as RequestInit;
    expect((retryInit.headers as Headers).get('Authorization')).toBe('Bearer tok2');
  });

  it('does NOT refresh a second time if the retry also 401s', async () => {
    let refreshCalls = 0;
    mockFetch((url) => {
      if (url.includes('/api/v1/token/refresh')) {
        refreshCalls += 1;
        return jsonResponse({ access_token: 'tok2', expires_in: 900 }, 200);
      }
      return new Response(null, { status: 401 });
    });
    // The second 401 is returned as a typed error, not another refresh loop.
    const result = await putBlob(GOOD_ID, new Uint8Array([1]), 'h');
    expect(result.status).toBe('error');
    expect(refreshCalls).toBe(1);
  });
});

describe('blob-transport — malformed ref rejection before any fetch (§11.7)', () => {
  beforeEach(() => {
    seedLinked();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    useDiscoveryStore.setState({ status: 'idle', config: null } as never);
    useSessionStore.setState({ session: null, mk: null });
  });

  it('getBlob rejects a malformed ref without touching fetch', async () => {
    const fn = mockFetch(() => new Response(null, { status: 200 }));
    await expect(getBlob({ blobId: 'short', bytes: 5 } as BlobRef)).rejects.toBeInstanceOf(
      BlobRefError,
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it('putBlob rejects a malformed blobId without touching fetch', async () => {
    const fn = mockFetch(() => new Response(null, { status: 200 }));
    await expect(putBlob('short', new Uint8Array([1]), 'h')).rejects.toBeInstanceOf(BlobRefError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('deleteBlob rejects a malformed blobId without touching fetch', async () => {
    const fn = mockFetch(() => new Response(null, { status: 200 }));
    await expect(deleteBlob('short')).rejects.toBeInstanceOf(BlobRefError);
    expect(fn).not.toHaveBeenCalled();
  });
});
