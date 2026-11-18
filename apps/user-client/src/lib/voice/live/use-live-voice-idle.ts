// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import type { Floor } from './live-voice-machine.js';

/** Five minutes of unbroken listening: the ceiling for a forgotten live-voice session. */
export const LIVE_VOICE_IDLE_MS = 300_000;

/**
 * True once `floor` has stayed in a quiet state (`'listening'`, `'held'` or
 * `'sttFailed'`) for `ms` without a break while live voice is on. Speech, a
 * transcription or a reply, or leaving live voice, resets it at once.
 */
export function useLiveVoiceIdle(
  floor: Floor,
  isLiveVoice: boolean,
  ms: number = LIVE_VOICE_IDLE_MS,
): boolean {
  const [idle, setIdle] = useState(false);
  // Held and a failed transcription close the mic but leave the session open,
  // so they count towards the ceiling too (Laura, pre-squash): a session parked
  // there must not keep the screen lit for ever.
  const counting =
    isLiveVoice && (floor === 'listening' || floor === 'held' || floor === 'sttFailed');

  useEffect(() => {
    setIdle(false);
    if (!counting) return;
    const timer = setTimeout(() => setIdle(true), ms);
    return () => clearTimeout(timer);
  }, [counting, ms]);

  // Gate on `counting` so a floor change reads false in the same render,
  // before the effect has cleared the state.
  return idle && counting;
}
