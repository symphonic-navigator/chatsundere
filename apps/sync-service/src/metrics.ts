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

export function initialiseMetrics(): void {
  if (initialised) return;
  collectDefaultMetrics({ register, prefix: 'sync_' });

  pushRecordsTotal = new Counter({
    name: 'sync_push_records_total',
    help: 'Pushed records by per-record outcome',
    labelNames: ['outcome'] as const,
    registers: [register],
  });
  pullTotal = new Counter({ name: 'sync_pull_total', help: 'Pull requests served', registers: [register] });
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
  pushLatency = new Histogram({ name: 'sync_push_latency_seconds', help: 'Push handler latency', registers: [register] });
  pullLatency = new Histogram({ name: 'sync_pull_latency_seconds', help: 'Pull handler latency', registers: [register] });
  recordSize = new Histogram({
    name: 'sync_record_size_bytes',
    help: 'Stored ciphertext size (coarse buckets by design)',
    buckets: [1024, 16384, 262144, 1048576, 2097152],
    registers: [register],
  });

  initialised = true;
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
