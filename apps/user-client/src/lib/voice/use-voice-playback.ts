// SPDX-License-Identifier: AGPL-3.0-only
import { useActorRef, useSelector } from '@xstate/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MessageRow, PersonaRow } from '../../boot/client-data-db.js';
import { useSettings } from '../../data/settings.js';
import { type StreamHandle, useStreamManagerStore } from '../../state/stream-manager.store.js';
import { AudioSink, type ReadPhase, isReadAloudBridgeEnabled } from './audio-sink.js';
import { committedSegments } from './committed-prefix.js';
import { type TtsResolution, type TtsUnavailableReason, resolveTts } from './resolve-tts.js';
import { clearPosition, peekPosition, rememberPosition } from './resume-memory.js';
import { type SpeechSegment, segmentMessage } from './segmentation.js';
import { cacheDelete } from './voice-cache.js';
import { type TtsHighpassSetting, resolveCleanupProfile } from './voice-filter.js';
import {
  type TransportState,
  type VoiceDeps,
  selectCurrentMessageId,
  selectCurrentSegmentId,
  selectProviderSkips,
  selectTransportState,
  voiceMachine,
} from './voice-machine.js';

/** Why the per-message Read control is disabled (UI hint; play-time is authoritative). */
export type DisabledReason = TtsUnavailableReason | null;

export interface VoicePlayback {
  transportState: TransportState;
  currentSegmentId: string | null;
  /** The id of the message being read, or null when idle. Pairs with
   *  `currentSegmentId` so the glow lands only on the playing message — segment
   *  ids are not unique across messages. */
  currentMessageId: string | null;
  /** Count of segments the provider declined (auto-skipped) in the current/last read. */
  providerSkips: number;
  /** Start reading a message aloud from `startIndex`. Returns a not-ok reason if TTS cannot run. */
  playMessage: (message: MessageRow, startIndex?: number) => Promise<DisabledReason>;
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
  /** Re-run the TTS resolution and refresh `disabledReason` without playing —
   *  the retry behind a `voices-unavailable` voice control. */
  recheck: () => Promise<void>;
  /** The TTS playback analyser node for the spectrum visualiser, or null before first play. */
  getAnalyser: () => AnalyserNode | null;
  /** Whether read-aloud is currently sounding — lets the spectrum show the
   *  synthetic wave during the initial synthesis (transport is 'speaking' before
   *  audio sounds) rather than a flat empty FFT. */
  getIsAudible: () => boolean;
  /** Unlock the read-aloud media element from a user gesture (send, mic, Read), so a
   *  later automatic read can claim the platform's media controls. Safe to call often. */
  primeOutput: () => void;
}

/** The element plays while words are sounding or coming; paused and idle keep it quiet. */
function readPhaseOf(state: TransportState): ReadPhase {
  if (state === 'speaking' || state === 'waiting') return 'playing';
  if (state === 'paused') return 'paused';
  return 'idle';
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
  /**
   * Force the streaming read-aloud driver on regardless of the autoReadAloud
   * setting. Live voice sets this: in that mode every reply is read aloud as it
   * streams (the persona's floor), independent of the user's auto-read toggle.
   */
  forceStreamingRead = false,
): VoicePlayback {
  const settings = useSettings();

  // The element's own pause/play (lock screen, headset, audio focus) feed back
  // into the machine. The sink is built before the actor exists, so it reaches
  // the actor through this ref.
  const machineSendRef = useRef<(event: { type: 'PAUSE' } | { type: 'RESUME' }) => void>(
    () => undefined,
  );

  // One sink for the hook's lifetime; disposed on unmount. The bridge override
  // is read here, once per sink.
  const sinkRef = useRef<AudioSink | null>(null);
  if (sinkRef.current === null) {
    sinkRef.current = new AudioSink({
      mediaElementBridge: isReadAloudBridgeEnabled(),
      onElementPause: () => machineSendRef.current({ type: 'PAUSE' }),
      onElementPlay: () => machineSendRef.current({ type: 'RESUME' }),
    });
  }

  // The active TTS resolution, set at play time. fetchAudio/play below delegate to it.
  const resolutionRef = useRef<Extract<TtsResolution, { ok: true }> | null>(null);

  // The play closure is built once (useMemo []), so it must read the cleanup
  // setting through a ref rather than capturing it. Updated every render.
  const cleanupSettingRef = useRef<TtsHighpassSetting>('auto');
  cleanupSettingRef.current = settings.data?.ttsHighpass ?? 'auto';

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
      const profile = resolveCleanupProfile(
        cleanupSettingRef.current,
        resolutionRef.current?.defaultHighpassHz,
      );
      try {
        await sink.play(blob, { profile, signal });
      } catch {
        // Decode failure: the cached blob for THIS segment is poisoned. The
        // machine hands us the very segment it played, so we evict and re-fetch
        // exactly that segment — never a concurrently-prefetched one. Retry once;
        // a second failure rethrows and lands the machine in 'failed'.
        const resolution = resolutionRef.current;
        if (!resolution) throw new Error('voice: decode-retry with no active resolution');
        await cacheDelete(resolution.cacheKeyFor(segment));
        const fresh = await resolution.fetchAudio(segment, signal);
        await sink.play(fresh, { profile, signal });
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
  const currentMessageId = useSelector(actor, selectCurrentMessageId);
  const providerSkips = useSelector(actor, selectProviderSkips);
  machineSendRef.current = (event) => actor.send(event);

  // Live voice shares this sink but never goes through the element: no OS
  // surface may silence the persona while the open mic carries on (Laura's hard
  // finding). Declared before the phase effect so a render that changes both
  // re-routes first.
  useEffect(() => {
    sinkRef.current?.setRoute(forceStreamingRead ? 'direct' : 'bridge');
  }, [forceStreamingRead]);

  // The element's play state follows read-aloud's state, not the sink's lifetime.
  useEffect(() => {
    sinkRef.current?.setReadPhase(readPhaseOf(transportState));
  }, [transportState]);

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

  // Mode / roleplay change → stop any active read (Chris's call, device finding
  // 2026-06-12). The machine froze its segment list AND its `${block}:${ordinal}`
  // segment-id namespace at PLAY time, but the renderer re-segments live from the
  // new setting — so after a toggle the glow ids no longer match the rendered
  // spans and the highlight falls out. Stopping re-syncs both sides on the next
  // play. The resume offer is dropped too: its remembered segment index is
  // mode-relative, so it would resume into the wrong sentence under the new mode.
  // The very first settings resolution is not a change, so the initial mount
  // never stops.
  const segKey = `${segmentationOpts.mode}:${segmentationOpts.roleplay}`;
  const prevSegKeyRef = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on segKey alone — actor is stable and clearOffer must not retrigger the stop
  useEffect(() => {
    const prev = prevSegKeyRef.current;
    prevSegKeyRef.current = segKey;
    if (prev === null || prev === segKey) return;
    clearOffer();
    if (!actor.getSnapshot().matches('idle')) actor.send({ type: 'STOP' });
  }, [segKey]);

  // ---- Auto-read driver (spec Task 4) ----------------------------------------
  // Translates streaming-draft progress into machine events. Lives inside
  // useVoicePlayback so it shares the one machine actor + AudioSink with manual
  // read-aloud — no second sequencer, no second sink.
  const autoReadAloud = settings.data?.autoReadAloud ?? false;
  // The streaming read runs when the user has auto-read on OR live voice is
  // active (which reads every reply aloud as the persona's floor, independent
  // of the auto-read toggle).
  const wantStreamingRead = autoReadAloud || forceStreamingRead;
  const handle = useStreamManagerStore((s: { streams: Map<string, StreamHandle> }) =>
    chatId ? (s.streams.get(chatId) ?? null) : null,
  );
  const autoReadRef = useRef<{ draftId: string; sentCount: number; doneSent: boolean } | null>(
    null,
  );
  const wasAutoOnRef = useRef(wantStreamingRead);

  // Turning the streaming read off (auto-read toggled off, or live voice left)
  // silences any current auto-read playback and clears the driver's tracking.
  useEffect(() => {
    if (!wantStreamingRead && wasAutoOnRef.current) {
      if (!actor.getSnapshot().matches('idle')) actor.send({ type: 'STOP' });
      autoReadRef.current = null;
    }
    wasAutoOnRef.current = wantStreamingRead;
  }, [wantStreamingRead, actor]);

  // The driver: translate streaming-draft progress into machine events.
  // biome-ignore lint/correctness/useExhaustiveDependencies: clearOffer is stable (closure over chatId); actor is stable
  useEffect(() => {
    if (!wantStreamingRead || !persona || !handle) return;
    const draftId = handle.draftMessageId;
    const streamDone = handle.status !== 'streaming';
    const tracked = autoReadRef.current;

    // A new generation superseded the one we were reading — stop and re-arm.
    if (tracked && tracked.draftId !== draftId) {
      if (!actor.getSnapshot().matches('idle')) actor.send({ type: 'STOP' });
      autoReadRef.current = null;
    }

    const segments = committedSegments(handle.contentBuffer, streamDone, segmentationOpts);
    if (segments.length === 0) return;

    if (autoReadRef.current === null) {
      // Arm: kick off async resolution. Between arming and PLAY the buffer
      // may have grown, so we recompute `fresh` from the latest handle snapshot
      // inside `.then` and bail if the draft changed.
      autoReadRef.current = { draftId, sentCount: 0, doneSent: false };
      void resolveTts(persona).then((resolution) => {
        // Write the outcome back, as playMessage does, so a failure here is
        // visible on the voice controls rather than silently dropped.
        setDisabledReason(resolution.ok ? null : resolution.reason);
        if (!resolution.ok) {
          autoReadRef.current = null;
          return;
        }
        const live = useStreamManagerStore.getState().streams.get(chatId);
        if (!live || live.draftMessageId !== draftId) return;
        const done = live.status !== 'streaming';
        const fresh = committedSegments(live.contentBuffer, done, segmentationOpts);
        if (fresh.length === 0) {
          autoReadRef.current = null;
          return;
        }
        resolutionRef.current = resolution;
        lastPlayRef.current = { messageId: draftId, segments: fresh };
        clearOffer();
        if (!actor.getSnapshot().matches('idle')) actor.send({ type: 'STOP' });
        actor.send({
          type: 'PLAY',
          messageId: draftId,
          segments: fresh,
          startIndex: 0,
          streamComplete: done,
        });
        // Record what we sent so subsequent effect runs can skip redundant dispatches.
        autoReadRef.current = { draftId, sentCount: fresh.length, doneSent: done };
        if (done) actor.send({ type: 'STREAM_DONE' });
      });
      return;
    }

    // Subsequent-commits branch: only dispatch when something changed.
    if (segments.length > autoReadRef.current.sentCount) {
      actor.send({ type: 'SEGMENTS_UPDATED', segments });
      autoReadRef.current.sentCount = segments.length;
    }
    if (streamDone && !autoReadRef.current.doneSent) {
      actor.send({ type: 'STREAM_DONE' });
      autoReadRef.current.doneSent = true;
    }
  }, [wantStreamingRead, persona, handle, chatId, segmentationOpts, actor]);
  // ---- End auto-read driver ---------------------------------------------------

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

  const primeOutput = (): void => {
    // Live voice never uses the element; a persona without TTS has nothing to unlock for.
    if (forceStreamingRead || disabledReason !== null) return;
    sinkRef.current?.primeBridge();
  };

  const playMessage = async (message: MessageRow, startIndex = 0): Promise<DisabledReason> => {
    // Before the first await, so the Read tap's gesture is still current.
    primeOutput();
    if (!persona) return 'no-provider';
    const segments = segmentMessage(message.contentBlocks, segmentationOpts);
    if (segments.length === 0) return null; // nothing speakable — belt-and-braces
    const resolution = await resolveTts(persona);
    // Play-time is authoritative: write the outcome back so a hint from the
    // mount probe (e.g. a transient voices-unavailable) heals or stays accurate.
    setDisabledReason(resolution.ok ? null : resolution.reason);
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
    primeOutput();
    const pos = peekPosition(chatId);
    if (!pos) return;
    void playRemembered(pos.segmentIndex);
  };

  const startOver = (): void => {
    primeOutput();
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

  const recheck = async (): Promise<void> => {
    if (!persona) {
      setDisabledReason('no-provider');
      return;
    }
    try {
      const resolution = await resolveTts(persona);
      setDisabledReason(resolution.ok ? null : resolution.reason);
    } catch {
      setDisabledReason('no-provider');
    }
  };

  return {
    transportState,
    currentSegmentId,
    currentMessageId,
    providerSkips,
    playMessage,
    resume,
    startOver,
    pause: () => actor.send({ type: 'PAUSE' }),
    resumeAudio: () => {
      primeOutput();
      actor.send({ type: 'RESUME' });
    },
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
    recheck,
    getAnalyser: () => sinkRef.current?.getAnalyser() ?? null,
    getIsAudible: () => sinkRef.current?.isAudible() ?? false,
    primeOutput,
  };
}
