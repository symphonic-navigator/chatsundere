// SPDX-License-Identifier: AGPL-3.0-only

import { type TtsVoiceList, getProvider } from '@chatsundere/llm-unified';
import { resolveTtsTransport } from './resolve-tts.js';
import { loadVoiceListFor } from './voice-list.js';

// Kept apart from voice-list.ts so that module needs only resolve-tts's types,
// while resolve-tts imports loadVoiceListFor: no value-import cycle.

/**
 * Load the active TTS offering's voice list, reusing the memoised promise.
 * Resolves null when no TTS transport is configured. `fresh` drops the memo
 * for this source first, forcing a refetch (the picker does this on open).
 * `providerDisplayName` names the service the voices come from (the picker's
 * stale and empty-account copy); `accountSource` is true when the list is the
 * user's own account library (today `elevenlabs-v2`), where an empty list means
 * "add voices on the provider's website" rather than "none exist".
 */
export async function loadVoiceList(opts: { fresh?: boolean } = {}): Promise<{
  key: string;
  list: TtsVoiceList;
  providerDisplayName: string;
  accountSource: boolean;
} | null> {
  const transport = await resolveTtsTransport();
  if (!transport) return null;
  const loaded = await loadVoiceListFor(transport, opts);
  const { providerId } = transport.offering;
  const { voices } = transport.ttsMeta;
  return {
    ...loaded,
    providerDisplayName: getProvider(providerId)?.displayName ?? providerId,
    accountSource: voices.kind === 'fetch' && voices.endpoint === 'elevenlabs-v2',
  };
}
