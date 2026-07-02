// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Known LLM provider hosts. Used ONLY to bound the Prometheus label cardinality
 * (spec §8.2) — never as an egress allow-list. Seeded from the provider base
 * URLs in packages/llm-unified; extend with the exact host only (never a suffix).
 */
const KNOWN_LLM_HOSTS = new Set<string>([
  'api.x.ai',
  'api.mistral.ai',
  'api.novita.ai',
  'api.tensorix.ai',
  'llm.chutes.ai',
  'nano-gpt.com',
  'ollama.com',
  'openrouter.ai',
  'pass.wafer.ai',
]);

/** Exact-match (lowercased) a host to the known set, else 'other'. Never a suffix match. */
export function normaliseLlmHost(host: string): string {
  const h = host.toLowerCase();
  return KNOWN_LLM_HOSTS.has(h) ? h : 'other';
}
