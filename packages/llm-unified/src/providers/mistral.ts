// SPDX-License-Identifier: LGPL-3.0-only
import { registerAdapter } from '../adapter-registry.js';
import { mistralAdapter } from '../adapters/mistral-openai.js';
import type { Offering, ReasoningControl } from '../catalogue/types.js';
import { registerProvider } from '../registry.js';
import type { ProviderDefinition } from '../types.js';
import { apiKeyField } from './_helpers.js';

// Reasoning on Mistral Cloud is a BINARY toggle via `reasoning_effort`: only
// 'high' (on) and 'none' (off) are honoured, and only by the reasoning-capable
// models. 'none' is a GENUINE off (content reverts to a plain string, no
// thinking items — probed live 2026-05-31), so a true toggle, not the "off only
// hides" case. Mistral Large 3 has no reasoning at all → `none`.
const TOGGLE: ReasoningControl = { mode: 'toggle', defaultOn: false };
const NONE: ReasoningControl = { mode: 'none' };

// Mistral exposes a 262,144-token window on all three curated models. We set
// `recommended` to 131,072 (half the ceiling) as the "stays smart" point that
// drives the Context-Gauge; the full window remains the hard ceiling. This
// mirrors the conservative recommended<max stance and is noted in the Provider
// Curation Record.
const MAX_CONTEXT = 262_144;
const RECOMMENDED_CONTEXT = 131_072;

interface MistralOfferingArgs {
  vision: boolean;
  reasoning: ReasoningControl;
}

function mistralOffering(canonicalRef: string, slug: string, args: MistralOfferingArgs): Offering {
  return {
    canonicalRef,
    providerId: 'mistral',
    upstreamSlug: slug,
    adapter: { kind: 'catalogue', adapterId: `mistral:${slug}` },
    profile: {
      reasoning: args.reasoning,
      toolCalls: { supported: true, streaming: true, concurrentWithReasoning: true },
      vision: args.vision,
      replayReasoning: false,
    },
    context: { recommended: RECOMMENDED_CONTEXT, max: MAX_CONTEXT },
    // Mistral AI is EU-jurisdiction (French company, GDPR-compliant) but offers
    // NEITHER zero data retention NOR a trusted execution environment — the
    // trust basis is EU justiciability plus its published privacy terms, not
    // ZDR or cryptographic attestation. See the Provider Curation Record.
    trust: { tee: false, zdr: false, jurisdiction: 'EU' },
    // Freedom judgement (Chris, 2026-05-31): freedom-oriented. Mistral is the
    // EU model-maker hosting its own weights, uncensored and notably liberal
    // towards adult expression — see the canonical freedomNote.
    freedomOrientedDeployment: true,
    source: 'curated',
    confidence: 'verified',
    serviceKind: 'llm',
  };
}

const offerings: Offering[] = [
  // Mistral Small 4 — reasoning toggle (high/none), vision, tools.
  mistralOffering('mistral-small-4', 'mistral-small-latest', {
    vision: true,
    reasoning: TOGGLE,
  }),
  // Mistral Medium 3.5 — reasoning toggle (high/none), vision, tools. NOTE the
  // upstream slug is the literal `mistral-medium-3-5`, NOT a `-latest` alias.
  mistralOffering('mistral-medium-3-5', 'mistral-medium-3-5', {
    vision: true,
    reasoning: TOGGLE,
  }),
  // Mistral Large 3 — NO reasoning, vision, tools.
  mistralOffering('mistral-large-3', 'mistral-large-latest', {
    vision: true,
    reasoning: NONE,
  }),
];

export const mistral: ProviderDefinition = {
  id: 'mistral',
  displayName: 'Mistral AI',
  iconKey: 'mistral',
  baseUrl: 'https://api.mistral.ai/v1',
  shape: 'openai-chat-completions',
  capabilities: ['llm', 'streaming', 'tools', 'vision'],
  configFields: [apiKeyField('Mistral API key')],
  probe: { path: '/models', method: 'GET' },
  secretFields: new Set(['api_key']),
  // Browser-accessible: the OPTIONS preflight to /v1/chat/completions returns
  // 200 with `access-control-allow-origin: *` and allows the Authorization and
  // Content-Type request headers (probed live 2026-05-31), so direct browser
  // calls work without the CORS proxy.
  corsHint: 'direct',
  offerings,
  sortPriority: 14,
};

/** Register the Mistral provider and its per-offering hand-written adapters. */
export function registerMistral(): void {
  registerProvider(mistral);
  for (const o of offerings) {
    if (o.adapter.kind === 'catalogue') {
      registerAdapter(
        o.adapter.adapterId,
        mistralAdapter(o.upstreamSlug, {
          vision: o.profile.vision,
          reasoning: o.profile.reasoning,
        }),
      );
    }
  }
}
