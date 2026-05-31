// SPDX-License-Identifier: LGPL-3.0-only
import { registerAdapter } from '../adapter-registry.js';
import { openRouterAdapter } from '../adapters/openrouter-openai.js';
import type { Offering, ReasoningControl } from '../catalogue/types.js';
import { registerProvider } from '../registry.js';
import type { ProviderDefinition } from '../types.js';
import { apiKeyField } from './_helpers.js';

// Reasoning on OpenRouter is the provider's UNIFIED `reasoning` object:
// `{ enabled: true, effort? }` enables, `{ enabled: false }` disables. Probed
// live 2026-05-31 across all curated targets: `{ enabled: false }` is a GENUINE
// off (0 reasoning tokens, empty `reasoning` channel) for every one of them —
// notably GLM-5.1, which is fixed-on on Tensorix/wafer but a clean toggle here
// because OpenRouter's unified param is honoured per route. Effort is modelled
// as a plain on/off toggle (effort buckets are not shown to modulate the trace).
const TOGGLE: ReasoningControl = { mode: 'toggle', defaultOn: true };

interface OpenRouterOfferingArgs {
  vision: boolean;
  reasoning: ReasoningControl;
  /** Where the model stays smart — drives the context gauge. */
  recommended: number;
  /** Hard ceiling; defaults to `recommended` when the two coincide. */
  max?: number;
}

function openRouterOffering(
  canonicalRef: string,
  slug: string,
  args: OpenRouterOfferingArgs,
): Offering {
  return {
    canonicalRef,
    providerId: 'openrouter',
    upstreamSlug: slug,
    adapter: { kind: 'catalogue', adapterId: `openrouter:${slug}` },
    profile: {
      reasoning: args.reasoning,
      toolCalls: { supported: true, streaming: true, concurrentWithReasoning: true },
      vision: args.vision,
      replayReasoning: false,
    },
    context: { recommended: args.recommended, max: args.max ?? args.recommended },
    // OpenRouter is a US-based router/aggregator. It is NOT ZDR by default and
    // is NOT a TEE: data may transit OpenRouter's US infrastructure, and trust
    // is per-route (each underlying provider has its own policy). We record the
    // honest baseline here — no 🔒 badge unless a specific route is shown to be
    // ZDR/TEE. Jurisdiction US. See the Provider Curation Record.
    trust: { tee: false, zdr: false, jurisdiction: 'US' },
    // Freedom judgement (Chris, 2026-05-31): freedom-oriented. OpenRouter routes
    // verbatim and adds no censorship layer of its own.
    freedomOrientedDeployment: true,
    source: 'curated',
    confidence: 'verified',
  };
}

// Per-canonical slug map resolved from OpenRouter /models (2026-05-31). Context
// `max` is OpenRouter's reported context_length; `recommended` follows our
// project sweet-spots where they differ (DeepSeek V4's 1M ceiling is kept but
// recommended stays at the 200k sweet-spot, matching the wafer offerings).
const offerings: Offering[] = [
  // DeepSeek family — reasoning on `delta.reasoning`, clean toggle (off probed 0).
  openRouterOffering('deepseek-v3.2', 'deepseek/deepseek-v3.2', {
    vision: false,
    reasoning: TOGGLE,
    recommended: 131_072,
  }),
  // DeepSeek V4 Flash/Pro: OpenRouter reports a 1,048,576 ceiling; recommended
  // stays at our 200k DeepSeek-V4 sweet-spot (matches the wafer offerings).
  openRouterOffering('deepseek-v4-flash', 'deepseek/deepseek-v4-flash', {
    vision: false,
    reasoning: TOGGLE,
    recommended: 200_000,
    max: 1_048_576,
  }),
  openRouterOffering('deepseek-v4-pro', 'deepseek/deepseek-v4-pro', {
    vision: false,
    reasoning: TOGGLE,
    recommended: 200_000,
    max: 1_048_576,
  }),
  // GLM family — 202,752 ceiling on OpenRouter. Both toggle cleanly (GLM-5.1's
  // off is genuine here, unlike Tensorix/wafer where it is fixed-on).
  openRouterOffering('glm-5', 'z-ai/glm-5', {
    vision: false,
    reasoning: TOGGLE,
    recommended: 202_752,
  }),
  openRouterOffering('glm-5.1', 'z-ai/glm-5.1', {
    vision: false,
    reasoning: TOGGLE,
    recommended: 202_752,
  }),
  // Kimi K2.6 — vision-capable, 262,144 ceiling. Reasoning toggles cleanly on
  // OpenRouter (off probed 0), unlike the fixed-on wafer/Tensorix routes.
  openRouterOffering('kimi-k2.6', 'moonshotai/kimi-k2.6', {
    vision: true,
    reasoning: TOGGLE,
    recommended: 262_144,
  }),
  // Gemma 4 31B (instruction-tuned) — vision-capable, 262,144 ceiling.
  openRouterOffering('gemma-4-31b', 'google/gemma-4-31b-it', {
    vision: true,
    reasoning: TOGGLE,
    recommended: 262_144,
  }),
  // Qwen3.5 397B A17B — vision-capable, 262,144 ceiling. Reasoning toggle
  // confirmed (off probed 0), consistent with the wafer/nano-gpt finding that it
  // reasons despite some /models metadata claiming otherwise.
  openRouterOffering('qwen3.5-397b-a17b', 'qwen/qwen3.5-397b-a17b', {
    vision: true,
    reasoning: TOGGLE,
    recommended: 262_144,
  }),
];

export const openrouter: ProviderDefinition = {
  id: 'openrouter',
  displayName: 'OpenRouter',
  iconKey: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  shape: 'openai-chat-completions',
  capabilities: ['llm', 'streaming', 'tools'],
  configFields: [apiKeyField('OpenRouter API key')],
  probe: { path: '/models', method: 'GET' },
  secretFields: new Set(['api_key']),
  // Browser-accessible: the OPTIONS preflight to /api/v1/chat/completions
  // returns 204 with `Access-Control-Allow-Origin: *` and allows Authorization
  // (plus the optional HTTP-Referer / X-Title attribution headers); probed live
  // 2026-05-31. Direct browser calls work — no proxy needed.
  corsHint: 'direct',
  offerings,
  // A US router/aggregator: neither privacy-forward (no default ZDR/TEE) nor a
  // strategic NGO partner, so ranked last, in the router tier alongside
  // nano-gpt (40). 45 (not 30) avoids a tie with ollama-cloud (30) that would
  // make the provider-list order non-deterministic (Chris approved "below the
  // privacy tier"; this honours that without the tie).
  sortPriority: 45,
};

/** Register the OpenRouter provider and its per-offering adapters. */
export function registerOpenRouter(): void {
  registerProvider(openrouter);
  for (const o of offerings) {
    if (o.adapter.kind === 'catalogue') {
      registerAdapter(
        o.adapter.adapterId,
        openRouterAdapter(o.upstreamSlug, {
          vision: o.profile.vision,
          reasoning: o.profile.reasoning,
        }),
      );
    }
  }
}
