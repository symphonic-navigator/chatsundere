// SPDX-License-Identifier: AGPL-3.0-only
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mocks (declared before importing the hook under test) ----

interface MockAudio {
  pcm: Float32Array;
  blob: Blob;
  mimeType: string;
  sampleRate: number;
  durationMs: number;
}

interface MockCallbacks {
  onSpeechStart: () => void;
  onSpeechEnd: (audio: MockAudio) => void;
  onVolumeChange: (level: number) => void;
  onMisfire?: () => void;
}

function makeAudio(content: string): MockAudio {
  return {
    pcm: new Float32Array(0),
    blob: new Blob([content], { type: 'audio/webm' }),
    mimeType: 'audio/webm',
    sampleRate: 0,
    durationMs: 1_000,
  };
}

let pttCallbacks: MockCallbacks | null = null;
let vadCallbacks: MockCallbacks | null = null;

const startPTTMock = vi.fn(async (cb: MockCallbacks): Promise<void> => {
  pttCallbacks = cb;
});
// Mirrors the real singleton's WAV-fallback shape: stopPTT ALWAYS delivers
// exactly one utterance, SYNCHRONOUSLY — i.e. inside the machine's own
// PRESS_END/PRESS_CANCEL transition action. This is the delivery the
// scratch-suppression and sync-delivery contracts are about.
const stopPTTMock = vi.fn((): void => {
  const cb = pttCallbacks;
  pttCallbacks = null;
  cb?.onSpeechEnd(makeAudio('ptt-utterance'));
});
const startContinuousMock = vi.fn(async (cb: MockCallbacks, _opts: unknown): Promise<void> => {
  vadCallbacks = cb;
});
const stopContinuousMock = vi.fn((): void => {
  vadCallbacks = null;
});
const hasInFlightUtteranceMock = vi.fn((): boolean => false);

vi.mock('../../../../src/lib/voice/dictation/capture.js', () => ({
  audioCapture: {
    startPTT: (cb: MockCallbacks) => startPTTMock(cb),
    stopPTT: () => stopPTTMock(),
    startContinuous: (cb: MockCallbacks, opts: unknown) => startContinuousMock(cb, opts),
    stopContinuous: () => stopContinuousMock(),
    hasInFlightUtterance: () => hasInFlightUtteranceMock(),
  },
}));

const transcribeMock = vi.fn(
  async (_blob: Blob, _mimeType: string, _signal: AbortSignal): Promise<string> => 'hi',
);
const resolveSttMock = vi.fn(async () => ({
  ok: true as const,
  transcribe: (blob: Blob, mimeType: string, signal: AbortSignal) =>
    transcribeMock(blob, mimeType, signal),
  sttLabel: 'Test STT via Mock',
}));
vi.mock('../../../../src/lib/voice/dictation/resolve-stt.js', () => ({
  resolveStt: () => resolveSttMock(),
}));

const settingsData: {
  dictationSensitivity: 'low' | 'medium' | 'high';
  dictationRedemptionMs: number;
  dictationAutoSend: boolean;
} = { dictationSensitivity: 'medium', dictationRedemptionMs: 1_728, dictationAutoSend: false };
vi.mock('../../../../src/data/settings.js', () => ({
  useSettings: () => ({ data: settingsData }),
}));

let providerRows: Array<{ templateId: string; enabled: boolean }> = [];
vi.mock('../../../../src/data/providers.js', () => ({
  useProviders: () => ({ data: providerRows }),
}));

vi.mock('@chatsundere/llm-unified', () => ({
  listSttOfferings: () => [{ providerId: 'mistral' }],
  // The dictation machine imports this class for instanceof status extraction.
  TranscriptionError: class TranscriptionError extends Error {
    constructor(
      message: string,
      readonly status: number | null,
    ) {
      super(message);
    }
  },
}));

import {
  type DictationArgs,
  useDictation,
} from '../../../../src/lib/voice/dictation/use-dictation.js';

function makeArgs() {
  return {
    onTranscript: vi.fn((_text: string) => {}),
    onSend: vi.fn((_text: string) => {}),
    isStreamLive: false,
    stopPlayback: vi.fn(() => {}),
    active: true,
  } satisfies DictationArgs;
}

// The hook measures heldMs via performance.now(); the tests drive the clock.
let nowMs = 0;

beforeEach(() => {
  nowMs = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  pttCallbacks = null;
  vadCallbacks = null;
  providerRows = [{ templateId: 'mistral', enabled: true }];
  settingsData.dictationAutoSend = false;
  // mockReset clears call history AND any leftover once-implementations
  // (vitest 2 also drops the original impl, so each is re-applied below).
  startPTTMock.mockReset().mockImplementation(async (cb: MockCallbacks) => {
    pttCallbacks = cb;
  });
  stopPTTMock.mockReset().mockImplementation(() => {
    const cb = pttCallbacks;
    pttCallbacks = null;
    cb?.onSpeechEnd(makeAudio('ptt-utterance'));
  });
  startContinuousMock.mockReset().mockImplementation(async (cb: MockCallbacks) => {
    vadCallbacks = cb;
  });
  stopContinuousMock.mockReset().mockImplementation(() => {
    vadCallbacks = null;
  });
  hasInFlightUtteranceMock.mockReset().mockImplementation(() => false);
  transcribeMock.mockReset().mockResolvedValue('hi');
  resolveSttMock.mockReset().mockImplementation(async () => ({
    ok: true as const,
    transcribe: (blob: Blob, mimeType: string, signal: AbortSignal) =>
      transcribeMock(blob, mimeType, signal),
    sttLabel: 'Test STT via Mock',
  }));
});

type HookResult = { current: ReturnType<typeof useDictation> };

/** pressStart and flush the lazy STT resolution so PRESS_START lands. */
async function startPress(result: HookResult): Promise<void> {
  await act(async () => {
    result.current.pressStart();
    await Promise.resolve();
  });
}

/** Release the press after advancing the mocked clock by holdMs. */
async function releasePress(result: HookResult, holdMs: number): Promise<void> {
  nowMs += holdMs;
  await act(async () => {
    result.current.pressEnd();
  });
}

describe('useDictation', () => {
  it('is unavailable without an enabled provider row and pressStart is a no-op', async () => {
    providerRows = [{ templateId: 'mistral', enabled: false }];
    const args = makeArgs();
    const { result } = renderHook(() => useDictation(args));

    expect(result.current.available).toBe(false);

    await startPress(result);

    expect(resolveSttMock).not.toHaveBeenCalled();
    expect(startPTTMock).not.toHaveBeenCalled();
    expect(args.stopPlayback).not.toHaveBeenCalled();
    expect(result.current.uiState).toBe('idle');
  });

  it('stops read-aloud playback BEFORE capture starts', async () => {
    const args = makeArgs();
    const { result } = renderHook(() => useDictation(args));

    await startPress(result);

    await waitFor(() => expect(startPTTMock).toHaveBeenCalledTimes(1));
    expect(args.stopPlayback).toHaveBeenCalledTimes(1);
    const stopOrder = args.stopPlayback.mock.invocationCallOrder[0] ?? Number.NaN;
    const startOrder = startPTTMock.mock.invocationCallOrder[0] ?? Number.NaN;
    expect(stopOrder).toBeLessThan(startOrder);
  });

  it('runs the full PTT flow: capturing → transcribing → onTranscript → idle', async () => {
    // Gate the transcription so the transcribing state is observable.
    let release: (text: string) => void = () => {};
    transcribeMock.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );

    const args = makeArgs();
    const { result } = renderHook(() => useDictation(args));
    expect(result.current.available).toBe(true);

    await startPress(result);
    await waitFor(() => expect(result.current.uiState).toBe('capturing'));
    expect(startPTTMock).toHaveBeenCalledTimes(1);

    await releasePress(result, 500); // a genuine hold
    // stopPTT delivered the utterance synchronously; the hold intent
    // forwarded it into a transcription.
    expect(stopPTTMock).toHaveBeenCalledTimes(1);
    expect(transcribeMock).toHaveBeenCalledTimes(1);
    expect(result.current.uiState).toBe('transcribing');

    await act(async () => {
      release('hi');
    });
    await waitFor(() => expect(args.onTranscript).toHaveBeenCalledWith('hi'));
    expect(args.onSend).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.uiState).toBe('idle'));
  });

  it('suppresses the tap scratch utterance and opens a VAD session', async () => {
    const args = makeArgs();
    const { result } = renderHook(() => useDictation(args));

    await startPress(result);
    await waitFor(() => expect(result.current.uiState).toBe('capturing'));

    await releasePress(result, 100); // a tap

    // The scratch delivery from stopPTT was NOT forwarded for transcription…
    expect(stopPTTMock).toHaveBeenCalledTimes(1);
    expect(transcribeMock).not.toHaveBeenCalled();
    // …and a VAD session began instead.
    await waitFor(() => expect(startContinuousMock).toHaveBeenCalledTimes(1));
    expect(startContinuousMock).toHaveBeenCalledWith(expect.anything(), {
      sensitivity: 'medium',
      redemptionMs: 1_728,
    });
    expect(result.current.uiState).toBe('capturing');
  });

  it('auto-send routes to onSend, but to onTranscript while a stream is live', async () => {
    settingsData.dictationAutoSend = true;
    const onTranscript = vi.fn((_text: string) => {});
    const onSend = vi.fn((_text: string) => {});
    const { result, rerender } = renderHook(
      ({ live }: { live: boolean }) =>
        useDictation({
          onTranscript,
          onSend,
          isStreamLive: live,
          stopPlayback: vi.fn(),
          active: true,
        }),
      { initialProps: { live: false } },
    );

    await startPress(result);
    await releasePress(result, 500);
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('hi'));
    expect(onTranscript).not.toHaveBeenCalled();

    // Same hold while a persona reply streams → falls back to the draft.
    rerender({ live: true });
    await startPress(result);
    await releasePress(result, 500);
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('hi'));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('classifies a NotAllowedError capture rejection as a permission error', async () => {
    startPTTMock.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    const args = makeArgs();
    const { result } = renderHook(() => useDictation(args));

    await startPress(result);

    await waitFor(() => expect(result.current.captureError).toBe('permission'));
    expect(result.current.uiState).toBe('idle');
    // The half-started singleton was cleaned up.
    expect(stopPTTMock).toHaveBeenCalledTimes(1);
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it('drops an empty transcript silently and still settles to idle', async () => {
    transcribeMock.mockResolvedValueOnce('');
    const args = makeArgs();
    const { result } = renderHook(() => useDictation(args));

    await startPress(result);
    await releasePress(result, 500);

    // The empty utterance WAS forwarded (the drain settles)…
    expect(transcribeMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.uiState).toBe('idle'));
    // …but its empty transcript reached neither surface.
    expect(args.onTranscript).not.toHaveBeenCalled();
    expect(args.onSend).not.toHaveBeenCalled();
  });

  it('stops an active VAD session on unmount (LEAVE)', async () => {
    const args = makeArgs();
    const { result, unmount } = renderHook(() => useDictation(args));

    await startPress(result);
    await releasePress(result, 100); // tap → VAD session
    await waitFor(() => expect(startContinuousMock).toHaveBeenCalledTimes(1));

    unmount();

    expect(stopContinuousMock).toHaveBeenCalledTimes(1);
  });

  it('LEAVEs when active flips false mid-VAD-session — no hot mic behind a collapsed cockpit', async () => {
    const onTranscript = vi.fn((_text: string) => {});
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useDictation({
          onTranscript,
          onSend: vi.fn(),
          isStreamLive: false,
          stopPlayback: vi.fn(),
          active,
        }),
      { initialProps: { active: true } },
    );

    await startPress(result);
    await releasePress(result, 100); // tap → VAD session
    await waitFor(() => expect(startContinuousMock).toHaveBeenCalledTimes(1));
    expect(result.current.uiState).toBe('capturing');

    // Interaction Mode collapses (outside tap while unpinned / ToC jump).
    rerender({ active: false });

    expect(stopContinuousMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.uiState).toBe('idle'));
  });

  it("the starting gesture's synthetic click does not stop the fresh VAD session", async () => {
    const args = makeArgs();
    const { result } = renderHook(() => useDictation(args));

    await startPress(result);
    await releasePress(result, 100); // tap → VAD session
    await waitFor(() => expect(startContinuousMock).toHaveBeenCalledTimes(1));

    // The browser's click after pointerdown+pointerup lands on the morphed
    // capture button's onClick — it must be suppressed, not treated as TAP.
    await act(async () => {
      result.current.tap();
    });
    expect(stopContinuousMock).not.toHaveBeenCalled();
    expect(result.current.uiState).toBe('capturing');

    // A genuine later stop-tap: its pointerup hits pressEnd's no-press guard
    // (arming nothing), so its click passes through and stops the session.
    await act(async () => {
      result.current.pressEnd();
      result.current.tap();
    });
    expect(stopContinuousMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.uiState).toBe('idle'));
  });

  it('wires hasInFlightUtterance to the capture singleton: a stop-tap mid-utterance drains', async () => {
    const args = makeArgs();
    const { result } = renderHook(() => useDictation(args));

    await startPress(result);
    await releasePress(result, 100); // tap → VAD session
    await waitFor(() => expect(startContinuousMock).toHaveBeenCalledTimes(1));
    const cb = vadCallbacks; // snapshot before stopContinuous nulls it

    // Consume the starting gesture's synthetic click so the genuine
    // stop-tap below reaches the machine.
    await act(async () => {
      result.current.tap();
    });

    // The capture layer reports an in-flight segment (speech started,
    // redemption window not yet elapsed) at stop-tap time.
    hasInFlightUtteranceMock.mockImplementation(() => true);
    await act(async () => {
      result.current.pressEnd(); // no-press guard — arms nothing
      result.current.tap();
    });

    // The machine consulted the capture singleton and drained instead of idling.
    expect(hasInFlightUtteranceMock).toHaveBeenCalled();
    expect(stopContinuousMock).toHaveBeenCalledTimes(1);
    expect(result.current.uiState).toBe('transcribing');

    // The flush delivery (deferred behind the recorder's 'stop') settles the drain.
    await act(async () => {
      cb?.onSpeechEnd(makeAudio('flushed-utterance'));
    });
    await waitFor(() => expect(args.onTranscript).toHaveBeenCalledWith('hi'));
    await waitFor(() => expect(result.current.uiState).toBe('idle'));
  });

  it("the PTT release's synthetic click does not cancel the just-spawned transcription", async () => {
    let release: (text: string) => void = () => {};
    transcribeMock.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const args = makeArgs();
    const { result } = renderHook(() => useDictation(args));

    await startPress(result);
    await releasePress(result, 500); // hold → drainingPtt
    expect(result.current.uiState).toBe('transcribing');

    // The release's click lands on the morphed cancel-transcribe button.
    await act(async () => {
      result.current.cancel();
    });
    expect(result.current.uiState).toBe('transcribing'); // NOT aborted

    await act(async () => {
      release('hi');
    });
    await waitFor(() => expect(args.onTranscript).toHaveBeenCalledWith('hi'));
    await waitFor(() => expect(result.current.uiState).toBe('idle'));
  });

  it('the touch-order pointerleave AFTER pointerup does not discard the async PTT delivery', async () => {
    // The real MediaRecorder delivers asynchronously: defer stopPTT's
    // delivery so the pointerleave (which touch devices fire right after
    // every pointerup) runs BETWEEN release and delivery.
    let deliver: () => void = () => {};
    stopPTTMock.mockImplementation(() => {
      const cb = pttCallbacks;
      pttCallbacks = null;
      deliver = () => cb?.onSpeechEnd(makeAudio('ptt-utterance'));
    });
    const args = makeArgs();
    const { result } = renderHook(() => useDictation(args));

    await startPress(result);
    await releasePress(result, 500); // pointerup fixes the 'drain' intent
    await act(async () => {
      result.current.pressCancel(); // touch-order pointerleave — must be a no-op
      deliver();
    });

    expect(transcribeMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(args.onTranscript).toHaveBeenCalledWith('hi'));
    await waitFor(() => expect(result.current.uiState).toBe('idle'));
  });
});
