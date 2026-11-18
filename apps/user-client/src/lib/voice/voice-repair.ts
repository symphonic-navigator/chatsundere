// SPDX-License-Identifier: AGPL-3.0-only
import { type TtsUnavailableReason, VOICES_UNAVAILABLE_COPY } from './resolve-tts.js';

/** A repair link for an unavailable voice: what to call it and where it goes. */
export interface VoiceRepair {
  label: string;
  to: string;
}

/**
 * The page that fixes a voice `reason`, carrying `returnTo` as `?return=` so
 * Back comes home (spec 0.5.0 papercuts, item 2). `no-voice` needs the persona
 * whose voice is missing; without one there is no repair link.
 */
export function voiceRepairFor(
  reason: TtsUnavailableReason,
  personaId: string | null | undefined,
  returnTo: string,
): VoiceRepair | null {
  const ret = `?return=${encodeURIComponent(returnTo)}`;
  switch (reason) {
    case 'no-provider':
      return { label: 'Set up voice', to: `/app/settings/voice${ret}` };
    case 'no-voice':
      return personaId
        ? { label: 'Choose a voice', to: `/app/persona/${personaId}/font-voice${ret}` }
        : null;
    case 'voices-unavailable':
      return { label: 'Voice settings', to: `/app/settings/voice${ret}` };
  }
}

/** One sentence per reason, in one wording ("voice provider"), for every voice note. */
export const VOICE_NOTE: Record<TtsUnavailableReason, string> = {
  'no-provider': 'No voice yet — set up a voice provider to read replies aloud.',
  'no-voice': 'No voice yet — give this companion a voice to read replies aloud.',
  'voices-unavailable': VOICES_UNAVAILABLE_COPY,
};

/** The Live voice button's disabled tooltip, routed by the same reasons as the note. */
export const LIVE_VOICE_TOOLTIP: Record<TtsUnavailableReason, string> = {
  'no-provider': 'No voice provider — set one in Settings → Voice',
  'no-voice': 'This companion has no voice — choose one on its Font & Voice page',
  'voices-unavailable': VOICES_UNAVAILABLE_COPY,
};
