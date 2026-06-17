// SPDX-License-Identifier: AGPL-3.0-only

/** The node chain AudioSink builds downstream of the source for one playback. */
export type VoiceFilterProfile =
  | { kind: 'plain' }
  | { kind: 'highpass'; hz: 50 | 100 }
  | { kind: 'monologue' };

/** The global cleanup-filter setting. 'auto' follows the offering recommendation. */
export type TtsHighpassSetting = 'auto' | 'off' | 50 | 100;

/**
 * Resolve the cleanup filter profile from the user setting and the active
 * offering's recommendation. 'auto' adopts the recommendation (or plain when
 * none), 'off' is always plain, and an explicit Hz value always wins. Pure.
 */
export function resolveCleanupProfile(
  setting: TtsHighpassSetting,
  recommendation: 50 | 100 | undefined,
): VoiceFilterProfile {
  if (setting === 'off') return { kind: 'plain' };
  if (setting === 'auto') {
    return recommendation ? { kind: 'highpass', hz: recommendation } : { kind: 'plain' };
  }
  return { kind: 'highpass', hz: setting };
}
