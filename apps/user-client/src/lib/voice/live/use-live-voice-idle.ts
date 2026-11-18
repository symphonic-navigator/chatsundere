// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import type { Floor } from './live-voice-machine.js';

/** Five minutes of unbroken listening: the ceiling for a forgotten live-voice session. */
export const LIVE_VOICE_IDLE_MS = 300_000;

/**
 * True once `floor` has stayed `'listening'` for `ms` without a break while
 * live voice is on. Any other floor (speech detected, a reply) or leaving
 * live voice resets it at once.
 */
export function useLiveVoiceIdle(
  floor: Floor,
  isLiveVoice: boolean,
  ms: number = LIVE_VOICE_IDLE_MS,
): boolean {
  const [idle, setIdle] = useState(false);
  const counting = isLiveVoice && floor === 'listening';

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
