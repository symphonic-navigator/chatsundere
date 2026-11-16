// SPDX-License-Identifier: LGPL-3.0-only
import type { Offering, SttOfferingMeta, TtsOfferingMeta } from '../catalogue/types.js';
import { registerProvider } from '../registry.js';
import type { ProviderDefinition } from '../types.js';
import { apiKeyField } from './_helpers.js';

// ElevenLabs direct: the first voice-only provider (no chat). Wire shapes
// live-probed 2026-11-15 (spec 2026-11-15-elevenlabs-direct §6.2–6.4).
const TTS_BASE = {
  // Level v2 sends the full TEAL set (moods included) verbatim; Eleven v4 voices its own audio tags.
  teal: 'v2',
  // TODO(Chris manual test, spec §11 step 10): set from the moderation hand test
  contentModerated: true,
  transport: 'elevenlabs',
  voices: { kind: 'fetch', endpoint: 'elevenlabs-v2' },
} as const satisfies Omit<TtsOfferingMeta, 'displayName'>;

const STT_META: SttOfferingMeta = {
  displayName: 'Scribe',
  contentModerated: false,
  transport: 'elevenlabs',
};

const NO_CHAT_PROFILE: Offering['profile'] = {
  reasoning: { mode: 'none' },
  toolCalls: { supported: false, streaming: false, concurrentWithReasoning: false },
  vision: false,
  replayReasoning: false,
};

function voiceOffering(
  upstreamSlug: string,
  serviceKind: 'tts' | 'stt',
  meta: { tts: TtsOfferingMeta } | { stt: SttOfferingMeta },
): Offering {
  return {
    canonicalRef: null,
    providerId: 'elevenlabs',
    upstreamSlug,
    adapter: { kind: 'generic' }, // voice calls bypass chat adapters entirely
    profile: NO_CHAT_PROFILE,
    context: { recommended: 0, max: 0 },
    trust: { tee: false, zdr: false, jurisdiction: 'US' },
    freedomOrientedDeployment: null,
    source: 'curated',
    confidence: 'verified', // live probes 2026-11-15
    serviceKind,
    ...meta,
  };
}

const offerings: Offering[] = [
  voiceOffering('eleven_v4', 'tts', { tts: { ...TTS_BASE, displayName: 'Eleven v4' } }),
  voiceOffering('eleven_v4_turbo', 'tts', { tts: { ...TTS_BASE, displayName: 'Eleven v4 Turbo' } }),
  voiceOffering('scribe_v2', 'stt', { stt: STT_META }),
];

export const elevenlabs: ProviderDefinition = {
  id: 'elevenlabs',
  displayName: 'ElevenLabs',
  iconKey: 'elevenlabs',
  baseUrl: 'https://api.elevenlabs.io/v1',
  shape: 'none',
  capabilities: ['tts', 'stt'],
  configFields: [apiKeyField('ElevenLabs API key')],
  probe: { path: '/models', method: 'GET' },
  auth: { header: 'xi-api-key' },
  secretFields: new Set(['api_key']),
  corsHint: 'direct',
  offerings,
  // Voice-only: sorts after every chat provider.
  sortPriority: 50,
};

/** Register the ElevenLabs provider. */
export function registerElevenLabs(): void {
  registerProvider(elevenlabs);
}
