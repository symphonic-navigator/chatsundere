// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react';
import type { Floor } from '../voice/live/live-voice-machine.js';
import type { TransportState } from '../voice/voice-machine.js';
import { claimMediaFloor, releaseMediaFloor } from './media-floor.js';

interface Transport {
  transportState: TransportState;
  pause: () => void;
}

// 'held' and 'sttFailed' leave the microphone closed, so they do not sound.
const LIVE_SOUNDING: ReadonlySet<Floor> = new Set<Floor>([
  'listening',
  'userSpeaking',
  'transcribing',
  'personaThinking',
  'personaSpeaking',
]);

function useTransportClaim(owner: string, active: boolean, pause: () => void): void {
  // The latest pause is read at yield time so a changing callback never re-claims.
  const pauseRef = useRef(pause);
  pauseRef.current = pause;
  useEffect(() => {
    if (!active) return;
    claimMediaFloor(owner, () => pauseRef.current());
    return () => releaseMediaFloor(owner);
  }, [owner, active]);
}

/** Makes read-aloud, monologue and live voice take part in the one-sound-at-a-time floor. */
export function useMediaFloorBridge(args: {
  voice: Transport;
  monologue: Transport;
  live: { floor: Floor; hold: () => void } | null;
}): void {
  const { voice, monologue, live } = args;
  useTransportClaim('read-aloud', voice.transportState === 'speaking', voice.pause);
  useTransportClaim('monologue', monologue.transportState === 'speaking', monologue.pause);
  useTransportClaim('live-voice', live !== null && LIVE_SOUNDING.has(live.floor), () =>
    live?.hold(),
  );
}
