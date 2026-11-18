// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import type { PersonaRow } from '../../boot/client-data-db.js';
import { usePersonaAvatar } from '../../data/persona-avatars.js';
import { isReadAloudBridgeEnabled } from './audio-sink.js';
import {
  clearReadAloudSession,
  readAloudMetadata,
  renderAvatarArtwork,
  setReadAloudHandlers,
  setReadAloudMetadata,
  setReadAloudPlaybackState,
} from './media-session.js';
import type { VoicePlayback } from './use-voice-playback.js';

/**
 * Lock-screen, notification-shade and headset controls for read-aloud (spec A2).
 * Active only while read-aloud is speaking, waiting or paused, with the media
 * bridge on (without it there is no element for the platform to attach to) and
 * outside live voice (Q4). Idle or unmount clears every trace, so no entry
 * outlives the read or points at a chat the user has left.
 */
export function useReadAloudMediaSession(
  voice: VoicePlayback,
  persona: PersonaRow | null,
  isLiveVoice: boolean,
): void {
  // Read once, like the sink's own read of the override.
  const [bridgeEnabled] = useState(isReadAloudBridgeEnabled);
  const state = voice.transportState;
  const active =
    bridgeEnabled &&
    !isLiveVoice &&
    persona !== null &&
    (state === 'speaking' || state === 'waiting' || state === 'paused');

  // Handlers registered once per activation reach the current controller here.
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const adult = persona?.adultPersona ?? false;
  const avatar = usePersonaAvatar(persona?.id ?? null).data ?? null;
  const avatarBlob = avatar?.blob ?? null;

  // The avatar artwork, rendered per read (never for an adult persona) and
  // revoked when the read ends or the avatar changes.
  const [artwork, setArtwork] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the blob and its crop; the row object changes identity on every query refetch
  useEffect(() => {
    if (!active || adult || !avatar || !avatarBlob) {
      setArtwork(null);
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    void renderAvatarArtwork({
      blob: avatarBlob,
      width: avatar.width,
      height: avatar.height,
      crop: avatar.crop,
    }).then((rendered) => {
      if (cancelled) {
        if (rendered) URL.revokeObjectURL(rendered);
        return;
      }
      url = rendered;
      setArtwork(rendered);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [active, adult, avatarBlob, avatar?.crop.x, avatar?.crop.y, avatar?.crop.zoom]);

  useEffect(() => {
    if (!active) return;
    setReadAloudHandlers({
      play: () => voiceRef.current.resumeAudio(),
      pause: () => voiceRef.current.pause(),
      nexttrack: () => voiceRef.current.skip(),
      stop: () => voiceRef.current.stop(),
    });
    return () => clearReadAloudSession();
  }, [active]);

  const name = persona?.name ?? '';
  useEffect(() => {
    if (!active) return;
    setReadAloudMetadata(readAloudMetadata({ name, adultPersona: adult }, artwork));
  }, [active, name, adult, artwork]);

  useEffect(() => {
    if (!active) return;
    setReadAloudPlaybackState(state === 'paused' ? 'paused' : 'playing');
  }, [active, state]);
}
