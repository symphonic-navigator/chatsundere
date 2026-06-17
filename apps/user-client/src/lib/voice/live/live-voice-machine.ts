// SPDX-License-Identifier: AGPL-3.0-only
import { type SnapshotFrom, assign, fromPromise, setup } from 'xstate';
import { mergePcm } from './merge-pcm.js';

/**
 * The live-voice orchestrator (Spec 3). A floor state-chart: at any moment the
 * floor is the USER's (mic open, VAD listening) or the PERSONA's (mic closed,
 * reading aloud). It owns the floor and the microphone lifecycle; it delegates
 * capture, transcription, send, and playback to injected deps, mirroring the
 * DI discipline of voice-machine.ts / dictation-machine.ts.
 */
export interface LiveVoiceDeps {
  /** Arm continuous VAD capture (the hook wires capture callbacks → machine events). */
  startCapture: () => void;
  /** Tear down VAD capture (mic closes). */
  stopCapture: () => void;
  /** Transcribe a finished utterance. Must respect the signal. */
  transcribe: (
    pcm: Float32Array,
    blob: Blob,
    mimeType: string,
    signal: AbortSignal,
  ) => Promise<string>;
  /** Send a transcribed turn to the persona. */
  sendMessage: (text: string) => void;
  /**
   * Abort the in-flight reply generation for this turn (floor-reclaim / barge).
   * The partial reply is preserved in the chat; a no-op once generation has
   * already finished. Distinct from {@link stopPlayback}, which only silences
   * TTS — a barge means "I don't want this answer", so the stream stops too.
   */
  abortReply: () => void;
  /** Stop read-aloud (barge / floor-reclaim / exit). */
  stopPlayback: () => void;
  /** Freeze read-aloud in place without discarding progress (Hold gate). */
  pausePlayback: () => void;
  /** Resume a paused read-aloud from where it was frozen (Resume from Hold gate). */
  resumePlayback: () => void;
}

export type LiveVoiceEvent =
  | { type: 'ENTER' }
  | { type: 'EXIT' }
  | { type: 'HOLD' } // unified pause
  | { type: 'RESUME' }
  | { type: 'SPEECH_START' }
  | { type: 'SPEECH_END'; pcm: Float32Array; blob: Blob; mimeType: string }
  | { type: 'MISFIRE' }
  | { type: 'PROGRESS'; fraction: number } // redemption fill 0..1
  | { type: 'PRESS_START' } // thumb down on the big button
  | { type: 'PRESS_END'; heldMs: number } // thumb up
  | { type: 'TAP' } // a short press resolved by the hook
  | { type: 'CANCEL' } // cancel the in-flight transcription
  | { type: 'BARGE' } // reclaim the floor from the persona
  | { type: 'PLAYBACK_STARTED' } // the reply began reading aloud (first segment audio)
  | { type: 'PLAYBACK_DONE' }
  | { type: 'PLAYBACK_FAILED' }
  | { type: 'STT_FAILED' };

export interface LiveVoiceContext {
  deps: LiveVoiceDeps;
  /** The redemption fill, surfaced to the button while the user's floor is silent. */
  fillFraction: number;
  /** PCM chunks buffered while the thumb holds the button (hold-to-keep-talking). */
  heldPcm: Float32Array[];
  /** True while the big button is physically held. */
  holding: boolean;
  /** The container blob of the utterance being transcribed (PCM is in heldPcm). */
  _utterance: { blob: Blob; mimeType: string } | null;
  /**
   * True when HOLD was pressed while the persona had the floor
   * (personaThinking or personaSpeaking). RESUME returns to personaSpeaking
   * so frozen playback can continue; false means return to listening.
   */
  heldFromPersona: boolean;
}

export interface LiveVoiceInput {
  deps: LiveVoiceDeps;
}

/** Coarse floor state for the UI (one row per Spec §4). */
export type Floor =
  | 'idle'
  | 'listening'
  | 'userSpeaking'
  | 'transcribing'
  | 'personaThinking'
  | 'personaSpeaking'
  | 'held'
  | 'sttFailed';

const transcribe = fromPromise<
  string,
  { deps: LiveVoiceDeps; pcm: Float32Array; blob: Blob; mimeType: string }
>(async ({ input, signal }) => {
  return input.deps.transcribe(input.pcm, input.blob, input.mimeType, signal);
});

export const liveVoiceMachine = setup({
  types: {
    context: {} as LiveVoiceContext,
    events: {} as LiveVoiceEvent,
    input: {} as LiveVoiceInput,
  },
  actors: { transcribe },
}).createMachine({
  id: 'liveVoice',
  context: ({ input }) => ({
    deps: input.deps,
    fillFraction: 0,
    heldPcm: [],
    holding: false,
    _utterance: null,
    heldFromPersona: false,
  }),
  initial: 'idle',
  states: {
    idle: {
      on: { ENTER: { target: 'listening' } },
    },
    listening: {
      // Mic is armed on entry to the whole live session; closed on EXIT.
      entry: ({ context }) => context.deps.startCapture(),
      on: {
        EXIT: { target: 'idle', actions: ({ context }) => context.deps.stopCapture() },
        SPEECH_START: { target: 'userSpeaking' },
        HOLD: { target: 'held', actions: assign({ heldFromPersona: false }) },
        PRESS_START: { actions: assign({ holding: true, fillFraction: 0 }) },
        // Release while on the listening floor: if segments were buffered during a
        // hold-to-keep-talking session, transcribe the merged buffer now.
        PRESS_END: [
          {
            guard: ({ context }) => context.heldPcm.length > 0,
            target: 'transcribing',
            actions: assign({
              holding: false,
              _utterance: () => ({ blob: new Blob(), mimeType: 'audio/wav' }),
            }),
          },
          { actions: assign({ holding: false }) },
        ],
      },
    },
    userSpeaking: {
      on: {
        EXIT: { target: 'idle', actions: ({ context }) => context.deps.stopCapture() },
        // Pin the fill at 0 while holding; otherwise reflect the countdown.
        PROGRESS: {
          actions: assign({
            fillFraction: ({ context, event }) => (context.holding ? 0 : event.fraction),
          }),
        },
        MISFIRE: { target: 'listening', actions: assign({ fillFraction: 0 }) },
        HOLD: { target: 'held', actions: assign({ heldFromPersona: false }) },
        PRESS_START: { actions: assign({ holding: true, fillFraction: 0 }) },
        PRESS_END: { actions: assign({ holding: false }) },
        SPEECH_END: [
          {
            // Holding: buffer the PCM chunk and stay on the user floor (return to
            // listening so VAD continues arming the next segment).
            guard: ({ context }) => context.holding,
            target: 'listening',
            actions: assign({
              fillFraction: 0,
              heldPcm: ({ context, event }) => [...context.heldPcm, event.pcm],
            }),
          },
          {
            // Not holding: transcribe immediately.
            target: 'transcribing',
            actions: assign({
              fillFraction: 0,
              heldPcm: ({ context, event }) => [...context.heldPcm, event.pcm],
              _utterance: ({ event }) => ({ blob: event.blob, mimeType: event.mimeType }),
            }),
          },
        ],
      },
    },
    transcribing: {
      // Close the mic as soon as the floor leaves the user — the machine will
      // re-arm it (via listening.entry) when the persona returns the floor.
      entry: ({ context }) => context.deps.stopCapture(),
      invoke: {
        src: 'transcribe',
        input: ({ context }) => ({
          deps: context.deps,
          pcm: mergePcm(context.heldPcm),
          blob: context._utterance?.blob ?? new Blob(),
          mimeType: context._utterance?.mimeType ?? 'audio/wav',
        }),
        onDone: [
          {
            guard: ({ event }) => event.output.trim() === '',
            target: 'listening',
            actions: assign({ heldPcm: [] }),
          },
          {
            target: 'personaThinking',
            actions: [
              ({ context, event }) => context.deps.sendMessage(event.output),
              assign({ heldPcm: [] }),
            ],
          },
        ],
        onError: { target: 'sttFailed' },
      },
      on: {
        // CANCEL leaves the state, which aborts the transcribe actor's signal.
        CANCEL: { target: 'listening', actions: assign({ heldPcm: [] }) },
        EXIT: { target: 'idle', actions: ({ context }) => context.deps.stopCapture() },
      },
    },
    personaThinking: {
      // Awaiting the reply's first token/segment (spec §4). The machine does NOT
      // initiate playback here — the streaming read-aloud driver reads the reply
      // as it streams, and the hook bridges its first audio to PLAYBACK_STARTED
      // (→ personaSpeaking). Floor-reclaim via BARGE aborts the pending reply;
      // a reply with nothing speakable resolves via PLAYBACK_DONE from the hook.
      on: {
        PLAYBACK_STARTED: { target: 'personaSpeaking' },
        BARGE: {
          target: 'listening',
          actions: ({ context }) => {
            context.deps.abortReply();
            context.deps.stopPlayback();
          },
        },
        PLAYBACK_DONE: { target: 'listening' },
        PLAYBACK_FAILED: { target: 'listening' },
        HOLD: { target: 'held', actions: assign({ heldFromPersona: true }) },
        EXIT: {
          target: 'idle',
          // EXIT (leaving the mode) is NOT a barge: the reply is left to finish
          // streaming into the chat. Only playback and capture are torn down.
          actions: ({ context }) => {
            context.deps.stopPlayback();
            context.deps.stopCapture();
          },
        },
      },
    },
    personaSpeaking: {
      on: {
        BARGE: {
          target: 'listening',
          actions: ({ context }) => {
            context.deps.abortReply();
            context.deps.stopPlayback();
          },
        },
        PLAYBACK_DONE: { target: 'listening' },
        PLAYBACK_FAILED: { target: 'listening' },
        HOLD: { target: 'held', actions: assign({ heldFromPersona: true }) },
        EXIT: {
          target: 'idle',
          actions: ({ context }) => {
            context.deps.stopPlayback();
            context.deps.stopCapture();
          },
        },
      },
    },
    sttFailed: {
      on: {
        // Retry is the hook's job; the simplest recovery is to listen again.
        RESUME: { target: 'listening' },
        EXIT: { target: 'idle', actions: ({ context }) => context.deps.stopCapture() },
      },
    },
    held: {
      // Freeze everything: close the mic and pause (not stop) playback.
      entry: ({ context }) => {
        context.deps.stopCapture();
        context.deps.pausePlayback();
      },
      on: {
        // Resume returns to the floor that was active before Hold was pressed.
        RESUME: [
          {
            guard: ({ context }) => context.heldFromPersona,
            target: 'personaSpeaking',
            actions: ({ context }) => context.deps.resumePlayback(),
          },
          { target: 'listening' },
        ],
        // EXIT: playback was only frozen — end it before going idle.
        EXIT: {
          target: 'idle',
          actions: ({ context }) => context.deps.stopPlayback(),
        },
      },
    },
  },
});

export type LiveVoiceSnapshot = SnapshotFrom<typeof liveVoiceMachine>;

/** Coarse floor state for the UI. */
export function selectFloor(snapshot: LiveVoiceSnapshot): Floor {
  if (snapshot.matches('idle')) return 'idle';
  if (snapshot.matches('listening')) return 'listening';
  if (snapshot.matches('userSpeaking')) return 'userSpeaking';
  if (snapshot.matches('transcribing')) return 'transcribing';
  if (snapshot.matches('personaThinking')) return 'personaThinking';
  if (snapshot.matches('personaSpeaking')) return 'personaSpeaking';
  if (snapshot.matches('held')) return 'held';
  if (snapshot.matches('sttFailed')) return 'sttFailed';
  return 'idle';
}

/** The current redemption fill (0..1) for the big button. */
export function selectFill(snapshot: LiveVoiceSnapshot): number {
  return snapshot.context.fillFraction;
}
