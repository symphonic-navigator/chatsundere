// SPDX-License-Identifier: LGPL-3.0-only

import { buildRequest } from './transport.js';
import type { ProbeResult, ProviderConfig, ProviderDefinition } from './types.js';

export interface ProbeArgs {
  definition: ProviderDefinition;
  config: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  fetchFn?: typeof fetch;
}

/**
 * Hit the provider's probe endpoint to verify credentials and connectivity.
 * Returns a structured ProbeResult — no throws on upstream errors; only
 * on programmer errors (invalid routing config). Used by My Settings to
 * surface a green/red badge next to the provider.
 */
export async function probeProvider(args: ProbeArgs): Promise<ProbeResult> {
  const fetchFn = args.fetchFn ?? globalThis.fetch.bind(globalThis);
  const request = buildRequest({
    provider: args.config,
    apiKey: args.apiKey,
    corsProxyUrl: args.corsProxyUrl,
    corsProxyKey: args.corsProxyKey,
    path: args.definition.probe.path,
    method: args.definition.probe.method,
  });

  let response: Response;
  try {
    response = await fetchFn(request);
  } catch (e) {
    return { ok: false, status: 0, reason: (e as Error).message };
  }

  if (!response.ok) {
    const text = await safeReadText(response);
    return {
      ok: false,
      status: response.status,
      reason: text ? text.slice(0, 200) : response.statusText,
    };
  }

  let modelCount: number | undefined;
  try {
    const json = (await response.json()) as { data?: Array<{ id?: string }> };
    if (Array.isArray(json.data)) modelCount = json.data.length;
  } catch {
    // Non-JSON 200 is fine; we still report ok.
  }

  return { ok: true, status: response.status, modelCount };
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
