// SPDX-License-Identifier: LGPL-3.0-only
import { registerAdapter } from '../adapter-registry.js';
import { xaiAdapter } from '../adapters/xai-openai.js';
import type { Offering } from '../catalogue/types.js';
import { registerProvider } from '../registry.js';
import type { ProviderDefinition } from '../types.js';
import { apiKeyField } from './_helpers.js';

const offerings: Offering[] = [
  {
    canonicalRef: 'grok-4.3',
    providerId: 'xai',
    upstreamSlug: 'grok-4.3',
    adapter: { kind: 'catalogue', adapterId: 'xai:grok-4.3' },
    profile: {
      reasoning: {
        mode: 'steps',
        steps: ['low', 'medium', 'high'],
        offStep: 'none',
        defaultStep: 'low',
      },
      toolCalls: { supported: true, streaming: true, concurrentWithReasoning: true },
      vision: true,
      replayReasoning: false,
    },
    // Above 200k xAI roughly doubles the price; recommended sits at the cheap
    // band, max is xAI's 1M ceiling (Chris 2026-06-02 — "compact and continue").
    context: { recommended: 200_000, max: 1_000_000 },
    // US jurisdiction, no TEE/ZDR today. (NGO-negotiated ZDR is a future
    // possibility — venice.ai precedent — which would flip zdr + add a header.)
    trust: { tee: false, zdr: false, jurisdiction: 'US' },
    freedomOrientedDeployment: true, // Chris: xAI/Grok refuses near-nothing
    source: 'curated',
    confidence: 'verified', // run-xai-suite.ts: core 44/44 + vision 4/4, 0 fail (2026-06-02)
    serviceKind: 'llm',
  },
];

export const xai: ProviderDefinition = {
  id: 'xai',
  displayName: 'xAI',
  iconKey: 'xai',
  baseUrl: 'https://api.x.ai/v1',
  shape: 'openai-chat-completions',
  capabilities: ['llm', 'streaming', 'tools', 'vision'],
  configFields: [apiKeyField('xAI API key')],
  probe: { path: '/models', method: 'GET' },
  secretFields: new Set(['api_key']),
  // api.x.ai sends no Access-Control-* headers; an authenticated browser POST
  // (with the x-grok-conv-id header) needs a preflight xAI does not honour →
  // routed through the CORS proxy. Node/Bun (the live suite) is unaffected.
  corsHint: 'requires-proxy',
  offerings,
  // Freedom-oriented but US jurisdiction, no TEE/ZDR, premium-priced. Shares the
  // priority-20 slot with novita; registration order (novita first) breaks the tie.
  sortPriority: 20,
};

/** Register the xAI provider and its Grok adapter. */
export function registerXai(): void {
  registerProvider(xai);
  for (const o of offerings) {
    if (o.adapter.kind === 'catalogue') {
      registerAdapter(
        o.adapter.adapterId,
        xaiAdapter(o.upstreamSlug, { vision: o.profile.vision }),
      );
    }
  }
}
