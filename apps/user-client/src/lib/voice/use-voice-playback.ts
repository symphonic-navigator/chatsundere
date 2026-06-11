// SPDX-License-Identifier: AGPL-3.0-only
import { useActorRef, useSelector } from '@xstate/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MessageRow, PersonaRow } from '../../boot/client-data-db.js';
import { useSettings } from '../../data/settings.js';
import { AudioSink } from './audio-sink.js';
import { type TtsResolution, resolveTts } from './resolve-tts.js';
import { clearPosition, peekPosition, rememberPosition } from './resume-memory.js';
import { type SpeechSegment, segmentMessage } from './segmentation.js';
import { cacheDelete } from './voice-cache.js';
import {
  type TransportState,
  type VoiceDeps,
  selectCurrentSegmentId,
  selectTransportState,
  voiceMachine,
} from './voice-machine.js';

/** Why the per-message Read control is disabled (UI hint; play-time is authoritative). */
export type DisabledReason = 'no-provider' | 'no-voice' | null;

export interface VoicePlayback {
  transportState: TransportState;
  currentSegmentId: string | null;
  /** Start reading a message aloud from `startIndex`. Returns a not-ok reason if TTS cannot run. */
  playMessage: (
    message: MessageRow,
    startIndex?: number,
  ) => Promise<'no-provider' | 'no-voice' | null>;
  /** Resume from the same-session remembered position (the on-return offer). */
  resume: () => void;
  /** Discard the resume offer and play the remembered message from the top. */
  startOver: () => void;
  pause: () => void;
  resumeAudio: () => void;
  stop: () => void;
  retry: () => void;
  skip: () => void;
  /** Dismiss the partial-finish closing note (sends the machine's DISMISS event). */
  dismissPartial: () => void;
  /** Non-null while a same-session position is remembered for this chat. */
  resumeOffer: { messageId: string; segmentIndex: number; paragraphIndex: number } | null;
  /** UI hint for the Read control's disabled state. */
  disabledReason: DisabledReason;
}

/**
 * The single owner of voice playback for one chat view (spec Task 7). It owns
 * one {@link AudioSink} and one {@link voiceMachine} actor for its lifetime,
 * resolves the real {@link VoiceDeps} once, and re-targets the active TTS
 * resolution at play time (mode/voice are read THEN, never remapped mid-play).
 *
 * ## Seams chosen
 * - **Messages**: passed in as `messages` so resume can re-segment the
 *   remembered message reactively from the same source the chat page already
 *   holds (no second DB read, no getter indirection).
 * - **Segment threaded through play**: the machine passes the segment it is
 *   playing into `deps.play`, so decode-failure eviction targets exactly that
 *   segment's cache key — correct even while a later segment is prefetching
 *   concurrently (no shared in-play ref to go stale).
 */
export function useVoicePlayback(
  chatId: string,
  persona: PersonaRow | null,
  messages: MessageRow[],
): VoicePlayback {
  const settings = useSettings();

  // One sink for the hook's lifetime; disposed on unmount.
  const sinkRef = useRef<AudioSink | null>(null);
  if (sinkRef.current === null) sinkRef.current = new AudioSink();

  // The active TTS resolution, set at play time. fetchAudio/play below delegate to it.
  const resolutionRef = useRef<Extract<TtsResolution, { ok: true }> | null>(null);

  // The deps are built ONCE: they close over the resolution ref above, so the
  // active resolution can change between plays without re-creating the actor.
  const deps = useMemo<VoiceDeps>(() => {
    const fetchAudio = async (segment: SpeechSegment, signal: AbortSignal): Promise<Blob> => {
      const resolution = resolutionRef.current;
      if (!resolution) throw new Error('voice: fetchAudio with no active resolution');
      return resolution.fetchAudio(segment, signal);
    };

    const play = async (blob: Blob, segment: SpeechSegment, signal: AbortSignal): Promise<void> => {
      const sink = sinkRef.current;
      if (!sink) throw new Error('voice: play after dispose');
      try {
        await sink.play(blob, signal);
      } catch {
        // Decode failure: the cached blob for THIS segment is poisoned. The
        // machine hands us the very segment it played, so we evict and re-fetch
        // exactly that segment — never a concurrently-prefetched one. Retry once;
        // a second failure rethrows and lands the machine in 'failed'.
        const resolution = resolutionRef.current;
        if (!resolution) throw new Error('voice: decode-retry with no active resolution');
        await cacheDelete(resolution.cacheKeyFor(segment));
        const fresh = await resolution.fetchAudio(segment, signal);
        await sink.play(fresh, signal);
      }
    };

    return {
      fetchAudio,
      play,
      pause: async () => {
        await sinkRef.current?.pause();
      },
      resume: async () => {
        await sinkRef.current?.resume();
      },
      stop: () => sinkRef.current?.stop(),
    };
  }, []);

  const actor = useActorRef(voiceMachine, { input: { deps } });

  const transportState = useSelector(actor, selectTransportState);
  const currentSegmentId = useSelector(actor, selectCurrentSegmentId);

  // Dispose the sink on unmount (the actor stops with the component).
  useEffect(() => {
    return () => {
      void sinkRef.current?.dispose();
      sinkRef.current = null;
    };
  }, []);

  // The last message/segments played, so on-return Resume and ended-partial
  // Retry can re-issue a PLAY with the right segment list.
  const lastPlayRef = useRef<{ messageId: string; segments: SpeechSegment[] } | null>(null);

  // The resume position lives in a plain module map, not reactive state. Bumping
  // this counter on every mutation forces a re-render so `resumeOffer` (a derived
  // read of peekPosition) reflects clears that aren't accompanied by a machine
  // transition — e.g. Stop while the offer is showing (I1).
  const [, bumpOffer] = useState(0);
  const clearOffer = (): void => {
    clearPosition(chatId);
    bumpOffer((n) => n + 1);
  };

  const segmentationOpts = useMemo(
    () => ({
      mode: settings.data?.voiceMode ?? ('paragraph' as const),
      roleplay: persona?.roleplay ?? false,
    }),
    [settings.data?.voiceMode, persona?.roleplay],
  );

  // The single internal start path: every play (fresh, resume, ended-partial
  // retry) funnels through here so resolution, lastPlayRef and the cleared
  // resume position all stay in lock-step.
  const startSegments = (
    messageId: string,
    segments: SpeechSegment[],
    resolution: Extract<TtsResolution, { ok: true }>,
    startIndex: number,
  ): void => {
    resolutionRef.current = resolution;
    lastPlayRef.current = { messageId, segments };
    clearOffer();
    actor.send({ type: 'PLAY', messageId, segments, startIndex });
  };

  const playMessage = async (
    message: MessageRow,
    startIndex = 0,
  ): Promise<'no-provider' | 'no-voice' | null> => {
    if (!persona) return 'no-provider';
    const segments = segmentMessage(message.contentBlocks, segmentationOpts);
    if (segments.length === 0) return null; // nothing speakable — belt-and-braces
    const resolution = await resolveTts(persona);
    if (!resolution.ok) return resolution.reason;
    const start = Math.min(Math.max(startIndex, 0), segments.length - 1);
    startSegments(message.id, segments, resolution, start);
    return null;
  };

  const resumeOffer = peekPosition(chatId);

  const playRemembered = async (startIndex: number): Promise<void> => {
    const pos = peekPosition(chatId);
    if (!pos || !persona) return;
    const message = messages.find((m) => m.id === pos.messageId);
    if (!message) {
      clearOffer();
      return;
    }
    void playMessage(message, startIndex);
  };

  const resume = (): void => {
    const pos = peekPosition(chatId);
    if (!pos) return;
    void playRemembered(pos.segmentIndex);
  };

  const startOver = (): void => {
    void playRemembered(0);
  };

  const retry = (): void => {
    if (transportState === 'failed') {
      actor.send({ type: 'RETRY' });
      return;
    }
    // ended-partial: the machine is idle with the partial-finish note shown.
    // Replay the final (failed) segment of the last-played message — the only
    // segment a SKIP-off-the-end could have abandoned.
    const last = lastPlayRef.current;
    if (transportState === 'ended-partial' && last && persona) {
      void resolveTts(persona).then((resolution) => {
        if (!resolution.ok || last.segments.length === 0) return;
        const startIndex = last.segments.length - 1;
        // Route through the same internal start path as playMessage/resume so
        // the resume position is cleared and lastPlayRef stays consistent.
        startSegments(last.messageId, last.segments, resolution, startIndex);
      });
    }
  };

  // ---- LEAVE_CHAT: remember position on chat-change / unmount while non-idle ----
  const actorRef = useRef(actor);
  actorRef.current = actor;
  useEffect(() => {
    return () => {
      const snapshot = actorRef.current.getSnapshot();
      if (snapshot.matches('idle')) return;
      const { messageId, currentIndex, segments } = snapshot.context;
      if (messageId !== null) {
        // The resume label shows the PARAGRAPH the user left off at (spec §4),
        // not the raw segment index. Derive it from the segment being played;
        // guard the lookup (an out-of-range index degrades to paragraph 0).
        const paragraphIndex = segments[currentIndex]?.paragraphIndex ?? 0;
        rememberPosition(chatId, { messageId, segmentIndex: currentIndex, paragraphIndex });
      }
      actorRef.current.send({ type: 'LEAVE_CHAT' });
    };
  }, [chatId]);

  // ---- Disabled-reason probe: re-run resolveTts only when a TTS-relevant
  // persona field changes (id/voice/narratorVoice), not on every persona edit. ----
  const [disabledReason, setDisabledReason] = useState<DisabledReason>(null);
  // Keyed on the TTS-relevant fields rather than the persona object identity so a
  // rename or unrelated edit does not trigger a redundant decrypt/probe.
  // biome-ignore lint/correctness/useExhaustiveDependencies: probe reads only persona's TTS fields, not the whole object
  useEffect(() => {
    if (!persona) {
      setDisabledReason('no-provider');
      return;
    }
    let cancelled = false;
    // UI hint only — a probe failure (e.g. DB not yet open) degrades to the
    // most fundamental reason rather than crashing; play-time is authoritative.
    resolveTts(persona)
      .then((resolution) => {
        if (cancelled) return;
        setDisabledReason(resolution.ok ? null : resolution.reason);
      })
      .catch(() => {
        if (!cancelled) setDisabledReason('no-provider');
      });
    return () => {
      cancelled = true;
    };
  }, [persona?.id, persona?.voice, persona?.narratorVoice]);

  return {
    transportState,
    currentSegmentId,
    playMessage,
    resume,
    startOver,
    pause: () => actor.send({ type: 'PAUSE' }),
    resumeAudio: () => actor.send({ type: 'RESUME' }),
    stop: () => {
      // Stop also clears the resume offer: with a remembered position on view,
      // a Stop tap that only sent STOP left the offer standing — Stop appeared
      // to do nothing. Clearing the position dismisses the offer (I1).
      clearOffer();
      actor.send({ type: 'STOP' });
    },
    retry,
    skip: () => actor.send({ type: 'SKIP' }),
    dismissPartial: () => {
      clearOffer();
      actor.send({ type: 'DISMISS' });
    },
    resumeOffer,
    disabledReason,
  };
}
