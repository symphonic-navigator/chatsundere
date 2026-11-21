// SPDX-License-Identifier: AGPL-3.0-only
import { type SyntheticEvent, useCallback, useEffect, useRef, useState } from 'react';
import { claimMediaFloor, releaseMediaFloor } from '../../../lib/media/media-floor.js';

/** Props to spread onto the one `<audio>` or `<video>` element a player owns. */
export interface MediaElementProps {
  ref: (el: HTMLMediaElement | null) => void;
  src: string | undefined;
  preload: 'metadata';
  'data-media-element': string;
  onPlay: () => void;
  onPause: () => void;
  onEnded: () => void;
  onTimeUpdate: (e: SyntheticEvent<HTMLMediaElement>) => void;
  onLoadedMetadata: (e: SyntheticEvent<HTMLMediaElement>) => void;
  onDurationChange: (e: SyntheticEvent<HTMLMediaElement>) => void;
}

/** What a player reads and drives of its media element. */
export interface MediaElementControls {
  elementProps: MediaElementProps;
  element: () => HTMLMediaElement | null;
  ready: boolean;
  playing: boolean;
  currentMs: number;
  durationMs: number | null;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(ms: number): void;
}

/**
 * One media element per artefact, played only from a `blob:` URL this hook owns. Playing
 * claims the floor as `player:<artefactId>`, so another player or read-aloud pauses; pausing,
 * ending or unmounting gives it back.
 */
export function useMediaElement(
  artefactId: string,
  blob: Blob | null,
  knownDurationMs: number | null,
): MediaElementControls {
  const elRef = useRef<HTMLMediaElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [elementDurationMs, setElementDurationMs] = useState<number | null>(null);
  const owner = `player:${artefactId}`;

  // Created inside the effect so each run revokes exactly the URL it made (ImagePill pattern).
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return undefined;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);

  useEffect(
    () => () => {
      const el = elRef.current;
      if (el && !el.paused) el.pause();
      releaseMediaFloor(owner);
    },
    [owner],
  );

  const play = useCallback(() => {
    const el = elRef.current;
    if (!el || !url) return;
    claimMediaFloor(owner, () => el.pause());
    const started = el.play() as Promise<void> | undefined;
    started?.catch?.(() => {
      releaseMediaFloor(owner);
      setPlaying(false);
    });
  }, [owner, url]);

  const pause = useCallback(() => {
    elRef.current?.pause();
  }, []);

  const toggle = useCallback(() => {
    const el = elRef.current;
    if (el && !el.paused) el.pause();
    else play();
  }, [play]);

  const seek = useCallback((ms: number) => {
    const el = elRef.current;
    if (el) el.currentTime = ms / 1000;
    setCurrentMs(ms);
  }, []);

  const readDuration = (e: SyntheticEvent<HTMLMediaElement>): void => {
    const seconds = e.currentTarget.duration;
    if (Number.isFinite(seconds) && seconds > 0) setElementDurationMs(Math.round(seconds * 1000));
  };

  const ref = useCallback((el: HTMLMediaElement | null) => {
    elRef.current = el;
  }, []);

  return {
    elementProps: {
      ref,
      src: url ?? undefined,
      preload: 'metadata',
      'data-media-element': artefactId,
      // Native controls (fullscreen on iOS) can start playback too, so the floor is claimed here as well.
      onPlay: () => {
        const el = elRef.current;
        if (el) claimMediaFloor(owner, () => el.pause());
        setPlaying(true);
      },
      onPause: () => {
        setPlaying(false);
        releaseMediaFloor(owner);
      },
      onEnded: () => {
        setPlaying(false);
        releaseMediaFloor(owner);
      },
      onTimeUpdate: (e) => setCurrentMs(Math.round(e.currentTarget.currentTime * 1000)),
      onLoadedMetadata: readDuration,
      onDurationChange: readDuration,
    },
    element: () => elRef.current,
    ready: url !== null,
    playing,
    currentMs,
    durationMs: knownDurationMs ?? elementDurationMs,
    play,
    pause,
    toggle,
    seek,
  };
}
