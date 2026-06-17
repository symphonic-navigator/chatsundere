// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PersonaRow } from '../../boot/client-data-db.js';
import { AudioSink } from './audio-sink.js';
import { chunkForSynthesis, toPlainMonologueText } from './monologue-text.js';
import { resolveTts } from './resolve-tts.js';
import type { SpeechSegment } from './segmentation.js';

export interface MonologuePlayback {
  read: (id: string, trace: string) => Promise<void>;
  stop: () => void;
  activeId: string | null;
  disabledReason: 'no-voice' | null;
  /** Playback phase, for the shared spectrum + toolbar: 'waiting' while a chunk
   *  is synthesising, 'speaking' while it plays, 'paused' when paused. */
  transportState: 'idle' | 'waiting' | 'speaking' | 'paused';
  /** The monologue AudioSink's analyser (post-effect), or null before first play. */
  getAnalyser: () => AnalyserNode | null;
  /** Whether the monologue is currently sounding (for the spectrum's wave/FFT choice). */
  isAudible: () => boolean;
  pause: () => void;
  resume: () => void;
}

/** A synthetic segment for one monologue chunk — reuses the TTS fetch/cache path. */
function chunkSegment(index: number, text: string): SpeechSegment {
  return {
    segmentId: `monologue:${index}`,
    spokenText: text,
    blockIndex: 0,
    paragraphIndex: index,
    ordinalInParagraph: 0,
    charRange: [0, text.length],
    voice: 'dialogue', // resolves to persona.voice (not the narrator voice)
  };
}

/**
 * Isolated playback for the inner-monologue easter egg. Owns its own AudioSink
 * (never the voice machine's), so reading a chain-of-thought never perturbs
 * read-aloud / live-voice sequencing. `onStart` fires before the first chunk so
 * the caller can enforce one-voice-at-a-time (stop read-aloud).
 */
export function useMonologuePlayback(
  persona: PersonaRow | null,
  onStart?: () => void,
): MonologuePlayback {
  const sinkRef = useRef<AudioSink | null>(null);
  if (sinkRef.current === null) sinkRef.current = new AudioSink();
  const abortRef = useRef<AbortController | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [disabledReason, setDisabledReason] = useState<'no-voice' | null>(null);
  const [transportState, setTransportState] = useState<'idle' | 'waiting' | 'speaking' | 'paused'>(
    'idle',
  );

  // Dispose the sink and abort any play on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      void sinkRef.current?.dispose();
      sinkRef.current = null;
    };
  }, []);

  // Disabled hint: probe whether a TTS pipeline resolves for this persona.
  // biome-ignore lint/correctness/useExhaustiveDependencies: probe reads only persona's TTS fields
  useEffect(() => {
    if (!persona) {
      setDisabledReason('no-voice');
      return;
    }
    let cancelled = false;
    resolveTts(persona)
      .then((r) => {
        if (!cancelled) setDisabledReason(r.ok ? null : 'no-voice');
      })
      .catch(() => {
        if (!cancelled) setDisabledReason('no-voice');
      });
    return () => {
      cancelled = true;
    };
  }, [persona?.id, persona?.voice, persona?.narratorVoice]);

  const stop = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    sinkRef.current?.stop();
    setActiveId(null);
    setTransportState('idle');
  }, []);

  const read = useCallback(
    async (id: string, trace: string): Promise<void> => {
      if (!persona) return;
      // Re-tapping the playing pill stops it (toggle).
      if (abortRef.current && activeId === id) {
        stop();
        return;
      }
      stop(); // stop any other monologue first
      onStart?.(); // §4.4: caller stops read-aloud — one voice at a time

      const chunks = chunkForSynthesis(toPlainMonologueText(trace));
      if (chunks.length === 0) return;

      const resolution = await resolveTts(persona);
      if (!resolution.ok) {
        setDisabledReason('no-voice');
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setActiveId(id);
      const sink = sinkRef.current;
      try {
        for (let i = 0; i < chunks.length; i++) {
          if (controller.signal.aborted || !sink) break;
          const segment = chunkSegment(i, chunks[i] ?? '');
          setTransportState('waiting');
          const blob = await resolution.fetchAudio(segment, controller.signal);
          if (controller.signal.aborted) break;
          setTransportState('speaking');
          await sink.play(blob, { profile: { kind: 'monologue' }, signal: controller.signal });
        }
      } catch {
        // Synthesis/decode failure or abort — fail quiet for an easter egg.
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setActiveId(null);
          setTransportState('idle');
        }
      }
    },
    [persona, activeId, onStart, stop],
  );

  const pause = useCallback((): void => {
    void sinkRef.current?.pause();
    setTransportState('paused');
  }, []);

  const resume = useCallback((): void => {
    void sinkRef.current?.resume();
    setTransportState('speaking');
  }, []);

  return {
    read,
    stop,
    activeId,
    disabledReason,
    transportState,
    getAnalyser: () => sinkRef.current?.getAnalyser() ?? null,
    isAudible: () => sinkRef.current?.isAudible() ?? false,
    pause,
    resume,
  };
}
