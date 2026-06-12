// SPDX-License-Identifier: AGPL-3.0-only
import { type SnapshotFrom, and, assign, fromPromise, setup } from 'xstate';
import type { SpeechSegment } from './segmentation.js';

/**
 * The XState v5 voice-playback machine — the architectural heart of read-aloud
 * (Spec 1, ADR 0034). It is fully dependency-injected: it NEVER imports the
 * audio sink, the cache, or `llm-unified`. All side effects arrive via
 * {@link VoiceDeps} on `input.deps`; tests drive it with mocks and the React
 * hook (Task 7) wires the real implementations.
 *
 * Async work runs as `fromPromise` actors so that leaving the owning state
 * cancels it: XState aborts the actor's `AbortSignal` on exit, and we thread
 * that signal straight into `fetchAudio` / `play`, so fetch and playback abort
 * automatically with no manual `AbortController` bookkeeping.
 */
export interface VoiceDeps {
  /** Resolve the audio blob for a segment (cache hit or live synthesis). Must respect the signal. */
  fetchAudio: (segment: SpeechSegment, signal: AbortSignal) => Promise<Blob>;
  /**
   * Play a blob to completion (resolves on ended/abort, rejects on decode
   * failure). Receives the owning segment so a decode-failure retry can evict
   * and re-synthesise exactly that segment — never a concurrently-prefetched
   * one. Must respect the signal.
   */
  play: (blob: Blob, segment: SpeechSegment, signal: AbortSignal) => Promise<void>;
  /** Sample-accurate freeze / continue (AudioContext.suspend/resume). */
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  /** Hard-stop any current source (state-exit cleanup). */
  stop: () => void;
}

export type VoiceEvent =
  | { type: 'PLAY'; messageId: string; segments: SpeechSegment[]; startIndex: number }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'STOP' }
  | { type: 'RETRY' }
  | { type: 'SKIP' }
  | { type: 'DISMISS' }
  | { type: 'LEAVE_CHAT' };

export interface VoiceContext {
  deps: VoiceDeps;
  messageId: string | null;
  segments: SpeechSegment[];
  currentIndex: number;
  failedIndex: number | null;
  /** True when SKIP walked off the end from a failed final segment (transport shows the partial-finish note). */
  endedPartial: boolean;
  /**
   * Count of segments the provider DECLINED on content-moderation grounds
   * (deterministic 4xx, e.g. Mistral Voxtral's 403 on benign text — device
   * finding 2026-06-12). These auto-skip rather than halting, because Retry can
   * never heal them; the transport shows an honest note so the gap is never
   * silent. Reset on the next PLAY and on DISMISS, mirroring `endedPartial`.
   */
  providerSkips: number;
  prefetched: Map<number, Blob>;
}

export interface VoiceInput {
  deps: VoiceDeps;
}

/** Coarse UI state for the transport. */
export type TransportState = 'idle' | 'speaking' | 'paused' | 'failed' | 'ended-partial';

const playSegment = fromPromise<
  void,
  { deps: VoiceDeps; segment: SpeechSegment; index: number; prefetched: Map<number, Blob> }
>(async ({ input, signal }) => {
  const { deps, segment, index, prefetched } = input;
  const cached = prefetched.get(index);
  const blob = cached ?? (await deps.fetchAudio(segment, signal));
  await deps.play(blob, segment, signal);
});

const prefetchSegment = fromPromise<
  { index: number; blob: Blob } | null,
  {
    deps: VoiceDeps;
    segment: SpeechSegment | undefined;
    index: number;
    prefetched: Map<number, Blob>;
  }
>(async ({ input, signal }) => {
  // No look-ahead target (current segment is the final one) or the target is
  // already cached: resolve to null so the onDone assign is a no-op. The
  // out-of-bounds index is gated here rather than at invoke-time because the
  // actor is started unconditionally on every `speaking` (re-)entry.
  if (input.segment === undefined || input.prefetched.has(input.index)) return null;
  const blob = await input.deps.fetchAudio(input.segment, signal);
  return { index: input.index, blob };
});

/**
 * The voice-playback statechart. `active` is a parallel state with two
 * regions: `playback` (the speak-loop and its failure handling) and `gate`
 * (pause/resume freeze). Modelling the gate as its own region is what lets
 * PAUSE freeze playback WITHOUT cancelling the in-flight `playSegment` actor —
 * pausing merely calls `deps.pause()` (AudioContext.suspend), so the `play`
 * promise simply takes longer to resolve.
 *
 * The next-segment look-ahead is NOT a sibling region: `speaking` invokes BOTH
 * `playSegment(currentIndex)` and `prefetchSegment(currentIndex + 1)`. Because
 * the speak-loop advances by re-entering `speaking` (`reenter: true`), both
 * actors restart on every step, so the look-ahead re-arms automatically — a
 * sibling region would NOT have re-entered on a same-state self-transition.
 * Exiting `speaking` cancels any in-flight prefetch; worst case the next
 * `playSegment` fetches that segment live (a benign race), so prefetch errors
 * and cancellations are simply swallowed.
 */
export const voiceMachine = setup({
  types: {
    context: {} as VoiceContext,
    events: {} as VoiceEvent,
    input: {} as VoiceInput,
  },
  actors: { playSegment, prefetchSegment },
  guards: {
    hasNext: ({ context }) => context.currentIndex + 1 < context.segments.length,
    failedHasNext: ({ context }) =>
      context.failedIndex !== null && context.failedIndex + 1 < context.segments.length,
    // A deterministic content refusal (HTTP 4xx other than 429): Retry can never
    // heal it, so the read auto-skips past it. Duck-types `error.status` to keep
    // the machine free of the llm-unified import (the contract: SpeechSynthesisError
    // carries a numeric `status`). Network errors / decode failures carry no status
    // and fall through to the transient `failed` path (Retry stays meaningful).
    isContentRefusal: ({ event }) => {
      const status = (event as unknown as { error?: { status?: unknown } }).error?.status;
      return typeof status === 'number' && status >= 400 && status < 500 && status !== 429;
    },
  },
}).createMachine({
  id: 'voice',
  context: ({ input }) => ({
    deps: input.deps,
    messageId: null,
    segments: [],
    currentIndex: 0,
    failedIndex: null,
    endedPartial: false,
    providerSkips: 0,
    prefetched: new Map(),
  }),
  initial: 'idle',
  states: {
    idle: {
      // Entry clears transient playback context. endedPartial is deliberately
      // NOT cleared here: SKIP-off-the-end transitions INTO idle and needs the
      // flag to survive so the transport can show the partial-finish note. It
      // is cleared on the next PLAY instead.
      entry: assign({
        messageId: null,
        segments: [],
        currentIndex: 0,
        failedIndex: null,
        prefetched: () => new Map<number, Blob>(),
      }),
      on: {
        PLAY: {
          target: 'active',
          actions: assign(({ event }) => ({
            messageId: event.messageId,
            segments: event.segments,
            currentIndex: event.startIndex,
            failedIndex: null,
            endedPartial: false,
            providerSkips: 0,
            prefetched: new Map<number, Blob>(),
          })),
        },
        // Clear the partial-finish note in place: SKIP-off-the-end leaves us in
        // idle with endedPartial set, and the transport drives DISMISS to drop
        // the closing note without starting a new playback.
        DISMISS: { actions: assign({ endedPartial: false, providerSkips: 0 }) },
      },
    },
    active: {
      // STOP and LEAVE_CHAT both unwind to idle from any sub-state; the hard
      // source-stop runs as an exit action so it fires on every exit path
      // (STOP, LEAVE_CHAT, natural completion, and SKIP-off-the-end).
      exit: ({ context }) => context.deps.stop(),
      on: {
        // STOP / LEAVE_CHAT abandon the current read, so the skipped-passage note
        // is cleared too (Chris's call 2026-06-12) — it only describes a read the
        // user is still in. Natural completion and final-refusal keep the count so
        // the post-read note can show.
        STOP: { target: 'idle', actions: assign({ providerSkips: 0 }) },
        LEAVE_CHAT: { target: 'idle', actions: assign({ providerSkips: 0 }) },
      },
      type: 'parallel',
      states: {
        playback: {
          initial: 'speaking',
          states: {
            speaking: {
              invoke: [
                {
                  src: 'playSegment',
                  input: ({ context }) => ({
                    deps: context.deps,
                    // Safe: `speaking` is only ever entered with currentIndex
                    // pointing at a valid segment (PLAY sets startIndex in
                    // range; every advance is gated by `hasNext`).
                    segment: context.segments[context.currentIndex] as SpeechSegment,
                    index: context.currentIndex,
                    prefetched: context.prefetched,
                  }),
                  onDone: [
                    {
                      guard: 'hasNext',
                      target: 'speaking',
                      reenter: true,
                      actions: assign({ currentIndex: ({ context }) => context.currentIndex + 1 }),
                    },
                    // Final segment played to completion: natural end → idle.
                    { target: '#voice.idle' },
                  ],
                  onError: [
                    // Content refusal with a next segment → auto-skip and keep
                    // reading (Chris's call 2026-06-12). Counts the skip so the
                    // transport can show an honest note; never enters `failed`.
                    {
                      guard: and(['isContentRefusal', 'hasNext']),
                      target: 'speaking',
                      reenter: true,
                      actions: [
                        ({ context }) => {
                          const seg = context.segments[context.currentIndex];
                          console.warn(
                            '[voice] segment declined by provider — auto-skipped',
                            seg?.segmentId,
                          );
                        },
                        assign({
                          currentIndex: ({ context }) => context.currentIndex + 1,
                          providerSkips: ({ context }) => context.providerSkips + 1,
                          failedIndex: null,
                        }),
                      ],
                    },
                    // Content refusal on the FINAL segment → end cleanly. No
                    // futile Retry; just count it so the honest note still shows.
                    {
                      guard: 'isContentRefusal',
                      target: '#voice.idle',
                      actions: [
                        ({ context }) => {
                          const seg = context.segments[context.currentIndex];
                          console.warn(
                            '[voice] final segment declined by provider — ending read',
                            seg?.segmentId,
                          );
                        },
                        assign({ providerSkips: ({ context }) => context.providerSkips + 1 }),
                      ],
                    },
                    // Transient failure (429 / 5xx / network / twice-failed
                    // decode) → halt with Retry/Skip. Catch-all log so no failure
                    // is ever opaque; the resolve-tts boundary carries the detail.
                    {
                      target: 'failed',
                      actions: [
                        ({ context, event }) => {
                          const seg = context.segments[context.currentIndex];
                          console.error(
                            '[voice] segment playback failed',
                            seg?.segmentId,
                            (event as { error?: unknown }).error,
                          );
                        },
                        assign({ failedIndex: ({ context }) => context.currentIndex }),
                      ],
                    },
                  ],
                },
                {
                  // Next-segment look-ahead. Started on every (re-)entry of
                  // `speaking`, which is what re-arms the prefetch as the loop
                  // advances. The actor no-ops when there is no valid target or
                  // it is already cached. Errors and cancellation are swallowed;
                  // the segment resurfaces (and re-fetches) when actually played.
                  src: 'prefetchSegment',
                  input: ({ context }) => ({
                    deps: context.deps,
                    // May be undefined past the final segment; the actor guards
                    // for that rather than the input asserting in-range.
                    segment: context.segments[context.currentIndex + 1],
                    index: context.currentIndex + 1,
                    prefetched: context.prefetched,
                  }),
                  onDone: {
                    actions: assign({
                      prefetched: ({ context, event }) => {
                        if (event.output === null) return context.prefetched;
                        const next = new Map(context.prefetched);
                        next.set(event.output.index, event.output.blob);
                        return next;
                      },
                    }),
                  },
                  // Prefetch failure is non-fatal: leave the cache untouched.
                  onError: {},
                },
              ],
            },
            failed: {
              on: {
                RETRY: {
                  target: 'speaking',
                  reenter: true,
                  actions: assign({
                    currentIndex: ({ context }) => context.failedIndex ?? context.currentIndex,
                    failedIndex: null,
                  }),
                },
                SKIP: [
                  {
                    guard: 'failedHasNext',
                    target: 'speaking',
                    reenter: true,
                    actions: assign({
                      currentIndex: ({ context }) =>
                        (context.failedIndex ?? context.currentIndex) + 1,
                      failedIndex: null,
                    }),
                  },
                  // SKIP off the end of a failed final segment: partial finish.
                  {
                    target: '#voice.idle',
                    actions: assign({ endedPartial: true }),
                  },
                ],
              },
            },
          },
        },
        gate: {
          initial: 'running',
          states: {
            running: {
              on: { PAUSE: { target: 'frozen' } },
            },
            frozen: {
              // deps.pause() fires only when entering via PAUSE (the sole path
              // into this state), so it is correct here as an entry action.
              entry: ({ context }) => {
                void context.deps.pause();
              },
              // No exit action: deps.resume() must NOT fire on exit when the
              // parent `active` state is being torn down by STOP / LEAVE_CHAT.
              // XState v5 fires child exit actions before ancestor exit actions,
              // so a resume-then-stop sequence would cause an audible blip.
              // resume() is instead called only as a transition action on the
              // explicit frozen → running transition below.
              on: {
                RESUME: {
                  target: 'running',
                  actions: ({ context }) => {
                    void context.deps.resume();
                  },
                },
              },
            },
          },
        },
      },
    },
  },
});

export type VoiceSnapshot = SnapshotFrom<typeof voiceMachine>;

/** Count of segments the provider declined (auto-skipped) in the current/last read. */
export function selectProviderSkips(snapshot: VoiceSnapshot): number {
  return snapshot.context.providerSkips;
}

/** The segmentId currently being spoken, or null when not active. */
export function selectCurrentSegmentId(snapshot: VoiceSnapshot): string | null {
  if (!snapshot.matches('active')) return null;
  const { segments, currentIndex } = snapshot.context;
  return segments[currentIndex]?.segmentId ?? null;
}

/** Coarse UI state for the transport. */
export function selectTransportState(snapshot: VoiceSnapshot): TransportState {
  if (snapshot.matches('idle')) {
    return snapshot.context.endedPartial ? 'ended-partial' : 'idle';
  }
  // 'failed' is checked before 'paused': when the playSegment actor rejects
  // while the gate is frozen, both regions hold simultaneously. The playback
  // region takes precedence — the user must see (and act on) the failure, not
  // a misleading 'paused' indicator.
  if (snapshot.matches({ active: { playback: 'failed' } })) return 'failed';
  if (snapshot.matches({ active: { gate: 'frozen' } })) return 'paused';
  return 'speaking';
}
