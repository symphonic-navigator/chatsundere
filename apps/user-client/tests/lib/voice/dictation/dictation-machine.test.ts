// SPDX-License-Identifier: AGPL-3.0-only
import { TranscriptionError } from '@chatsundere/llm-unified';
import { describe, expect, it, vi } from 'vitest';
import { createActor, waitFor } from 'xstate';
import {
  type DictationDeps,
  TAP_MAX_MS,
  dictationMachine,
  selectCaptureError,
  selectDictationUiState,
  selectFailed,
} from '../../../../src/lib/voice/dictation/dictation-machine.js';

function makeDeps(overrides: Partial<DictationDeps> = {}): DictationDeps {
  return {
    startPtt: vi.fn(async () => {}),
    stopPtt: vi.fn(),
    startVad: vi.fn(async () => {}),
    stopVad: vi.fn(),
    hasInFlightUtterance: vi.fn(() => false),
    transcribe: vi.fn(async (_blob: Blob, _mimeType: string, _signal: AbortSignal) => 'transcript'),
    emitTranscript: vi.fn(),
    ...overrides,
  };
}

/** A promise plus its resolve/reject, for gating a mocked async dep. */
function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function start(deps: DictationDeps) {
  const actor = createActor(dictationMachine, { input: { deps } });
  actor.start();
  return actor;
}

/** Drive idle → vad via the tap path (a press shorter than TAP_MAX_MS). */
function startVadSession(actor: ReturnType<typeof start>): void {
  actor.send({ type: 'PRESS_START' });
  actor.send({ type: 'PRESS_END', heldMs: TAP_MAX_MS - 180 });
}

/** Let settled promises and the actor's microtask-driven events flush. */
function flushSettled(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('dictationMachine — push-to-talk', () => {
  it('hold: stopPtt, SPEECH_END spawns a transcription, transcript emitted, idle', async () => {
    const gate = deferred<string>();
    const transcribe = vi.fn(
      (_blob: Blob, _mimeType: string, _signal: AbortSignal) => gate.promise,
    );
    const deps = makeDeps({ transcribe });
    const actor = start(deps);

    actor.send({ type: 'PRESS_START' });
    expect(deps.startPtt).toHaveBeenCalledTimes(1);
    expect(selectDictationUiState(actor.getSnapshot())).toBe('capturing');

    actor.send({ type: 'PRESS_END', heldMs: 500 });
    expect(deps.stopPtt).toHaveBeenCalledTimes(1);
    expect(selectDictationUiState(actor.getSnapshot())).toBe('transcribing');

    actor.send({ type: 'SPEECH_END', blob: new Blob(['ptt']), mimeType: 'audio/webm' });
    await waitFor(actor, () => transcribe.mock.calls.length === 1);

    gate.resolve('hello');
    await waitFor(actor, (s) => s.matches('idle'));
    expect(deps.emitTranscript).toHaveBeenCalledTimes(1);
    expect(deps.emitTranscript).toHaveBeenCalledWith('hello');
  });

  it('tap (sub-300 ms) discards the scratch capture and starts a VAD session', () => {
    const deps = makeDeps();
    const actor = start(deps);

    actor.send({ type: 'PRESS_START' });
    actor.send({ type: 'PRESS_END', heldMs: TAP_MAX_MS - 180 });

    expect(deps.stopPtt).toHaveBeenCalledTimes(1);
    expect(deps.startVad).toHaveBeenCalledTimes(1);
    expect(deps.transcribe).not.toHaveBeenCalled();
    expect(selectDictationUiState(actor.getSnapshot())).toBe('capturing');
    expect(actor.getSnapshot().matches('vad')).toBe(true);
  });
});

describe('dictationMachine — VAD session', () => {
  it('emits transcripts in completion order and keeps listening', async () => {
    const resolvers: Array<(text: string) => void> = [];
    const transcribe = vi.fn(
      (_blob: Blob, _mimeType: string, _signal: AbortSignal) =>
        new Promise<string>((resolve) => resolvers.push(resolve)),
    );
    const emitTranscript = vi.fn();
    const deps = makeDeps({ transcribe, emitTranscript });
    const actor = start(deps);
    startVadSession(actor);

    actor.send({ type: 'SPEECH_END', blob: new Blob(['one']), mimeType: 'audio/webm' });
    actor.send({ type: 'SPEECH_END', blob: new Blob(['two']), mimeType: 'audio/webm' });
    await waitFor(actor, () => resolvers.length === 2);

    // Resolve the SECOND utterance first: emission follows completion order (spec §3.3).
    resolvers[1]?.('two');
    await waitFor(actor, () => emitTranscript.mock.calls.length === 1);
    resolvers[0]?.('one');
    await waitFor(actor, () => emitTranscript.mock.calls.length === 2);

    expect(emitTranscript.mock.calls.map((c) => c[0])).toEqual(['two', 'one']);
    expect(actor.getSnapshot().matches('vad')).toBe(true);
  });

  it('MISFIRE spawns nothing, sets no failure, stays in the session', () => {
    const deps = makeDeps();
    const actor = start(deps);
    startVadSession(actor);

    actor.send({ type: 'MISFIRE' });

    expect(deps.transcribe).not.toHaveBeenCalled();
    expect(selectFailed(actor.getSnapshot())).toBeNull();
    expect(actor.getSnapshot().matches('vad')).toBe(true);
  });

  it('a failed utterance parks in context while the session keeps listening; DISCARD clears it', async () => {
    const blob = new Blob(['bad']);
    const transcribe = vi.fn(async (_blob: Blob, _mimeType: string, _signal: AbortSignal) => {
      throw new Error('stt failed');
    });
    const deps = makeDeps({ transcribe });
    const actor = start(deps);
    startVadSession(actor);

    actor.send({ type: 'SPEECH_END', blob, mimeType: 'audio/webm' });
    await waitFor(actor, (s) => selectFailed(s) !== null);

    expect(actor.getSnapshot().matches('vad')).toBe(true);
    expect(selectFailed(actor.getSnapshot())?.blob).toBe(blob);

    actor.send({ type: 'DISCARD' });
    expect(selectFailed(actor.getSnapshot())).toBeNull();
    expect(actor.getSnapshot().matches('vad')).toBe(true);
  });

  it('TAP with no pending but a parked failure settles in failed — the Retry surface survives', async () => {
    const blob = new Blob(['bad']);
    const transcribe = vi.fn(async (_blob: Blob, _mimeType: string, _signal: AbortSignal) => {
      throw new Error('stt failed');
    });
    const deps = makeDeps({ transcribe });
    const actor = start(deps);
    startVadSession(actor);

    actor.send({ type: 'SPEECH_END', blob, mimeType: 'audio/webm' });
    await waitFor(actor, (s) => selectFailed(s) !== null);

    actor.send({ type: 'TAP' });
    expect(deps.stopVad).toHaveBeenCalledTimes(1);
    // Not idle: idle's entry would clear the parked utterance silently.
    expect(actor.getSnapshot().matches('failed')).toBe(true);
    expect(selectFailed(actor.getSnapshot())?.blob).toBe(blob);

    actor.send({ type: 'DISCARD' });
    await waitFor(actor, (s) => s.matches('idle'));
    expect(selectFailed(actor.getSnapshot())).toBeNull();
  });

  it('TAP with nothing pending but an in-flight utterance drains it (stop-tap flush, spec D16)', async () => {
    // THE device-found bug: the user stops right after speaking — Silero has
    // fired speech-start but the redemption window has not elapsed, so no
    // SPEECH_END was delivered yet and pending is 0. The capture layer
    // reports the in-flight segment; stopVad triggers its flush, whose
    // delivery lands AFTER the transition — in drainingVad.
    const gate = deferred<string>();
    const transcribe = vi.fn(
      (_blob: Blob, _mimeType: string, _signal: AbortSignal) => gate.promise,
    );
    const deps = makeDeps({ transcribe, hasInFlightUtterance: vi.fn(() => true) });
    const actor = start(deps);
    startVadSession(actor);
    expect(actor.getSnapshot().context.pending).toBe(0);

    actor.send({ type: 'TAP' });
    expect(deps.stopVad).toHaveBeenCalledTimes(1);
    expect(actor.getSnapshot().matches('drainingVad')).toBe(true);

    // The flush delivery from stopContinuous arrives after the transition.
    actor.send({ type: 'SPEECH_END', blob: new Blob(['flushed']), mimeType: 'audio/webm' });
    await waitFor(actor, () => transcribe.mock.calls.length === 1);

    gate.resolve('late words');
    await waitFor(actor, (s) => s.matches('idle'));
    expect(deps.emitTranscript).toHaveBeenCalledWith('late words');
  });

  it('TAP with nothing pending and nothing in flight goes straight to idle', () => {
    const deps = makeDeps();
    const actor = start(deps);
    startVadSession(actor);

    actor.send({ type: 'TAP' });

    expect(deps.stopVad).toHaveBeenCalledTimes(1);
    expect(actor.getSnapshot().matches('idle')).toBe(true);
    expect(deps.transcribe).not.toHaveBeenCalled();
  });

  it('TAP with a pending utterance drains, then idles when it resolves', async () => {
    const gate = deferred<string>();
    const transcribe = vi.fn(
      (_blob: Blob, _mimeType: string, _signal: AbortSignal) => gate.promise,
    );
    const deps = makeDeps({ transcribe });
    const actor = start(deps);
    startVadSession(actor);

    actor.send({ type: 'SPEECH_END', blob: new Blob(['x']), mimeType: 'audio/webm' });
    await waitFor(actor, () => transcribe.mock.calls.length === 1);

    actor.send({ type: 'TAP' });
    expect(deps.stopVad).toHaveBeenCalledTimes(1);
    expect(actor.getSnapshot().matches('drainingVad')).toBe(true);
    expect(selectDictationUiState(actor.getSnapshot())).toBe('transcribing');

    gate.resolve('drained');
    await waitFor(actor, (s) => s.matches('idle'));
    expect(deps.emitTranscript).toHaveBeenCalledWith('drained');
  });

  it('RETRY in vad respawns with the SAME blob and stays in the session', async () => {
    const blob = new Blob(['flaky']);
    let attempt = 0;
    const transcribe = vi.fn(async (_blob: Blob, _mimeType: string, _signal: AbortSignal) => {
      attempt += 1;
      if (attempt === 1) throw new Error('stt failed');
      return 'second time lucky';
    });
    const emitTranscript = vi.fn();
    const deps = makeDeps({ transcribe, emitTranscript });
    const actor = start(deps);
    startVadSession(actor);

    actor.send({ type: 'SPEECH_END', blob, mimeType: 'audio/webm' });
    await waitFor(actor, (s) => selectFailed(s) !== null);
    expect(actor.getSnapshot().matches('vad')).toBe(true);

    actor.send({ type: 'RETRY' });
    expect(actor.getSnapshot().matches('vad')).toBe(true);
    expect(actor.getSnapshot().context.pending).toBe(1);
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(transcribe.mock.calls[1]?.[0]).toBe(blob);

    await waitFor(actor, () => emitTranscript.mock.calls.length === 1);
    expect(emitTranscript).toHaveBeenCalledWith('second time lucky');
    expect(selectFailed(actor.getSnapshot())).toBeNull();
    expect(actor.getSnapshot().matches('vad')).toBe(true);
  });

  it('a late SPEECH_END arriving in drainingVad still gets transcribed (deferred recorder finalise vs tap race)', async () => {
    const resolvers: Array<(text: string) => void> = [];
    const transcribe = vi.fn(
      (_blob: Blob, _mimeType: string, _signal: AbortSignal) =>
        new Promise<string>((resolve) => resolvers.push(resolve)),
    );
    const emitTranscript = vi.fn();
    const deps = makeDeps({ transcribe, emitTranscript });
    const actor = start(deps);
    startVadSession(actor);

    actor.send({ type: 'SPEECH_END', blob: new Blob(['first']), mimeType: 'audio/webm' });
    await waitFor(actor, () => resolvers.length === 1);

    actor.send({ type: 'TAP' });
    expect(actor.getSnapshot().matches('drainingVad')).toBe(true);

    // The capture layer defers VAD delivery to the MediaRecorder's async
    // 'stop' event — this utterance's speech-end fired just before the tap.
    actor.send({ type: 'SPEECH_END', blob: new Blob(['late']), mimeType: 'audio/webm' });
    await waitFor(actor, () => resolvers.length === 2);
    expect(actor.getSnapshot().context.pending).toBe(2);

    resolvers[0]?.('first');
    await waitFor(actor, () => emitTranscript.mock.calls.length === 1);
    expect(actor.getSnapshot().matches('drainingVad')).toBe(true);

    resolvers[1]?.('late');
    await waitFor(actor, (s) => s.matches('idle'));
    expect(emitTranscript.mock.calls.map((c) => c[0])).toEqual(['first', 'late']);
  });

  it('drains multiple pending utterances one by one, idling only after the last', async () => {
    const resolvers: Array<(text: string) => void> = [];
    const transcribe = vi.fn(
      (_blob: Blob, _mimeType: string, _signal: AbortSignal) =>
        new Promise<string>((resolve) => resolvers.push(resolve)),
    );
    const emitTranscript = vi.fn();
    const deps = makeDeps({ transcribe, emitTranscript });
    const actor = start(deps);
    startVadSession(actor);

    actor.send({ type: 'SPEECH_END', blob: new Blob(['one']), mimeType: 'audio/webm' });
    actor.send({ type: 'SPEECH_END', blob: new Blob(['two']), mimeType: 'audio/webm' });
    await waitFor(actor, () => resolvers.length === 2);

    actor.send({ type: 'TAP' });
    expect(actor.getSnapshot().matches('drainingVad')).toBe(true);
    expect(actor.getSnapshot().context.pending).toBe(2);

    // First settlement: pending > 1, so the `pending <= 1` guard keeps us draining.
    resolvers[0]?.('one');
    await waitFor(actor, () => emitTranscript.mock.calls.length === 1);
    expect(actor.getSnapshot().matches('drainingVad')).toBe(true);
    expect(actor.getSnapshot().context.pending).toBe(1);

    resolvers[1]?.('two');
    await waitFor(actor, (s) => s.matches('idle'));
    expect(emitTranscript.mock.calls.map((c) => c[0])).toEqual(['one', 'two']);
  });

  it('CANCEL while draining aborts the in-flight transcription without emitting', async () => {
    const gate = deferred<string>();
    let captured: AbortSignal | null = null;
    const transcribe = vi.fn((_blob: Blob, _mimeType: string, signal: AbortSignal) => {
      captured = signal;
      return gate.promise;
    });
    const deps = makeDeps({ transcribe });
    const actor = start(deps);
    startVadSession(actor);

    actor.send({ type: 'SPEECH_END', blob: new Blob(['x']), mimeType: 'audio/webm' });
    await waitFor(actor, () => transcribe.mock.calls.length === 1);

    actor.send({ type: 'TAP' });
    expect(actor.getSnapshot().matches('drainingVad')).toBe(true);

    actor.send({ type: 'CANCEL' });
    await waitFor(actor, (s) => s.matches('idle'));

    if (captured === null) throw new Error('transcribe signal was not captured');
    const signal: AbortSignal = captured;
    expect(signal.aborted).toBe(true);

    gate.resolve('late');
    await flushSettled();
    expect(deps.emitTranscript).not.toHaveBeenCalled();
  });

  it('drain settling with a parked failure targets failed, not idle — the parked utterance keeps its Retry', async () => {
    const failBlob = new Blob(['bad']);
    const gate = deferred<string>();
    const transcribe = vi.fn((blob: Blob, _mimeType: string, _signal: AbortSignal) =>
      blob === failBlob ? Promise.reject(new Error('stt failed')) : gate.promise,
    );
    const deps = makeDeps({ transcribe });
    const actor = start(deps);
    startVadSession(actor);

    // One utterance still uploading, one failed and parked.
    actor.send({ type: 'SPEECH_END', blob: new Blob(['ok']), mimeType: 'audio/webm' });
    actor.send({ type: 'SPEECH_END', blob: failBlob, mimeType: 'audio/webm' });
    await waitFor(actor, (s) => selectFailed(s) !== null);

    actor.send({ type: 'TAP' });
    expect(actor.getSnapshot().matches('drainingVad')).toBe(true);

    // The last in-flight actor settles successfully — but the parked failure
    // still wants its Retry/Discard surface, so we land in failed, not idle.
    gate.resolve('drained');
    await waitFor(actor, (s) => s.matches('failed'));
    expect(deps.emitTranscript).toHaveBeenCalledWith('drained');
    expect(selectFailed(actor.getSnapshot())?.blob).toBe(failBlob);
  });

  it('RETRY while draining respawns the parked utterance with the SAME blob; DISCARD clears it', async () => {
    const failBlob = new Blob(['bad']);
    const gate = deferred<string>();
    let failedOnce = false;
    const transcribe = vi.fn((blob: Blob, _mimeType: string, _signal: AbortSignal) => {
      if (blob === failBlob && !failedOnce) {
        failedOnce = true;
        return Promise.reject(new Error('stt failed'));
      }
      return gate.promise;
    });
    const deps = makeDeps({ transcribe });
    const actor = start(deps);
    startVadSession(actor);

    actor.send({ type: 'SPEECH_END', blob: new Blob(['ok']), mimeType: 'audio/webm' });
    actor.send({ type: 'SPEECH_END', blob: failBlob, mimeType: 'audio/webm' });
    await waitFor(actor, (s) => selectFailed(s) !== null);

    actor.send({ type: 'TAP' });
    expect(actor.getSnapshot().matches('drainingVad')).toBe(true);

    actor.send({ type: 'RETRY' });
    expect(actor.getSnapshot().matches('drainingVad')).toBe(true);
    expect(selectFailed(actor.getSnapshot())).toBeNull();
    expect(actor.getSnapshot().context.pending).toBe(2);
    expect(transcribe.mock.calls[2]?.[0]).toBe(failBlob);

    // DISCARD with nothing parked is inert; both drains settle to idle.
    actor.send({ type: 'DISCARD' });
    gate.resolve('done');
    await waitFor(actor, (s) => s.matches('idle'));
  });
});

describe('dictationMachine — failure & retry (PTT)', () => {
  it('a PTT transcription failure lands in failed; RETRY reuses the SAME blob', async () => {
    const blob = new Blob(['ptt']);
    let attempt = 0;
    const transcribe = vi.fn(async (_blob: Blob, _mimeType: string, _signal: AbortSignal) => {
      attempt += 1;
      if (attempt === 1) throw new Error('stt failed');
      return 'recovered';
    });
    const deps = makeDeps({ transcribe });
    const actor = start(deps);

    actor.send({ type: 'PRESS_START' });
    actor.send({ type: 'PRESS_END', heldMs: 500 });
    actor.send({ type: 'SPEECH_END', blob, mimeType: 'audio/webm' });

    await waitFor(actor, (s) => s.matches('failed'));
    expect(selectDictationUiState(actor.getSnapshot())).toBe('transcribing');
    expect(selectFailed(actor.getSnapshot())?.blob).toBe(blob);

    actor.send({ type: 'RETRY' });
    await waitFor(actor, (s) => s.matches('idle'));

    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(transcribe.mock.calls[1]?.[0]).toBe(blob);
    expect(deps.emitTranscript).toHaveBeenCalledWith('recovered');
    expect(selectFailed(actor.getSnapshot())).toBeNull();
  });

  it('CANCEL in failed → idle, failed cleared, no emitTranscript', async () => {
    const blob = new Blob(['ptt']);
    const transcribe = vi.fn(async (_blob: Blob, _mimeType: string, _signal: AbortSignal) => {
      throw new Error('stt failed');
    });
    const deps = makeDeps({ transcribe });
    const actor = start(deps);

    actor.send({ type: 'PRESS_START' });
    actor.send({ type: 'PRESS_END', heldMs: 500 });
    actor.send({ type: 'SPEECH_END', blob, mimeType: 'audio/webm' });

    await waitFor(actor, (s) => s.matches('failed'));
    expect(selectFailed(actor.getSnapshot())?.blob).toBe(blob);

    actor.send({ type: 'CANCEL' });
    await waitFor(actor, (s) => s.matches('idle'));
    expect(selectFailed(actor.getSnapshot())).toBeNull();
    expect(deps.emitTranscript).not.toHaveBeenCalled();
  });

  it('CANCEL in drainingPtt aborts the in-flight transcription without emitting', async () => {
    const gate = deferred<string>();
    let captured: AbortSignal | null = null;
    const transcribe = vi.fn((_blob: Blob, _mimeType: string, signal: AbortSignal) => {
      captured = signal;
      return gate.promise;
    });
    const deps = makeDeps({ transcribe });
    const actor = start(deps);

    actor.send({ type: 'PRESS_START' });
    actor.send({ type: 'PRESS_END', heldMs: 500 });
    actor.send({ type: 'SPEECH_END', blob: new Blob(['ptt']), mimeType: 'audio/webm' });
    await waitFor(actor, () => transcribe.mock.calls.length === 1);
    expect(actor.getSnapshot().matches('drainingPtt')).toBe(true);

    actor.send({ type: 'CANCEL' });
    await waitFor(actor, (s) => s.matches('idle'));

    if (captured === null) throw new Error('transcribe signal was not captured');
    const signal: AbortSignal = captured;
    expect(signal.aborted).toBe(true);

    gate.resolve('late');
    await flushSettled();
    expect(deps.emitTranscript).not.toHaveBeenCalled();
  });
});

describe('dictationMachine — failure kind classification (spec §6)', () => {
  // Deterministic 4xx (bar 408/429) = the provider declined; all else transient.
  it.each([
    ['a 403 moderation refusal', new TranscriptionError('moderated', 403), 'refusal'],
    ['a 422 validation refusal', new TranscriptionError('unprocessable', 422), 'refusal'],
    ['a 408 timeout', new TranscriptionError('timeout', 408), 'transient'],
    ['a 429 rate-limit', new TranscriptionError('rate-limited', 429), 'transient'],
    ['a 500 server error', new TranscriptionError('server', 500), 'transient'],
    ['a status-less network error', new Error('fetch failed'), 'transient'],
  ])('classifies %s as %s', async (_label, error, kind) => {
    const transcribe = vi.fn(async (_blob: Blob, _mimeType: string, _signal: AbortSignal) => {
      throw error;
    });
    const deps = makeDeps({ transcribe });
    const actor = start(deps);

    actor.send({ type: 'PRESS_START' });
    actor.send({ type: 'PRESS_END', heldMs: 500 });
    actor.send({ type: 'SPEECH_END', blob: new Blob(['x']), mimeType: 'audio/webm' });

    await waitFor(actor, (s) => s.matches('failed'));
    expect(selectFailed(actor.getSnapshot())?.kind).toBe(kind);
  });
});

describe('dictationMachine — leave & capture errors', () => {
  it('LEAVE from vad stops capture, aborts pending actors, never emits late', async () => {
    const gate = deferred<string>();
    const transcribe = vi.fn(
      (_blob: Blob, _mimeType: string, _signal: AbortSignal) => gate.promise,
    );
    const deps = makeDeps({ transcribe });
    const actor = start(deps);
    startVadSession(actor);

    actor.send({ type: 'SPEECH_END', blob: new Blob(['x']), mimeType: 'audio/webm' });
    await waitFor(actor, () => transcribe.mock.calls.length === 1);

    actor.send({ type: 'LEAVE' });
    expect(deps.stopVad).toHaveBeenCalledTimes(1);
    expect(actor.getSnapshot().matches('idle')).toBe(true);

    gate.resolve('late');
    await flushSettled();
    expect(deps.emitTranscript).not.toHaveBeenCalled();
  });

  it('CAPTURE_ERROR during ptt idles with the reason; the next press clears it', () => {
    const deps = makeDeps();
    const actor = start(deps);

    actor.send({ type: 'PRESS_START' });
    actor.send({ type: 'CAPTURE_ERROR', reason: 'permission' });

    expect(actor.getSnapshot().matches('idle')).toBe(true);
    expect(selectCaptureError(actor.getSnapshot())).toBe('permission');

    actor.send({ type: 'PRESS_START' });
    expect(selectCaptureError(actor.getSnapshot())).toBeNull();
    expect(deps.startPtt).toHaveBeenCalledTimes(2);
  });
});
