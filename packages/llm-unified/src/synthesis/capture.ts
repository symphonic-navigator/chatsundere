// SPDX-License-Identifier: LGPL-3.0-only
import type { CapturedFixture, Probe } from './fixture-types.js';

/** Minimal fetch interface — accepts any compliant fetch or a test double. */
export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface RunProbeArgs {
  baseUrl: string;
  apiKey: string;
  probe: Probe;
  fetchFn?: FetchFn;
}

/**
 * Run one probe against the provider and capture the raw response verbatim.
 * Never throws on upstream errors — a 4xx/5xx is itself evidence (e.g. the
 * contradiction probe expects a 400). Uses direct-routing (no CORS proxy) —
 * the CLI always has direct access to the provider.
 */
export async function runProbe(args: RunProbeArgs): Promise<CapturedFixture> {
  const fetchFn = args.fetchFn ?? globalThis.fetch.bind(globalThis);
  const base = args.baseUrl.endsWith('/') ? args.baseUrl.slice(0, -1) : args.baseUrl;
  const url = `${base}/chat/completions`;
  const response = await fetchFn(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args.probe.body),
  });
  const rawResponse = await response.text();
  return {
    probeId: args.probe.id,
    dimension: args.probe.dimension,
    requestBody: args.probe.body,
    status: response.status,
    rawResponse,
  };
}
