// SPDX-License-Identifier: AGPL-3.0-only

import { createHash, createHmac } from 'node:crypto';
import type { Env } from '../env.js';

// A minimal S3-compatible client (blob spec §3/§7/§8). Deliberately hand-rolled
// over `fetch` + AWS SigV4 rather than a heavyweight SDK or Bun.S3Client:
//  - single-shot streaming PUT with UNSIGNED-PAYLOAD + a known Content-Length
//    (no full buffering, and NO multipart — so the §8 AbortIncompleteMultipart
//    lifecycle rule is unnecessary by construction; recorded in probes/README);
//  - bucket-admin operations (create, versioning check) that Bun.S3Client does
//    not expose but the bootstrap (§8) requires.
// This is a documented deviation from Task 0's provisional Bun.S3Client pick.
// The object legs are exercised live under S3_TEST_ENDPOINT; the SigV4 signing
// is verified offline against AWS's published test vector.

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const UNSIGNED = 'UNSIGNED-PAYLOAD';
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** The object-store abstraction the routes consume; swappable for tests. */
export interface BlobBackend {
  putStream(key: string, body: ReadableStream<Uint8Array>, length: number): Promise<void>;
  getStream(key: string): Promise<{ stream: ReadableStream<Uint8Array>; length: number } | null>;
  /** Idempotent; retries with short backoff (spec §7.1). */
  delete(key: string): Promise<void>;
  healthy(): Promise<boolean>;
}

/** S3 object key: `<account_id>/<blob_id>` (blob spec §4). */
export const blobKey = (accountId: string, blobId: string): string => `${accountId}/${blobId}`;

function hmac(key: Uint8Array | string, data: string): Uint8Array {
  return new Uint8Array(createHmac('sha256', key).update(data, 'utf8').digest());
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Derives the SigV4 signing key (blob spec §7 auth is JWT; this signs the
 * service→S3 hop). Exported for the offline AWS test-vector assertion.
 */
export function deriveSigningKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Uint8Array {
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

// RFC 3986 encoding for a single path segment (S3 canonical URI rules).
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function s3Config(env: Env): S3Config {
  if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw new Error('createS3Backend called without a configured S3 endpoint + credentials');
  }
  return {
    endpoint: env.S3_ENDPOINT.replace(/\/+$/, ''),
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  };
}

function amzDate(now: Date): { amz: string; stamp: string } {
  const amz = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amz, stamp: amz.slice(0, 8) };
}

/**
 * Signs a path-style S3 request (MinIO's addressing). `canonicalPath` is the
 * already-slash-joined, per-segment-encoded path beginning with `/`.
 */
function signRequest(
  cfg: S3Config,
  method: string,
  canonicalPath: string,
  query: string,
  payloadHash: string,
  now: Date,
  extraHeaders: Record<string, string> = {},
): SignedRequest {
  const { amz, stamp } = amzDate(now);
  const host = new URL(cfg.endpoint).host;
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amz,
    ...extraHeaders,
  };
  const signedHeaderNames = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const canonicalHeaders = `${signedHeaderNames
    .map(
      (h) =>
        `${h}:${String(headers[Object.keys(headers).find((k) => k.toLowerCase() === h) as string]).trim()}`,
    )
    .join('\n')}\n`;
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [
    method,
    canonicalPath,
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${stamp}/${cfg.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amz, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = deriveSigningKey(cfg.secretAccessKey, stamp, cfg.region, SERVICE);
  const signature = Buffer.from(hmac(signingKey, stringToSign)).toString('hex');
  const authorization = `${ALGORITHM} Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    url: `${cfg.endpoint}${canonicalPath}${query ? `?${query}` : ''}`,
    headers: { ...headers, authorization },
  };
}

function objectPath(cfg: S3Config, key: string): string {
  const segments = key.split('/').map(encodeSegment).join('/');
  return `/${cfg.bucket}/${segments}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

class HttpS3Backend implements BlobBackend {
  constructor(private readonly cfg: S3Config) {}

  async putStream(key: string, body: ReadableStream<Uint8Array>, length: number): Promise<void> {
    const signed = signRequest(
      this.cfg,
      'PUT',
      objectPath(this.cfg, key),
      '',
      UNSIGNED,
      new Date(),
      {
        'content-length': String(length),
        'content-type': 'application/octet-stream',
      },
    );
    const res = await fetch(signed.url, {
      method: 'PUT',
      headers: signed.headers,
      // Bun streams the request body chunk-wise with a known Content-Length.
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`S3 PUT failed: ${res.status} ${detail.slice(0, 200)}`);
    }
    await res.body?.cancel().catch(() => {});
  }

  async getStream(
    key: string,
  ): Promise<{ stream: ReadableStream<Uint8Array>; length: number } | null> {
    const signed = signRequest(
      this.cfg,
      'GET',
      objectPath(this.cfg, key),
      '',
      UNSIGNED,
      new Date(),
    );
    const res = await fetch(signed.url, { method: 'GET', headers: signed.headers });
    if (res.status === 404) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`S3 GET failed: ${res.status}`);
    }
    const length = Number(res.headers.get('content-length') ?? '0');
    return { stream: res.body as ReadableStream<Uint8Array>, length };
  }

  async delete(key: string): Promise<void> {
    // Idempotent (absent → 204/404 both fine); short-backoff retries (§7.1).
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const signed = signRequest(
          this.cfg,
          'DELETE',
          objectPath(this.cfg, key),
          '',
          EMPTY_SHA256,
          new Date(),
        );
        const res = await fetch(signed.url, { method: 'DELETE', headers: signed.headers });
        await res.body?.cancel().catch(() => {});
        if (res.status === 204 || res.status === 200 || res.status === 404) return;
        lastError = new Error(`S3 DELETE failed: ${res.status}`);
      } catch (e) {
        lastError = e;
      }
      await sleep(100 * 2 ** attempt);
    }
    throw lastError instanceof Error ? lastError : new Error('S3 DELETE failed');
  }

  async healthy(): Promise<boolean> {
    try {
      // A cheap bucket-scoped list (max 1 key) proves reachability + access.
      const signed = signRequest(
        this.cfg,
        'GET',
        `/${this.cfg.bucket}`,
        'list-type=2&max-keys=1',
        EMPTY_SHA256,
        new Date(),
      );
      const res = await fetch(signed.url, { method: 'GET', headers: signed.headers });
      await res.body?.cancel().catch(() => {});
      // 200 (reachable + bucket present) — anything that returns an HTTP status
      // proves the endpoint is up; a network error throws below.
      return res.status < 500;
    } catch {
      return false;
    }
  }
}

/** Builds the live S3 backend from env (blob spec §14). */
export function createS3Backend(env: Env): BlobBackend {
  return new HttpS3Backend(s3Config(env));
}

/**
 * Idempotent bucket bootstrap (blob spec §8): creates the bucket if absent and
 * warns loudly if object versioning is enabled (versioning silently breaks the
 * deletion promise). Never throws on an unreachable endpoint — logs and returns
 * false so records serve regardless; the boot wiring retries in the background.
 * No multipart-abort lifecycle rule is set: uploads are single-shot (§8, probes).
 */
export async function bootstrapBucket(
  env: Env,
  log: (level: 'info' | 'warn' | 'error', msg: string) => void = () => {},
): Promise<boolean> {
  let cfg: S3Config;
  try {
    cfg = s3Config(env);
  } catch {
    return false;
  }
  try {
    // Create the bucket (idempotent: 200, or 409 BucketAlreadyOwnedByYou/Exists).
    const create = signRequest(cfg, 'PUT', `/${cfg.bucket}`, '', EMPTY_SHA256, new Date());
    const createRes = await fetch(create.url, { method: 'PUT', headers: create.headers });
    await createRes.body?.cancel().catch(() => {});
    if (createRes.status >= 500) {
      log('error', `blob bucket bootstrap: S3 returned ${createRes.status}; will retry`);
      return false;
    }

    // Verify versioning is not enabled — it would resurrect every deleted blob.
    const ver = signRequest(cfg, 'GET', `/${cfg.bucket}`, 'versioning=', EMPTY_SHA256, new Date());
    const verRes = await fetch(ver.url, { method: 'GET', headers: ver.headers });
    const verBody = await verRes.text().catch(() => '');
    if (/<Status>\s*Enabled\s*<\/Status>/i.test(verBody)) {
      log(
        'warn',
        'blob bucket has object VERSIONING enabled — every DELETE leaves the ' +
          'ciphertext retrievable as a prior version, breaking the deletion promise. ' +
          'Disable versioning on the blob bucket (see DEPLOYMENT ch.10).',
      );
    }
    log('info', 'blob bucket bootstrap complete');
    return true;
  } catch (e) {
    log('error', `blob bucket bootstrap failed (S3 unreachable?): ${(e as Error).message}`);
    return false;
  }
}
