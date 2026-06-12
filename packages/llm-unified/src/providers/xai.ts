// SPDX-License-Identifier: LGPL-3.0-only
import { registerAdapter } from '../adapter-registry.js';
import { xaiAdapter } from '../adapters/xai-openai.js';
import type {
  Offering,
  SttOfferingMeta,
  TtiOfferingMeta,
  TtsOfferingMeta,
} from '../catalogue/types.js';
import { registerProvider } from '../registry.js';
import type { ProviderDefinition } from '../types.js';
import { apiKeyField } from './_helpers.js';

const TTI_META: TtiOfferingMeta = {
  groupId: 'xai-imagine',
  canDoNsfw: false,
  displayName: 'Grok Imagine',
};

const TTS_META: TtsOfferingMeta = {
  displayName: 'Grok TTS',
  // TEAL v1 IS the xAI tag snapshot — tags travel verbatim and are voiced.
  teal: 'passthrough',
  // Moderation canary (the Voxtral 403 trigger sentence) passed live 2026-06-12.
  contentModerated: false,
  transport: 'xai-native',
  voices: { kind: 'fetch', endpoint: 'xai-flat' },
};

const STT_META: SttOfferingMeta = {
  displayName: 'Grok STT',
  contentModerated: false,
  transport: 'xai-native',
};

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
  {
    canonicalRef: null,
    providerId: 'xai',
    upstreamSlug: 'grok-imagine-image',
    adapter: { kind: 'generic' }, // image calls bypass chat adapters entirely
    profile: {
      reasoning: { mode: 'none' },
      toolCalls: { supported: false, streaming: false, concurrentWithReasoning: false },
      vision: false,
      replayReasoning: false,
    },
    context: { recommended: 0, max: 0 },
    trust: { tee: false, zdr: false, jurisdiction: 'US' },
    freedomOrientedDeployment: true,
    source: 'curated',
    confidence: 'verified', // live CORS + generation probes with Chris, 2026-06-09 (spec §10)
    serviceKind: 'tti',
    tti: TTI_META,
  },
  // Grok TTS — text-to-speech; bypasses the chat adapter entirely. The /tts
  // endpoint takes no model field; the slug is our internal identifier only.
  {
    canonicalRef: null,
    providerId: 'xai',
    upstreamSlug: 'grok-tts',
    adapter: { kind: 'generic' },
    profile: {
      reasoning: { mode: 'none' },
      toolCalls: { supported: false, streaming: false, concurrentWithReasoning: false },
      vision: false,
      replayReasoning: false,
    },
    context: { recommended: 0, max: 0 },
    trust: { tee: false, zdr: false, jurisdiction: 'US' },
    freedomOrientedDeployment: true,
    source: 'curated',
    confidence: 'verified', // live probes 2026-06-12: CORS preflight, synthesis, canary, TEAL
    serviceKind: 'tts',
    tts: TTS_META,
    // Voice endpoints are wildcard-CORS-open, unlike chat (probed 2026-06-12).
    corsOverride: 'direct',
  },
  // Grok STT — speech-to-text; /stt takes no model field either.
  {
    canonicalRef: null,
    providerId: 'xai',
    upstreamSlug: 'grok-stt',
    adapter: { kind: 'generic' },
    profile: {
      reasoning: { mode: 'none' },
      toolCalls: { supported: false, streaming: false, concurrentWithReasoning: false },
      vision: false,
      replayReasoning: false,
    },
    context: { recommended: 0, max: 0 },
    trust: { tee: false, zdr: false, jurisdiction: 'US' },
    freedomOrientedDeployment: true,
    source: 'curated',
    confidence: 'verified', // live probes 2026-06-12: MP3/WAV/webm all transcribed
    serviceKind: 'stt',
    stt: STT_META,
    corsOverride: 'direct',
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
