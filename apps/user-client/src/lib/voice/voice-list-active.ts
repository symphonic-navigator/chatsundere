// SPDX-License-Identifier: AGPL-3.0-only

import type { TtsVoiceList } from '@chatsundere/llm-unified';
import { resolveTtsTransport } from './resolve-tts.js';
import { loadVoiceListFor } from './voice-list.js';

// Kept apart from voice-list.ts so that module needs only resolve-tts's types,
// while resolve-tts imports loadVoiceListFor: no value-import cycle.

/**
 * Load the active TTS offering's voice list, reusing the memoised promise.
 * Resolves null when no TTS transport is configured. `fresh` drops the memo
 * for this source first, forcing a refetch (the picker does this on open).
 */
export async function loadVoiceList(
  opts: { fresh?: boolean } = {},
): Promise<{ key: string; list: TtsVoiceList } | null> {
  const transport = await resolveTtsTransport();
  if (!transport) return null;
  return loadVoiceListFor(transport, opts);
}
