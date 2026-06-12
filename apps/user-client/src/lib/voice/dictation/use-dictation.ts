// SPDX-License-Identifier: AGPL-3.0-only
import { listSttOfferings } from '@chatsundere/llm-unified';
import { useActorRef, useSelector } from '@xstate/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActorRefFrom } from 'xstate';
import { useProviders } from '../../../data/providers.js';
import { useSettings } from '../../../data/settings.js';
import { audioCapture } from './capture.js';
import {
  type CaptureErrorReason,
  type DictationDeps,
  type DictationUiState,
  TAP_MAX_MS,
  dictationMachine,
  selectCaptureError,
  selectDictationUiState,
  selectFailed,
} from './dictation-machine.js';
import { type SttResolution, resolveStt } from './resolve-stt.js';
import { REDEMPTION_MS_DEFAULT } from './vad-presets.js';

export interface DictationArgs {
  /** Append a completed transcript to the draft (always at the end, spec §3.3). */
  onTranscript: (text: string) => void;
  /** Send a transcript as a message (auto-send path). */
  onSend: (text: string) => void;
  /** True while a persona reply streams — auto-send falls back to onTranscript then. */
  isStreamLive: boolean;
  /** Stop an active read-aloud before capture starts (spec §3.5 / D13). */
  stopPlayback: () => void;
  /**
   * True while the dictation UI (Interaction Mode) is visible. Flipping false
   * LEAVEs the machine: Interaction Mode can collapse without unmounting this
   * hook (outside tap while unpinned, ToC jump), and a listening VAD session
   * must never keep the mic hot behind a vanished control (privacy).
   */
  active: boolean;
}

export interface Dictation {
  uiState: DictationUiState;
  /** 0..1 mic level for the button glow; 0 when not capturing. */
  level: number;
  /** STT resolvable? false → mic renders disabled-with-tooltip. */
  available: boolean;
  failed: boolean;
  /** Why the parked utterance failed — drives the failed-note copy (spec §6). Null while healthy. */
  failedKind: 'refusal' | 'transient' | null;
  captureError: CaptureErrorReason | null;
  pressStart: () => void;
  /** Release of a press; the hook computes heldMs itself. */
  pressEnd: () => void;
  pressCancel: () => void;
  /** Stop a listening VAD session. */
  tap: () => void;
  /** Cancel in-flight transcription (draining). */
  cancel: () => void;
  retry: () => void;
  discard: () => void;
}

/**
 * Per-press verdict for the single utterance `capture.stopPTT()` always
 * delivers: 'drain' (a genuine hold — forward it for transcription) or
 * 'discard' (a tap, a cancel, or a start failure — the delivery is scratch).
 *
 * This ref-based intent satisfies all three CaptureBridge contracts at once
 * (see the bridge JSDoc in dictation-machine.ts): the scratch is never
 * forwarded (a), a genuine hold's utterance always is — even when empty (b),
 * and because the verdict is fixed BEFORE the PRESS_END/PRESS_CANCEL event is
 * sent, the WAV-fallback's synchronous delivery inside the machine's own
 * transition action reads it correctly without ever consulting the snapshot,
 * so no microtask deferral is needed (c).
 */
type PressIntent = 'discard' | 'drain';

/**
 * The single owner of dictation for the chat view (spec Task 9). It owns one
 * {@link dictationMachine} actor for its lifetime, wraps the `audioCapture`
 * singleton into the machine's injected deps, and translates capture
 * callbacks into machine events. Deps are built once over refs (the
 * use-voice-playback idiom), so latest args/settings are read at event time
 * without re-creating the actor.
 */
export function useDictation(args: DictationArgs): Dictation {
  const settings = useSettings();
  const providers = useProviders();

  // Latest args/settings, read by the once-built deps at event time.
  const argsRef = useRef(args);
  argsRef.current = args;
  const settingsRef = useRef(settings.data);
  settingsRef.current = settings.data;

  // actorRef is written immediately after useActorRef below; the deps close over it to avoid a circular useMemo dependency.
  const actorRef = useRef<ActorRefFrom<typeof dictationMachine> | null>(null);
  // The ok STT resolution, resolved lazily on the first press and cached for
  // the hook's lifetime (mk/decrypt are not free).
  const sttResolutionRef = useRef<Extract<SttResolution, { ok: true }> | null>(null);

  const pttIntentRef = useRef<PressIntent>('discard');
  const pressStartedAtRef = useRef(0);
  // False once the press is released/cancelled; a pressStart whose lazy
  // resolution finishes after release must not start a phantom capture.
  const pressActiveRef = useRef(false);
  const pressEpochRef = useRef(0);
  // The browser fires a synthetic `click` after every pointerdown+pointerup
  // pair, and React morphs the SAME DOM button between the mic / capture /
  // cancel-transcribe variants — so the click born from the gesture that
  // STARTED a session lands on the morphed button's onClick: a tap-to-dictate
  // release would hit the capture variant's tap() (TAP at pending 0 — the
  // fresh VAD session self-cancels instantly), a PTT release would hit the
  // cancel-transcribe variant's cancel() (aborting the just-spawned
  // transcription). pressEnd arms this one-shot flag; tap()/cancel()
  // check-and-clear it and no-op when armed. A genuine later tap has no
  // owning pressEnd (its pointerup hits the no-press guard) and passes.
  const suppressNextClickRef = useRef(false);

  const [level, setLevel] = useState(0);
  const latestLevelRef = useRef(0);
  const levelFrameRef = useRef<number | null>(null);

  // Coalesce the capture meter's per-frame volume callbacks into at most one
  // setState per animation frame — no re-render storms.
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

  // A press-time resolution failure (cannot normally happen: the button is
  // disabled when unavailable). The machine never entered ptt then, so its
  // own captureError slot stays null — this hook-local slot fills the gap.
  const [resolveError, setResolveError] = useState<CaptureErrorReason | null>(null);

  const deps = useMemo<DictationDeps>(() => {
    const classify = (error: unknown): CaptureErrorReason => {
      // Structural name check: getUserMedia rejects with a DOMException,
      // which does not inherit Error in every environment (jsdom included).
      const name = (error as { name?: unknown } | null)?.name;
      return name === 'NotAllowedError' || name === 'SecurityError' ? 'permission' : 'device';
    };

    return {
      startPtt: async (bridge) => {
        try {
          await audioCapture.startPTT({
            onSpeechStart: () => {},
            onSpeechEnd: (audio) => {
              // Only a genuine hold drains the PTT utterance; after a tap or
              // PRESS_CANCEL the singleton still delivers one scratch
              // utterance, which must NOT reach the machine (it would be
              // transcribed as a VAD utterance). See {@link PressIntent} for
              // why this ref also covers the synchronous WAV-fallback path.
              if (pttIntentRef.current === 'drain') bridge.onSpeechEnd(audio.blob, audio.mimeType);
            },
            onVolumeChange: pushLevel,
          });
        } catch (error) {
          // getUserMedia rejects before any audio graph exists; stopPTT()
          // clears the singleton's dangling callback slot. Its obligatory
          // empty delivery is forced to scratch so nothing gets forwarded.
          pttIntentRef.current = 'discard';
          audioCapture.stopPTT();
          resetLevel();
          actorRef.current?.send({ type: 'CAPTURE_ERROR', reason: classify(error) });
          throw error;
        }
      },
      stopPtt: () => {
        audioCapture.stopPTT();
        resetLevel();
      },
      startVad: async (bridge) => {
        // Settings are read AT session start — a mid-session settings change
        // never retargets a running VAD session.
        const sensitivity = settingsRef.current?.dictationSensitivity ?? 'medium';
        const redemptionMs = settingsRef.current?.dictationRedemptionMs ?? REDEMPTION_MS_DEFAULT;
        try {
          await audioCapture.startContinuous(
            {
              onSpeechStart: () => {},
              // VAD utterances are always genuine — forward unconditionally.
              onSpeechEnd: (audio) => bridge.onSpeechEnd(audio.blob, audio.mimeType),
              onVolumeChange: pushLevel,
              onMisfire: () => bridge.onMisfire(),
            },
            { sensitivity, redemptionMs },
          );
        } catch (error) {
          // A MicVAD.new failure can leave the singleton with a dangling
          // callback slot; stopContinuous() is safe on a half-started state.
          audioCapture.stopContinuous();
          resetLevel();
          actorRef.current?.send({ type: 'CAPTURE_ERROR', reason: classify(error) });
          throw error;
        }
      },
      stopVad: () => {
        audioCapture.stopContinuous();
        resetLevel();
      },
      transcribe: (blob, mimeType, signal) => {
        const resolution = sttResolutionRef.current;
        if (resolution === null) {
          // Unreachable: pressStart resolves STT before sending PRESS_START.
          return Promise.reject(new Error('dictation: transcribe with no STT resolution'));
        }
        return resolution.transcribe(blob, mimeType, signal);
      },
      emitTranscript: (text) => {
        // An empty PTT recording legitimately transcribes to '' — the empty
        // utterance WAS forwarded (contract: stopPTT always delivers one),
        // so the machine's pending count settled; only the emission is
        // dropped here.
        if (text.trim() === '') return;
        const current = argsRef.current;
        if (settingsRef.current?.dictationAutoSend === true && !current.isStreamLive) {
          current.onSend(text);
        } else {
          current.onTranscript(text);
        }
      },
    };
  }, [pushLevel, resetLevel]);

  const actor = useActorRef(dictationMachine, { input: { deps } });
  actorRef.current = actor;

  const uiState = useSelector(actor, selectDictationUiState);
  const failedUtterance = useSelector(actor, selectFailed);
  const machineCaptureError = useSelector(actor, selectCaptureError);

  // UI-light availability check only; full resolution (mk/decrypt) is lazy.
  const available = useMemo(() => {
    const rows = providers.data;
    if (!rows) return false;
    return listSttOfferings().some((offering) =>
      rows.some((row) => row.enabled && row.templateId === offering.providerId),
    );
  }, [providers.data]);

  // A stale resolution error must not outlive the user fixing their provider.
  useEffect(() => {
    if (available) setResolveError(null);
  }, [available]);

  const pressStart = (): void => {
    if (!available) return; // the button renders disabled — belt-and-braces
    pressStartedAtRef.current = performance.now();
    pressActiveRef.current = true;
    // A new press invalidates any stale suppression (e.g. a previous press
    // whose synthetic click never arrived because the drain settled to the
    // mic variant, which has no onClick to consume it).
    suppressNextClickRef.current = false;
    const token = ++pressEpochRef.current;
    setResolveError(null);
    // Read-aloud must stop BEFORE the mic opens (spec §3.5 / D13).
    argsRef.current.stopPlayback();
    void (async () => {
      let resolution = sttResolutionRef.current;
      if (resolution === null) {
        try {
          const fresh = await resolveStt();
          if (fresh.ok) {
            sttResolutionRef.current = fresh;
            resolution = fresh;
          }
        } catch {
          // Treated identically to a not-ok resolution below.
        }
      }
      if (pressEpochRef.current !== token) return; // superseded by a newer press
      if (resolution === null) {
        setResolveError('device');
        return;
      }
      if (!pressActiveRef.current) {
        // Released before resolution finished — capture never started, so
        // there is nothing to drain or discard (first press only; the
        // resolution is cached afterwards).
        return;
      }
      pttIntentRef.current = 'discard'; // scratch until a hold proves otherwise
      actor.send({ type: 'PRESS_START' });
    })();
  };

  const pressEnd = (): void => {
    // The capture variant routes pointerup here too, so the stop-tap on a
    // running VAD session fires pressEnd with no owning pressStart. There is
    // nothing to end then — and crucially the click suppression below must
    // NOT be armed, or the stop-tap's own click would be eaten and the
    // session would become un-stoppable by tapping.
    if (!pressActiveRef.current) return;
    // Cleared BEFORE the event is sent, so the pointerleave that touch
    // devices fire right after pointerup hits pressCancel's no-press guard.
    pressActiveRef.current = false;
    // Arm the synthetic-click suppression — see {@link suppressNextClickRef}.
    suppressNextClickRef.current = true;
    const heldMs = performance.now() - pressStartedAtRef.current;
    // Fix the per-press verdict BEFORE sending PRESS_END: the WAV-fallback
    // path delivers the PTT utterance synchronously inside this very
    // transition — see {@link PressIntent}.
    pttIntentRef.current = heldMs < TAP_MAX_MS ? 'discard' : 'drain';
    actor.send({ type: 'PRESS_END', heldMs });
  };

  const pressCancel = (): void => {
    // No-op without an active press. On touch devices pointerleave fires
    // right AFTER every pointerup, i.e. immediately after pressEnd already
    // set the 'drain' intent — without this guard the stale pointerleave
    // would flip the intent ref back to 'discard', the MediaRecorder's async
    // PTT delivery would be dropped, and drainingPtt would strand at
    // "Transcribing…". (It also makes a press-less hover-leave inert.)
    if (!pressActiveRef.current) return;
    pressActiveRef.current = false;
    pttIntentRef.current = 'discard';
    actor.send({ type: 'PRESS_CANCEL' });
  };

  // LEAVE when the dictation UI disappears without this hook unmounting —
  // Interaction Mode collapses on an outside tap while unpinned, or on a ToC
  // jump. A listening VAD session would otherwise keep capturing with no
  // visible control (privacy). LEAVE stops capture and aborts every in-flight
  // transcription actor (the machine's existing cleanup).
  const active = args.active;
  useEffect(() => {
    if (!active) actorRef.current?.send({ type: 'LEAVE' });
  }, [active]);

  // LEAVE on unmount. useActorRef's own cleanup stops the actor BEFORE this
  // cleanup runs (its effect was declared first), so the LEAVE is usually
  // dropped — fall back to stopping live capture directly off the last
  // snapshot. When the actor IS still alive, LEAVE unwinds it and the
  // re-read snapshot shows idle, so the fallback stays quiet.
  useEffect(() => {
    return () => {
      const current = actorRef.current;
      const before = current?.getSnapshot();
      current?.send({ type: 'LEAVE' });
      const leaveHandled = current?.getSnapshot().matches('idle') ?? false;
      if (!leaveHandled && (before?.matches('ptt') ?? false)) audioCapture.stopPTT();
      if (!leaveHandled && (before?.matches('vad') ?? false)) audioCapture.stopContinuous();
      resetLevel();
    };
  }, [resetLevel]);

  // One-shot check-and-clear of the gesture's synthetic click — see
  // {@link suppressNextClickRef} for the race this defeats.
  const consumeSuppressedClick = (): boolean => {
    if (!suppressNextClickRef.current) return false;
    suppressNextClickRef.current = false;
    return true;
  };

  return {
    uiState,
    level,
    available,
    failed: failedUtterance !== null,
    failedKind: failedUtterance?.kind ?? null,
    captureError: machineCaptureError ?? resolveError,
    pressStart,
    pressEnd,
    pressCancel,
    tap: () => {
      if (consumeSuppressedClick()) return; // the click belonged to the starting gesture
      actor.send({ type: 'TAP' });
    },
    cancel: () => {
      if (consumeSuppressedClick()) return; // ditto — must not abort the just-spawned drain
      actor.send({ type: 'CANCEL' });
    },
    retry: () => actor.send({ type: 'RETRY' }),
    discard: () => actor.send({ type: 'DISCARD' }),
  };
}
