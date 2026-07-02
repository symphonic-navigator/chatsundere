// SPDX-License-Identifier: AGPL-3.0-only

import { Counter, Gauge, Histogram, collectDefaultMetrics, register } from 'prom-client';

let initialised = false;

// Anonymous, ciphertext-blind (spec §10.2): NO account_id/sub/jti/blind_id label,
// and NO `collection` label in v1 (per-collection counts are account-correlatable
// at the current cohort size).
let pushRecordsTotal: Counter<'outcome'>;
let pullTotal: Counter<string>;
let pullRecordsTotal: Counter<string>;
let doorbellConnections: Gauge<string>;
let doorbellPokesTotal: Counter<string>;
let unauthorizedTotal: Counter<string>;
let revokedTotal: Counter<string>;
let rateLimitedTotal: Counter<string>;
let pushLatency: Histogram<string>;
let pullLatency: Histogram<string>;
let recordSize: Histogram<string>;
// Blob transport (blob spec §8) — outcome labels only, NEVER account_id/blob_id.
let blobUploadsTotal: Counter<'outcome'>;
let blobDownloadsTotal: Counter<'outcome'>;
let blobDeletesTotal: Counter<string>;
let blobBytes: Histogram<string>;
let blobBackendErrorsTotal: Counter<string>;
let blobBackendUp: Gauge<string>;
let blobInconsistencyTotal: Counter<string>;

export function initialiseMetrics(): void {
  if (initialised) return;
  collectDefaultMetrics({ register, prefix: 'sync_' });

  pushRecordsTotal = new Counter({
    name: 'sync_push_records_total',
    help: 'Pushed records by per-record outcome',
    labelNames: ['outcome'] as const,
    registers: [register],
  });
  pullTotal = new Counter({
    name: 'sync_pull_total',
    help: 'Pull requests served',
    registers: [register],
  });
  pullRecordsTotal = new Counter({
    name: 'sync_pull_records_total',
    help: 'Records returned across pulls',
    registers: [register],
  });
  doorbellConnections = new Gauge({
    name: 'sync_doorbell_connections',
    help: 'Currently open doorbell sockets',
    registers: [register],
  });
  doorbellPokesTotal = new Counter({
    name: 'sync_doorbell_pokes_total',
    help: 'Doorbell pokes forwarded to sockets',
    registers: [register],
  });
  unauthorizedTotal = new Counter({
    name: 'sync_unauthorized_total',
    help: 'Requests refused for a missing or invalid token',
    registers: [register],
  });
  revokedTotal = new Counter({
    name: 'sync_revoked_total',
    help: 'Requests refused by the revocation deny-list',
    registers: [register],
  });
  rateLimitedTotal = new Counter({
    name: 'sync_rate_limited_total',
    help: 'Requests refused by a rate limit',
    registers: [register],
  });
  pushLatency = new Histogram({
    name: 'sync_push_latency_seconds',
    help: 'Push handler latency',
    registers: [register],
  });
  pullLatency = new Histogram({
    name: 'sync_pull_latency_seconds',
    help: 'Pull handler latency',
    registers: [register],
  });
  recordSize = new Histogram({
    name: 'sync_record_size_bytes',
    help: 'Stored ciphertext size (coarse buckets by design)',
    buckets: [1024, 16384, 262144, 1048576, 2097152],
    registers: [register],
  });

  blobUploadsTotal = new Counter({
    name: 'sync_blob_uploads_total',
    help: 'Blob uploads by outcome',
    labelNames: ['outcome'] as const,
    registers: [register],
  });
  blobDownloadsTotal = new Counter({
    name: 'sync_blob_downloads_total',
    help: 'Blob downloads by outcome',
    labelNames: ['outcome'] as const,
    registers: [register],
  });
  blobDeletesTotal = new Counter({
    name: 'sync_blob_deletes_total',
    help: 'Blob deletes served',
    registers: [register],
  });
  blobBytes = new Histogram({
    name: 'sync_blob_bytes',
    help: 'Uploaded blob ciphertext size (coarse buckets by design)',
    buckets: [65536, 262144, 1048576, 8388608, 33554432],
    registers: [register],
  });
  blobBackendErrorsTotal = new Counter({
    name: 'sync_blob_backend_errors_total',
    help: 'S3 backend errors observed on the blob path',
    registers: [register],
  });
  blobBackendUp = new Gauge({
    name: 'sync_blob_backend_up',
    help: 'S3 backend liveness (1 up, 0 down); a metric, not a readiness criterion',
    registers: [register],
  });
  blobInconsistencyTotal = new Counter({
    name: 'sync_blob_inconsistency_total',
    help: 'DB/S3 inconsistencies detected (row without object, or hash mismatch on GET)',
    registers: [register],
  });

  initialised = true;
}

export function recordBlobUpload(outcome: string): void {
  blobUploadsTotal?.inc({ outcome });
}
export function recordBlobDownload(outcome: string): void {
  blobDownloadsTotal?.inc({ outcome });
}
export function recordBlobDelete(): void {
  blobDeletesTotal?.inc();
}
export function observeBlobBytes(bytes: number): void {
  blobBytes?.observe(bytes);
}
export function recordBlobBackendError(): void {
  blobBackendErrorsTotal?.inc();
}
export function setBlobBackendUp(up: boolean): void {
  blobBackendUp?.set(up ? 1 : 0);
}
export function recordBlobInconsistency(): void {
  blobInconsistencyTotal?.inc();
}

export function recordPushOutcome(outcome: string): void {
  pushRecordsTotal?.inc({ outcome });
}
export function recordPull(recordCount: number): void {
  pullTotal?.inc();
  pullRecordsTotal?.inc(recordCount);
}
export function doorbellConnected(): void {
  doorbellConnections?.inc();
}
export function doorbellDisconnected(): void {
  doorbellConnections?.dec();
}
export function recordPoke(): void {
  doorbellPokesTotal?.inc();
}
export function recordUnauthorized(): void {
  unauthorizedTotal?.inc();
}
export function recordRevoked(): void {
  revokedTotal?.inc();
}
export function recordRateLimited(): void {
  rateLimitedTotal?.inc();
}
export function observePushLatency(seconds: number): void {
  pushLatency?.observe(seconds);
}
export function observePullLatency(seconds: number): void {
  pullLatency?.observe(seconds);
}
export function observeRecordSize(bytes: number): void {
  recordSize?.observe(bytes);
}

export async function renderMetrics(): Promise<{ body: string; contentType: string }> {
  return { body: await register.metrics(), contentType: register.contentType };
}
