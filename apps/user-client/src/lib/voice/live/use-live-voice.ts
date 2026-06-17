// SPDX-License-Identifier: AGPL-3.0-only
import { useActorRef, useSelector } from '@xstate/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActorRefFrom } from 'xstate';
import { audioCapture } from '../dictation/capture.js';
import { type SttResolution, resolveStt } from '../dictation/resolve-stt.js';
import { float32ToWavBlob } from '../dictation/wav-encoder.js';
import type { VoicePlayback } from '../use-voice-playback.js';
import {
  type Floor,
  type LiveVoiceDeps,
  liveVoiceMachine,
  selectFill,
  selectFloor,
} from './live-voice-machine.js';

export interface LiveVoiceArgs {
  /** Send a transcribed turn (chat-page's onSend). */
  onSend: (text: string) => void;
  /** The shared read-aloud controller (chat-page's useVoicePlayback). */
  voice: VoicePlayback;
  /**
   * Abort the in-flight reply generation for the active chat (barge / floor
   * reclaim). The partial reply is preserved; a no-op once generation finished.
   */
  abortReply: () => void;
  /**
   * True while a reply is streaming for the active chat. The persona-floor
   * bridge reads this to distinguish "awaiting first audio" from "the reply
   * finished with nothing speakable" (so the loop never hangs in thinking).
   */
  replyStreaming: boolean;
  /** VAD sensitivity from settings (mirrors dictation's field). */
  sensitivity: 'low' | 'medium' | 'high';
  /** VAD redemption window in ms from settings. */
  redemptionMs: number;
}

export interface LiveVoice {
  floor: Floor;
  /** Redemption-fill progress 0..1 (drives the fill-from-left countdown). */
  fill: number;
  /** Mic volume level 0..1 (drives the button pulse). */
  level: number;
  /** True when STT is resolvable (availability check, refined in Phase 4 gating). */
  available: boolean;
  enter: () => void;
  exit: () => void;
  hold: () => void;
  resume: () => void;
  pressStart: () => void;
  pressEnd: () => void;
  /** Resolves to CANCEL while transcribing, BARGE while persona floor, else no-op. */
  tap: () => void;
  barge: () => void;
}

/**
 * The single owner of live-voice mode for one chat view. It owns one
 * {@link liveVoiceMachine} actor for its lifetime, wires continuous VAD
 * capture → machine events, drives STT transcription (lazy-cached resolution),
 * and bridges read-aloud playback completion back into the machine.
 *
 * Follows the deps-built-once-over-refs idiom established by useDictation and
 * useVoicePlayback: latest args are read at event time, never at closure time.
 */
export function useLiveVoice(args: LiveVoiceArgs): LiveVoice {
  // Latest args, read by the once-built deps at event time.
  const argsRef = useRef(args);
  argsRef.current = args;

  // actorRef is written immediately after useActorRef below; deps close over it
  // to avoid a circular useMemo dependency.
  const actorRef = useRef<ActorRefFrom<typeof liveVoiceMachine> | null>(null);

  // The ok STT resolution, resolved lazily on the first capture start and
  // cached for the hook's lifetime (mk/decrypt are not free).
  const sttRef = useRef<Extract<SttResolution, { ok: true }> | null>(null);

  // Guard: true while the mic is physically open. Prevents a second
  // startContinuous call if startCapture fires more than once before a stop
  // (e.g. re-entry to listening from personaSpeaking via BARGE → stopCapture
  // is idempotent on the same line, but the entry fires again on arrival).
  const capturingRef = useRef(false);

  // ---- Level coalescing — identical discipline to use-dictation.ts -----------
  // Coalesce the capture meter's per-frame volume callbacks into at most one
  // setState per animation frame so high-frequency VAD callbacks do not storm
  // the React scheduler.
  const [level, setLevel] = useState(0);
  const latestLevelRef = useRef(0);
  const levelFrameRef = useRef<number | null>(null);

  const pushLevel = useCallback((value: number) => {
    latestLevelRef.current = value;
    if (levelFrameRef.current !== null) return;
    levelFrameRef.current = requestAnimationFrame(() => {
      levelFrameRef.current = null;
      setLevel(latestLevelRef.current);
    });
  }, []);

  const resetLevel = useCallback(() => {
    latestLevelRef.current = 0;
    if (levelFrameRef.current !== null) {
      cancelAnimationFrame(levelFrameRef.current);
      levelFrameRef.current = null;
    }
    setLevel(0);
  }, []);
  // --------------------------------------------------------------------------

  const deps = useMemo<LiveVoiceDeps>(
    () => ({
      startCapture: () => {
        // Idempotent: if the mic is already open, skip the second arm.
        if (capturingRef.current) return;
        capturingRef.current = true;

        const a = argsRef.current;
        void audioCapture
          .startContinuous(
            {
              onSpeechStart: () => actorRef.current?.send({ type: 'SPEECH_START' }),
              onSpeechEnd: (audio) =>
                actorRef.current?.send({
                  type: 'SPEECH_END',
                  pcm: audio.pcm,
                  blob: audio.blob,
                  mimeType: audio.mimeType,
                }),
              onMisfire: () => actorRef.current?.send({ type: 'MISFIRE' }),
              onRedemptionProgress: (fraction) =>
                actorRef.current?.send({ type: 'PROGRESS', fraction }),
              onVolumeChange: pushLevel,
            },
            { sensitivity: a.sensitivity, redemptionMs: a.redemptionMs },
          )
          .catch(() => {
            // Permission denied or device error — the button is gated by
            // `available`, so reaching here is a belt-and-braces edge case.
            // The machine is left in listening; EXIT is the recovery path.
            capturingRef.current = false;
            resetLevel();
          });
      },
      stopCapture: () => {
        // Idempotent: no-op if the mic was never opened (or already closed).
        if (!capturingRef.current) return;
        capturingRef.current = false;
        audioCapture.stopContinuous();
        resetLevel();
      },
      pausePlayback: () => argsRef.current.voice.pause(),
      resumePlayback: () => argsRef.current.voice.resumeAudio(),
      transcribe: async (pcm, blob, mimeType, signal) => {
        // Lazy resolution: cache after the first successful resolve so
        // mk/decrypt only run once per hook lifetime.
        let res = sttRef.current;
        if (!res) {
          const fresh = await resolveStt();
          if (fresh.ok) {
            sttRef.current = fresh;
            res = fresh;
          }
        }
        if (!res) throw new Error('live-voice: no STT resolution available');

        // Held-merge path: heldPcm was merged by the machine (mergePcm) and
        // the container blob is a zero-byte sentinel — build the real WAV here.
        const payload =
          mimeType === 'audio/wav' && blob.size === 0 ? float32ToWavBlob(pcm, 16_000) : blob;

        return res.transcribe(payload, payload === blob ? mimeType : 'audio/wav', signal);
      },
      sendMessage: (text) => argsRef.current.onSend(text),
      abortReply: () => argsRef.current.abortReply(),
      stopPlayback: () => argsRef.current.voice.stop(),
    }),
    [pushLevel, resetLevel],
  );

  const actor = useActorRef(liveVoiceMachine, { input: { deps } });
  // Write actorRef immediately so the deps callbacks above can reach it.
  actorRef.current = actor;

  const floor = useSelector(actor, selectFloor);
  const fill = useSelector(actor, selectFill);

  // ---- Persona-floor bridge --------------------------------------------------
  // The persona floor is driven by the streaming read-aloud transport (the same
  // voiceMachine the auto-read driver feeds), NOT by reading a message directly.
  // While on the persona floor this maps transport edges to machine events:
  //   • first non-idle transport while thinking → PLAYBACK_STARTED (→ speaking)
  //   • non-idle → idle                          → PLAYBACK_DONE   (→ listening)
  //   • failed / ended-partial                   → PLAYBACK_FAILED (→ listening)
  // and covers the empty-reply case (the turn produced nothing speakable) so the
  // loop never hangs in thinking. Same edge-detect idiom as use-dictation.
  const transport = args.voice.transportState;
  const prevTransportRef = useRef(transport);
  const replyStreaming = args.replyStreaming;
  // True once the reply stream for the current persona turn has been seen live,
  // distinguishing "still awaiting first audio" from "stream came and went with
  // nothing to read". Reset whenever the floor leaves the persona.
  const sawReplyStreamRef = useRef(false);

  useEffect(() => {
    const prev = prevTransportRef.current;
    prevTransportRef.current = transport;

    // Only bridge while the machine holds the persona floor.
    if (floor !== 'personaThinking' && floor !== 'personaSpeaking') {
      sawReplyStreamRef.current = false;
      return;
    }

    if (replyStreaming) sawReplyStreamRef.current = true;

    // TTS failure or a skipped-off-the-end finish: end the turn. The reply text
    // is already in the chat; both land back in listening.
    if (transport === 'failed' || transport === 'ended-partial') {
      actorRef.current?.send({ type: 'PLAYBACK_FAILED' });
      return;
    }

    if (transport !== 'idle') {
      // The persona is producing audio — leave thinking the moment it starts.
      if (floor === 'personaThinking') {
        actorRef.current?.send({ type: 'PLAYBACK_STARTED' });
      }
      return;
    }

    // transport === 'idle' from here.
    if (prev !== 'idle') {
      // Non-idle → idle: playback finished naturally.
      actorRef.current?.send({ type: 'PLAYBACK_DONE' });
      return;
    }

    // Persistently idle while thinking: if the reply stream has already run and
    // finished without ever producing audio, the turn had nothing speakable —
    // return the floor rather than wait forever.
    if (floor === 'personaThinking' && sawReplyStreamRef.current && !replyStreaming) {
      actorRef.current?.send({ type: 'PLAYBACK_DONE' });
    }
  }, [transport, floor, replyStreaming]);
  // --------------------------------------------------------------------------

  // Clean up on unmount: stop any live capture that was left running.
  // Uses capturingRef directly — state-agnostic, covers sttFailed too.
  useEffect(() => {
    return () => {
      if (capturingRef.current) {
        capturingRef.current = false;
        audioCapture.stopContinuous();
      }
      resetLevel();
    };
  }, [resetLevel]);

  return {
    floor,
    fill,
    level,
    // Phase 4 will gate this on live STT + TTS resolvability; for now the
    // machine's own ENTER/EXIT gate is sufficient (the cockpit button will
    // carry the voiceUnavailable guard).
    available: true,
    enter: () => actor.send({ type: 'ENTER' }),
    exit: () => actor.send({ type: 'EXIT' }),
    hold: () => actor.send({ type: 'HOLD' }),
    resume: () => actor.send({ type: 'RESUME' }),
    pressStart: () => actor.send({ type: 'PRESS_START' }),
    pressEnd: () => actor.send({ type: 'PRESS_END', heldMs: 0 }),
    tap: () => {
      if (floor === 'transcribing') {
        actor.send({ type: 'CANCEL' });
      } else if (floor === 'personaThinking' || floor === 'personaSpeaking') {
        actor.send({ type: 'BARGE' });
      }
      // listening / userSpeaking: the user already has the floor — no-op.
    },
    barge: () => actor.send({ type: 'BARGE' }),
  };
}
