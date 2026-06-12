// SPDX-License-Identifier: AGPL-3.0-only
import { TranscriptionError } from '@chatsundere/llm-unified';
import { type SnapshotFrom, assign, enqueueActions, fromPromise, setup } from 'xstate';

/**
 * The XState v5 dictation machine — one button, no mixed mode (spec D4).
 * Capture starts at pointerdown; a sub-{@link TAP_MAX_MS} press is a tap
 * (the scratch PTT capture is discarded and a VAD session starts), a longer
 * hold is push-to-talk (release transcribes the whole recording).
 *
 * Fully dependency-injected, mirroring `voice-machine.ts`: it NEVER imports
 * `capture.ts` or `resolve-stt.ts`. All side effects arrive via
 * {@link DictationDeps} on `input.deps`; tests drive it with mocks and the
 * React hook (Task 9) wires the real implementations.
 *
 * Transcriptions run as SPAWNED `fromPromise` actors (one per completed
 * utterance, `pending` counts them) so a VAD session can keep listening while
 * earlier utterances are still uploading. Each actor receives its own
 * `AbortSignal`, which XState aborts when the actor is stopped — CANCEL/LEAVE
 * stop every in-flight actor and the upload aborts with no manual
 * `AbortController` bookkeeping. The 30 s transport timeout lives inside the
 * injected `transcribe` (resolve-stt), so a hung request rejects into the
 * normal failure path.
 */

/** A press shorter than this is a tap (opens a VAD session); a longer hold is push-to-talk. */
export const TAP_MAX_MS = 300;

/**
 * The minimal callback bundle the machine hands to the capture layer via
 * `deps.startPtt` / `deps.startVad`, built fresh on each ptt/vad entry so
 * capture events become machine events. The HOOK owns the translation from
 * the capture singleton's callbacks onto this bridge — including dropping
 * stale deliveries: after a tap or PRESS_CANCEL the late PTT scratch
 * utterance must NOT be forwarded (only a drain consumes a PTT utterance;
 * the machine cannot tell a scratch delivery from a real VAD utterance).
 *
 * Two further contract points the hook MUST honour:
 *
 * - `capture.stopPTT()` always delivers exactly one utterance, even when the
 *   recording is empty — the hook must forward it (or send CANCEL); silently
 *   dropping it strands drainingPtt in 'transcribing' at pending=0 forever.
 * - In the WAV-fallback path `stopPTT()` delivers SYNCHRONOUSLY, inside the
 *   machine's own PRESS_END transition action — at that instant the
 *   committed snapshot still reads 'ptt', so a hook that gates forwarding on
 *   `matches('drainingPtt')` would wrongly drop the genuine hold-path
 *   utterance. The hook must defer its forwarding decision by a microtask
 *   (e.g. `await Promise.resolve()` / `queueMicrotask`) before consulting
 *   the snapshot.
 */
export interface CaptureBridge {
  /** A completed utterance, ready for transcription. */
  onSpeechEnd: (blob: Blob, mimeType: string) => void;
  /** VAD-only: a speech-start that turned out to be a noise burst — no utterance follows. */
  onMisfire: () => void;
}

/** An utterance whose transcription failed, parked for Retry/Discard. */
export interface FailedUtterance {
  blob: Blob;
  mimeType: string;
  /**
   * 'refusal' = the provider deterministically declined the recording
   * (4xx other than 408/429 — auth, validation, content moderation);
   * 'transient' = everything else (network, 5xx, timeout, rate-limit).
   * Drives the failed-note copy (spec §6).
   */
  kind: 'refusal' | 'transient';
}

/** Why capture could not start — classified by the hook (Task 9), stored verbatim. */
export type CaptureErrorReason = 'permission' | 'device';

/** All side effects the dictation machine can cause, injected via `input.deps`. */
export interface DictationDeps {
  /**
   * Start push-to-talk capture. Rejects on getUserMedia failure — the hook
   * classifies the rejection (permission vs device) and sends CAPTURE_ERROR;
   * the machine only swallows the rejection to avoid an unhandled-rejection
   * crash (Task-6 review finding).
   */
  startPtt: (cb: CaptureBridge) => Promise<void>;
  /** Stop PTT capture; the recorded utterance is then delivered via the bridge. */
  stopPtt: () => void;
  /** Start a continuous VAD session. Rejects on getUserMedia/MicVAD failure — see `startPtt`. */
  startVad: (cb: CaptureBridge) => Promise<void>;
  /** Tear down the VAD session, flushing any mid-utterance recording as a final delivery. */
  stopVad: () => void;
  /**
   * True while the capture layer holds a VAD utterance that has not been
   * delivered yet: speech started but the redemption window has not elapsed,
   * or the delivery is deferred behind the MediaRecorder's async 'stop'
   * event. Read by the vad TAP guard so the stop-tap drains instead of
   * idling — the flushed delivery must land in drainingVad, not be dropped.
   */
  hasInFlightUtterance: () => boolean;
  /** Transcribe one utterance. Must respect the signal (the transport timeout lives inside). */
  transcribe: (blob: Blob, mimeType: string, signal: AbortSignal) => Promise<string>;
  /** Deliver a finished transcript to the composer. */
  emitTranscript: (text: string) => void;
}

/**
 * Settlement of a transcription actor. The actor itself never rejects:
 * failures resolve as `ok: false` carrying the original blob, so the
 * Retry/Discard surface can respawn with the SAME audio and no separate
 * actorId → blob bookkeeping is needed.
 */
type TranscribeOutcome =
  | { ok: true; text: string }
  | { ok: false; blob: Blob; mimeType: string; status: number | null };

type TranscribeDoneEvent = {
  type: `xstate.done.actor.${string}`;
  output: TranscribeOutcome;
};

export type DictationEvent =
  | { type: 'PRESS_START' }
  | { type: 'PRESS_END'; heldMs: number }
  | { type: 'PRESS_CANCEL' }
  | { type: 'TAP' }
  | { type: 'SPEECH_END'; blob: Blob; mimeType: string }
  | { type: 'MISFIRE' }
  | { type: 'CAPTURE_ERROR'; reason: CaptureErrorReason }
  | { type: 'RETRY' }
  | { type: 'DISCARD' }
  | { type: 'CANCEL' }
  | { type: 'LEAVE' }
  | TranscribeDoneEvent;

export interface DictationContext {
  deps: DictationDeps;
  /** Number of transcription actors in flight. */
  pending: number;
  /** Monotonic id source for spawned transcription actors. */
  seq: number;
  /** Ids of in-flight transcription actors, so CANCEL/LEAVE can stop them all. */
  activeIds: string[];
  failed: FailedUtterance | null;
  captureError: CaptureErrorReason | null;
}

export interface DictationInput {
  deps: DictationDeps;
}

const transcribeUtterance = fromPromise<
  TranscribeOutcome,
  { deps: DictationDeps; blob: Blob; mimeType: string }
>(async ({ input, signal }) => {
  try {
    const text = await input.deps.transcribe(input.blob, input.mimeType, signal);
    return { ok: true, text };
  } catch (error) {
    // An abort means the actor was stopped (CANCEL/LEAVE) — the parent
    // discards this settlement anyway, so only log genuine failures.
    if (!signal.aborted) console.error('[dictation] transcription failed', error);
    // resolve-stt rethrows the upstream TranscriptionError, so the HTTP
    // status survives into the outcome and lets failedFrom classify it.
    const status = error instanceof TranscriptionError ? error.status : null;
    return { ok: false, blob: input.blob, mimeType: input.mimeType, status };
  }
});

const DONE_PREFIX = 'xstate.done.actor.';

function outcomeOf(event: { type: string }): TranscribeOutcome {
  return (event as TranscribeDoneEvent).output;
}

/** Context delta common to every actor settlement: one fewer in flight. */
function settleDelta(
  context: DictationContext,
  event: { type: string },
): Pick<DictationContext, 'pending' | 'activeIds'> {
  const actorId = event.type.slice(DONE_PREFIX.length);
  return {
    pending: Math.max(0, context.pending - 1),
    activeIds: context.activeIds.filter((id) => id !== actorId),
  };
}

/**
 * A deterministic 4xx (bar 408 timeout and 429 rate-limit) means the provider
 * DECLINED this recording rather than failing to reach it — the failed-note
 * copy must say so instead of implying a transient glitch. Retry stays
 * allowed either way: a context-scored moderation verdict can flip on a
 * second pass (the Voxtral lesson).
 */
function classifyFailure(status: number | null): FailedUtterance['kind'] {
  const refusal =
    status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429;
  return refusal ? 'refusal' : 'transient';
}

/** The parked utterance from a failed settlement (null for a successful one). */
function failedFrom(event: { type: string }): FailedUtterance | null {
  const outcome = outcomeOf(event);
  return outcome.ok
    ? null
    : { blob: outcome.blob, mimeType: outcome.mimeType, kind: classifyFailure(outcome.status) };
}

/** Context delta after spawning one transcription actor with id `transcribe-<seq>`. */
function afterSpawn(
  context: DictationContext,
): Pick<DictationContext, 'seq' | 'pending' | 'activeIds'> {
  return {
    seq: context.seq + 1,
    pending: context.pending + 1,
    activeIds: [...context.activeIds, `transcribe-${context.seq}`],
  };
}

/**
 * Transcripts are emitted in COMPLETION order (spec §3.3): each actor's done
 * event emits immediately — there is no reordering buffer.
 */
function emitSettledTranscript({
  context,
  event,
}: {
  context: DictationContext;
  event: { type: string };
}): void {
  const outcome = outcomeOf(event);
  if (outcome.ok) context.deps.emitTranscript(outcome.text);
}

/** The dictation statechart. See the module doc for the capture/transcription model. */
export const dictationMachine = setup({
  types: {
    context: {} as DictationContext,
    events: {} as DictationEvent,
    input: {} as DictationInput,
  },
  actors: { transcribe: transcribeUtterance },
}).createMachine({
  id: 'dictation',
  context: ({ input }) => ({
    deps: input.deps,
    pending: 0,
    seq: 0,
    activeIds: [],
    failed: null,
    captureError: null,
  }),
  initial: 'idle',
  // LEAVE unwinds to idle from EVERY state. ptt and vad override it below to
  // stop their live capture first; draining/failed have no capture running.
  on: { LEAVE: { target: '.idle' } },
  states: {
    idle: {
      // Entering idle always means no transcription may remain in flight:
      // CANCEL, LEAVE and capture errors abort whatever is still pending.
      // captureError deliberately survives (cleared on the next press) so the
      // transport can explain WHY the session ended.
      entry: enqueueActions(({ context, enqueue }) => {
        for (const id of context.activeIds) enqueue.stopChild(id);
        enqueue.assign({ pending: 0, activeIds: [], failed: null });
      }),
      on: {
        PRESS_START: { target: 'ptt' },
      },
    },
    ptt: {
      // Capture starts at pointerdown (spec D4) — tap-vs-hold is only decided
      // at release, so the scratch recording is already rolling either way.
      entry: [
        assign({ captureError: null }),
        ({ context, self }) => {
          // A start failure is classified by the hook (permission vs device),
          // which sends CAPTURE_ERROR; the catch only prevents an unhandled
          // rejection from escaping the actor.
          context.deps
            .startPtt({
              onSpeechEnd: (blob, mimeType) => self.send({ type: 'SPEECH_END', blob, mimeType }),
              onMisfire: () => self.send({ type: 'MISFIRE' }),
            })
            .catch(() => {
              /* translated into CAPTURE_ERROR by the hook */
            });
        },
      ],
      on: {
        PRESS_END: [
          {
            // Tap: discard the scratch PTT capture and open a VAD session —
            // no transcription is spawned for the scratch.
            guard: ({ event }) => event.heldMs < TAP_MAX_MS,
            target: 'vad',
            actions: ({ context }) => context.deps.stopPtt(),
          },
          {
            // Hold: stop capture; the bridge then delivers SPEECH_END in
            // drainingPtt, which spawns the transcription.
            // heldMs is measured by the hook — the machine needs no clock of its own.
            target: 'drainingPtt',
            actions: ({ context }) => context.deps.stopPtt(),
          },
        ],
        PRESS_CANCEL: {
          // Slide-off / Escape: stop and discard. idle ignores any late
          // SPEECH_END delivery, so nothing gets transcribed.
          target: 'idle',
          actions: ({ context }) => context.deps.stopPtt(),
        },
        CAPTURE_ERROR: {
          target: 'idle',
          actions: assign({ captureError: ({ event }) => event.reason }),
        },
        LEAVE: {
          target: 'idle',
          actions: ({ context }) => context.deps.stopPtt(),
        },
      },
    },
    vad: {
      entry: ({ context, self }) => {
        // Rejection contract identical to startPtt — see the ptt entry.
        context.deps
          .startVad({
            onSpeechEnd: (blob, mimeType) => self.send({ type: 'SPEECH_END', blob, mimeType }),
            onMisfire: () => self.send({ type: 'MISFIRE' }),
          })
          .catch(() => {
            /* translated into CAPTURE_ERROR by the hook */
          });
      },
      on: {
        // Each completed utterance gets its own transcription actor; the
        // session keeps listening for the next one.
        SPEECH_END: {
          actions: assign(({ context, event, spawn }) => {
            spawn('transcribe', {
              id: `transcribe-${context.seq}`,
              input: { deps: context.deps, blob: event.blob, mimeType: event.mimeType },
            });
            return afterSpawn(context);
          }),
        },
        // A VAD false positive: no utterance, no error — keep listening.
        MISFIRE: {},
        TAP: [
          {
            // `pending` counts spawned actors; `hasInFlightUtterance` covers
            // the utterance the stop-tap itself ends (speech started, no
            // SPEECH_END yet — the NORMAL tap-right-after-speaking gesture,
            // spec D16). stopVad triggers the capture flush, whose SPEECH_END
            // delivery arrives AFTER this transition — which is exactly why
            // drainingVad handles SPEECH_END.
            guard: ({ context }) => context.pending > 0 || context.deps.hasInFlightUtterance(),
            target: 'drainingVad',
            actions: ({ context }) => context.deps.stopVad(),
          },
          {
            // Nothing pending but a failure is parked: idle's entry would
            // clear the slot and the utterance would be silently lost —
            // settle in `failed` so the Retry/Discard surface survives the
            // session stop.
            guard: ({ context }) => context.failed !== null,
            target: 'failed',
            actions: ({ context }) => context.deps.stopVad(),
          },
          {
            target: 'idle',
            actions: ({ context }) => context.deps.stopVad(),
          },
        ],
        CAPTURE_ERROR: {
          target: 'idle',
          actions: assign({ captureError: ({ event }) => event.reason }),
        },
        LEAVE: {
          target: 'idle',
          actions: ({ context }) => context.deps.stopVad(),
        },
        // Respawn the parked utterance with the SAME blob; the session never
        // stopped listening, so we stay right here.
        RETRY: {
          guard: ({ context }) => context.failed !== null,
          actions: assign(({ context, spawn }) => {
            const failed = context.failed;
            if (failed === null) return {};
            spawn('transcribe', {
              id: `transcribe-${context.seq}`,
              input: { deps: context.deps, blob: failed.blob, mimeType: failed.mimeType },
            });
            return { ...afterSpawn(context), failed: null };
          }),
        },
        DISCARD: { actions: assign({ failed: null }) },
        'xstate.done.actor.*': [
          {
            guard: ({ event }) => outcomeOf(event).ok,
            actions: [
              emitSettledTranscript,
              assign(({ context, event }) => settleDelta(context, event)),
            ],
          },
          {
            // A vad-time failure parks the utterance for Retry/Discard while
            // the session keeps listening — we never leave vad on a
            // transcription error. A later failure overwrites the slot.
            actions: assign(({ context, event }) => ({
              ...settleDelta(context, event),
              failed: failedFrom(event),
            })),
          },
        ],
      },
    },
    // Capture is over, transcription actors are still in flight — the UI shows
    // "Transcribing…". Kept in lock-step with drainingVad below.
    // XState's setup-bound type inference does not survive sharing handler config between states, hence duplication.
    drainingPtt: {
      on: {
        // The PTT capture delivers its single utterance only after stopPtt():
        // it arrives here and spawns the transcription.
        SPEECH_END: {
          actions: assign(({ context, event, spawn }) => {
            spawn('transcribe', {
              id: `transcribe-${context.seq}`,
              input: { deps: context.deps, blob: event.blob, mimeType: event.mimeType },
            });
            return afterSpawn(context);
          }),
        },
        'xstate.done.actor.*': [
          {
            // The last settlement succeeded but an earlier failure is still
            // parked — its utterance still wants its Retry: settle in
            // `failed`, never idle (idle's entry clears the slot silently).
            guard: ({ context, event }) =>
              outcomeOf(event).ok && context.pending <= 1 && context.failed !== null,
            target: 'failed',
            actions: [
              emitSettledTranscript,
              assign(({ context, event }) => settleDelta(context, event)),
            ],
          },
          {
            // The last in-flight transcription finished — the drain is complete.
            guard: ({ context, event }) => outcomeOf(event).ok && context.pending <= 1,
            target: 'idle',
            actions: [
              emitSettledTranscript,
              assign(({ context, event }) => settleDelta(context, event)),
            ],
          },
          {
            guard: ({ event }) => outcomeOf(event).ok,
            actions: [
              emitSettledTranscript,
              assign(({ context, event }) => settleDelta(context, event)),
            ],
          },
          {
            target: 'failed',
            actions: assign(({ context, event }) => ({
              ...settleDelta(context, event),
              failed: failedFrom(event),
            })),
          },
        ],
        // A failure parked before the drain began (vad → draining with a full
        // `failed` slot) keeps its Retry/Discard surface while the drain runs
        // — same semantics as vad's handlers: RETRY respawns from the parked
        // utterance, DISCARD clears it.
        RETRY: {
          guard: ({ context }) => context.failed !== null,
          actions: assign(({ context, spawn }) => {
            const failed = context.failed;
            if (failed === null) return {};
            spawn('transcribe', {
              id: `transcribe-${context.seq}`,
              input: { deps: context.deps, blob: failed.blob, mimeType: failed.mimeType },
            });
            return { ...afterSpawn(context), failed: null };
          }),
        },
        DISCARD: { actions: assign({ failed: null }) },
        // Abandon the drain: idle's entry stops every in-flight actor, so the
        // aborted uploads never emit.
        CANCEL: { target: 'idle' },
      },
    },
    drainingVad: {
      // Lock-step twin of drainingPtt — INCLUDING SPEECH_END. The capture
      // layer defers a VAD utterance to the MediaRecorder's async 'stop'
      // event, so an utterance whose speech-end fired just before the user
      // tapped can land AFTER the vad → drainingVad transition (deferred
      // recorder finalise vs tap race). Without this handler it would be
      // silently dropped.
      on: {
        SPEECH_END: {
          actions: assign(({ context, event, spawn }) => {
            spawn('transcribe', {
              id: `transcribe-${context.seq}`,
              input: { deps: context.deps, blob: event.blob, mimeType: event.mimeType },
            });
            return afterSpawn(context);
          }),
        },
        'xstate.done.actor.*': [
          {
            // Parked failure outlives a successful final settlement — see drainingPtt.
            guard: ({ context, event }) =>
              outcomeOf(event).ok && context.pending <= 1 && context.failed !== null,
            target: 'failed',
            actions: [
              emitSettledTranscript,
              assign(({ context, event }) => settleDelta(context, event)),
            ],
          },
          {
            guard: ({ context, event }) => outcomeOf(event).ok && context.pending <= 1,
            target: 'idle',
            actions: [
              emitSettledTranscript,
              assign(({ context, event }) => settleDelta(context, event)),
            ],
          },
          {
            guard: ({ event }) => outcomeOf(event).ok,
            actions: [
              emitSettledTranscript,
              assign(({ context, event }) => settleDelta(context, event)),
            ],
          },
          {
            target: 'failed',
            actions: assign(({ context, event }) => ({
              ...settleDelta(context, event),
              failed: failedFrom(event),
            })),
          },
        ],
        // Retry/Discard for a failure parked before the drain — see drainingPtt.
        RETRY: {
          guard: ({ context }) => context.failed !== null,
          actions: assign(({ context, spawn }) => {
            const failed = context.failed;
            if (failed === null) return {};
            spawn('transcribe', {
              id: `transcribe-${context.seq}`,
              input: { deps: context.deps, blob: failed.blob, mimeType: failed.mimeType },
            });
            return { ...afterSpawn(context), failed: null };
          }),
        },
        DISCARD: { actions: assign({ failed: null }) },
        CANCEL: { target: 'idle' },
      },
    },
    // The Retry/Discard surface for a PTT or drain-time failure.
    failed: {
      on: {
        // drainingPtt covers PTT and both drain-time failures alike: a retry is always a single-utterance drain.
        RETRY: {
          guard: ({ context }) => context.failed !== null,
          target: 'drainingPtt',
          actions: assign(({ context, spawn }) => {
            const failed = context.failed;
            if (failed === null) return {};
            spawn('transcribe', {
              id: `transcribe-${context.seq}`,
              input: { deps: context.deps, blob: failed.blob, mimeType: failed.mimeType },
            });
            return { ...afterSpawn(context), failed: null };
          }),
        },
        // idle's entry clears the parked utterance.
        DISCARD: { target: 'idle' },
        // The morphed button's X must mean what it shows: in failed, Cancel = Discard.
        CANCEL: {
          target: 'idle',
          actions: assign({ failed: null }),
        },
        // Other drain-time actors may still settle while the Retry/Discard
        // surface is up: emit successes, let a later failure overwrite the slot.
        'xstate.done.actor.*': [
          {
            guard: ({ event }) => outcomeOf(event).ok,
            actions: [
              emitSettledTranscript,
              assign(({ context, event }) => settleDelta(context, event)),
            ],
          },
          {
            actions: assign(({ context, event }) => ({
              ...settleDelta(context, event),
              failed: failedFrom(event),
            })),
          },
        ],
      },
    },
  },
});

export type DictationSnapshot = SnapshotFrom<typeof dictationMachine>;

/** Coarse UI state for the dictation button. */
export type DictationUiState = 'idle' | 'capturing' | 'transcribing';

/** UI button state. The failed state maps to 'transcribing': the Retry/Discard note lives within the transcribing affordance. */
export function selectDictationUiState(snapshot: DictationSnapshot): DictationUiState {
  if (snapshot.matches('ptt') || snapshot.matches('vad')) return 'capturing';
  if (
    snapshot.matches('drainingPtt') ||
    snapshot.matches('drainingVad') ||
    snapshot.matches('failed')
  ) {
    return 'transcribing';
  }
  return 'idle';
}

/** The utterance awaiting Retry/Discard — set by both the failed state and a vad-time failure. */
export function selectFailed(snapshot: DictationSnapshot): FailedUtterance | null {
  return snapshot.context.failed;
}

/** The capture-start failure reason, kept until the next press. */
export function selectCaptureError(snapshot: DictationSnapshot): CaptureErrorReason | null {
  return snapshot.context.captureError;
}
