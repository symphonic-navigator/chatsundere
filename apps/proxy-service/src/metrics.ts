// SPDX-License-Identifier: AGPL-3.0-only

import { Counter, collectDefaultMetrics, register } from 'prom-client';

let initialised = false;

// Anonymous counters only — NO sub/jti label ever (spec §8.2). The LLM host label
// value is pre-normalised by the caller (known set → host, else 'other'); the MCP
// path never computes a host label.
let requestsTotal: Counter<'kind' | 'outcome'>;
let llmRequestsTotal: Counter<'host' | 'outcome'>;
let ssrfBlockedTotal: Counter<string>;
let unauthorizedTotal: Counter<string>;
let rateLimitedTotal: Counter<string>;

export function initialiseMetrics(): void {
  if (initialised) return;
  collectDefaultMetrics({ register, prefix: 'proxy_' });

  requestsTotal = new Counter({
    name: 'proxy_requests_total',
    help: 'Proxied requests by kind and outcome',
    labelNames: ['kind', 'outcome'] as const,
    registers: [register],
  });
  llmRequestsTotal = new Counter({
    name: 'proxy_llm_requests_total',
    help: 'Proxied LLM requests by known host (else other) and outcome',
    labelNames: ['host', 'outcome'] as const,
    registers: [register],
  });
  ssrfBlockedTotal = new Counter({
    name: 'proxy_ssrf_blocked_total',
    help: 'Requests refused because the target resolved to a blocked range',
    registers: [register],
  });
  unauthorizedTotal = new Counter({
    name: 'proxy_unauthorized_total',
    help: 'Requests refused for a missing or invalid account token',
    registers: [register],
  });
  rateLimitedTotal = new Counter({
    name: 'proxy_rate_limited_total',
    help: 'Requests refused by the per-IP or per-user rate limit',
    registers: [register],
  });

  initialised = true;
}

/** Records a proxied request. `kind ∈ {llm, mcp}`, `outcome` per spec §8.2. */
export function recordRequest(labels: {
  kind: 'llm' | 'mcp';
  outcome: 'ok' | 'upstream_error' | 'unauthorized' | 'blocked' | 'rate_limited';
}): void {
  requestsTotal?.inc(labels);
}

/** Records an LLM request. `host` MUST already be normalised by the caller (Task 3). */
export function recordLlmRequest(labels: { host: string; outcome: 'ok' | 'upstream_error' }): void {
  llmRequestsTotal?.inc(labels);
}

/** Counts an SSRF private-range block. */
export function recordSsrfBlocked(): void {
  ssrfBlockedTotal?.inc();
}

/** Counts a rejected (missing/invalid) account token. */
export function recordUnauthorized(): void {
  unauthorizedTotal?.inc();
}

/** Counts a rate-limited request (per-IP or per-user). */
export function recordRateLimited(): void {
  rateLimitedTotal?.inc();
}

export async function renderMetrics(): Promise<{ body: string; contentType: string }> {
  return { body: await register.metrics(), contentType: register.contentType };
}
