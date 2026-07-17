// SPDX-License-Identifier: LGPL-3.0-only

import { registerAdapter } from '../adapter-registry.js';
import { ollamaNativeAdapter } from '../adapters/ollama-native.js';
import type { Offering, ReasoningControl } from '../catalogue/types.js';
import { registerWebAdapter } from '../integrations/web-adapter-registry.js';
import type { SearchTier, WebOfferingMeta } from '../integrations/web-interfacing.js';
import { registerProvider } from '../registry.js';
import type { ProviderDefinition } from '../types.js';
import { ollamaWebFetchAdapter, ollamaWebSearchAdapter } from '../web-adapters/ollama-web.js';
import { apiKeyField } from './_helpers.js';

// ollama.com serves reasoning-native models that cannot disable thinking
// (`think:false` still streams a `reasoning` channel) → fixed-on. Live-measured
// 2026-06-03.
const FIXED_ON: ReasoningControl = { mode: 'fixed-on' };

interface OllamaSpec {
  canonicalRef: string;
  slug: string;
  reasoning: ReasoningControl;
  vision: boolean;
  ctx: number;
  // Optional hard ceiling distinct from the recommended window. Defaults to
  // `ctx` (recommended === max).
  maxCtx?: number;
  // Zero data retention. A deployment-level property — ollama enforces it
  // server-side with no per-request flag, so this only drives the trust badge.
  // Defaults to false; set true only where ollama states ZDR for that model.
  zdr?: boolean;
}

function ollamaOffering(spec: OllamaSpec): Offering {
  return {
    canonicalRef: spec.canonicalRef,
    providerId: 'ollama-cloud',
    upstreamSlug: spec.slug,
    adapter: { kind: 'catalogue', adapterId: `ollama-cloud:${spec.slug}` },
    profile: {
      reasoning: spec.reasoning,
      toolCalls: { supported: true, streaming: true, concurrentWithReasoning: false },
      vision: spec.vision,
      replayReasoning: false,
    },
    context: { recommended: spec.ctx, max: spec.maxCtx ?? spec.ctx },
    trust: { tee: false, zdr: spec.zdr ?? false },
    freedomOrientedDeployment: null,
    source: 'curated',
    confidence: 'verified',
    serviceKind: 'llm',
  };
}

// Curated set, live-verified against ollama.com via run-ollama-suite.ts
// (2026-06-03). The earlier heuristic set carried three slugs that do not exist
// on ollama.com (`glm-5`, `deepseek-v4-flash`, `kimi-k2.6`) plus wrong reasoning
// controls — removed. `gemma4:31b` was dropped too: ollama serves a non-reasoning
// Gemma, which cannot satisfy the reasoning-required `gemma-4-31b` canonical.
//
// These talk to ollama's NATIVE `/api/chat` (NDJSON) via `ollamaNativeAdapter`,
// NOT the OpenAI-compat `/v1/chat/completions` shim — the shim makes these
// reasoning-native models re-call the tool instead of answering after a tool
// result (live-measured); the native endpoint answers correctly.
const SPECS: OllamaSpec[] = [
  { canonicalRef: 'glm-5.1', slug: 'glm-5.1', reasoning: FIXED_ON, vision: false, ctx: 200_000 },
  // GLM 5.2 is served under the `:cloud` slug (bare `glm-5.2` 404s on ollama.com).
  // Classified fixed-on for the same reason as GLM 5.1: think:false was believed
  // to still stream reasoning (leaking into content). Superseded 2026-07-17: on
  // the native `/api/chat` endpoint, think:false yields clean content and an
  // empty thinking channel — it genuinely disables reasoning, and this does not
  // reproduce. Whether `fixed-on` should become a user-facing toggle is
  // deferred to Chris (see obsidian/providers/ollama-cloud.md); the
  // classification is unchanged for now. /api/show reports a 1,000,000
  // ceiling; recommended capped at 200k. Live-probed 2026-06-17.
  // ZDR: ollama states GLM 5.2 is hosted in the US and Europe "with zero data
  // retention. Your data is never trained on." It is enforced server-side with
  // no per-request flag, so the badge is purely a deployment property (cf. the
  // chutes TEE flag). Scoped to GLM 5.2 only — ollama makes no such statement
  // for GLM 5.1 or DeepSeek V4 Pro, so they stay zdr:false. (Chris, 2026-06-30.)
  {
    canonicalRef: 'glm-5.2',
    slug: 'glm-5.2:cloud',
    reasoning: FIXED_ON,
    vision: false,
    ctx: 200_000,
    maxCtx: 1_000_000,
    zdr: true,
  },
  {
    canonicalRef: 'deepseek-v4-pro',
    slug: 'deepseek-v4-pro',
    reasoning: FIXED_ON,
    vision: false,
    ctx: 200_000,
  },
];

// Ollama's /api/web_search takes max_results (1–10). Listed recommended-first so
// tiers[0] (the no-pick default) is the 5-result "standard".
const OLLAMA_TIERS: SearchTier[] = [
  { id: 'standard', label: 'Standard', params: { numResults: 5 } },
  { id: 'quick', label: 'Quick', tooltip: 'fewer results, faster', params: { numResults: 3 } },
  { id: 'deep', label: 'Deep', tooltip: 'more results, slower', params: { numResults: 10 } },
];

function ollamaWebOffering(slug: string, meta: WebOfferingMeta): Offering {
  return {
    canonicalRef: null,
    providerId: 'ollama-cloud',
    upstreamSlug: slug,
    adapter: { kind: 'catalogue', adapterId: `ollama-cloud:${slug}` },
    profile: {
      reasoning: { mode: 'none' },
      toolCalls: { supported: false, streaming: false, concurrentWithReasoning: false },
      vision: false,
      replayReasoning: false,
    },
    context: { recommended: 0, max: 0 },
    trust: { tee: false, zdr: false },
    freedomOrientedDeployment: null,
    source: 'curated',
    confidence: 'verified',
    serviceKind: 'web',
    web: meta,
  };
}

const webOfferings: Offering[] = [
  ollamaWebOffering('web-ollama-search', {
    canSearch: true,
    canFetch: false,
    requiresProxy: true,
    traits: ['ai'],
    searchTiers: OLLAMA_TIERS,
  }),
  ollamaWebOffering('web-ollama-fetch', {
    canSearch: false,
    canFetch: true,
    requiresProxy: true,
    traits: [],
  }),
];

const offerings: Offering[] = [...SPECS.map(ollamaOffering), ...webOfferings];

export const ollamaCloud: ProviderDefinition = {
  id: 'ollama-cloud',
  displayName: 'Ollama Cloud',
  iconKey: 'ollama',
  // Bare host: the native adapter targets `/api/chat`; the probe hits
  // `/v1/models` (OpenAI-compat listing) explicitly.
  baseUrl: 'https://ollama.com',
  shape: 'openai-chat-completions',
  capabilities: ['llm', 'streaming'],
  configFields: [apiKeyField('Ollama Cloud API key')],
  probe: { path: '/v1/models', method: 'GET' },
  secretFields: new Set(['api_key']),
  corsHint: 'requires-proxy',
  offerings,
  sortPriority: 30,
};

export function registerOllamaCloud(): void {
  registerProvider(ollamaCloud);
  for (const spec of SPECS) {
    registerAdapter(
      `ollama-cloud:${spec.slug}`,
      ollamaNativeAdapter(spec.slug, { vision: spec.vision, reasoning: spec.reasoning }),
    );
  }
  for (const o of webOfferings) {
    if (o.adapter.kind !== 'catalogue') continue;
    if (o.web?.canFetch) {
      registerWebAdapter(o.adapter.adapterId, () => ollamaWebFetchAdapter());
    } else {
      registerWebAdapter(o.adapter.adapterId, () => ollamaWebSearchAdapter());
    }
  }
}
