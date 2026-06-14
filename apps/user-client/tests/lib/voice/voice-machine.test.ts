import { describe, expect, it, vi } from 'vitest';
// SPDX-License-Identifier: AGPL-3.0-only
import { createActor, waitFor } from 'xstate';
import type { SpeechSegment } from '../../../src/lib/voice/segmentation.js';
import {
  type VoiceDeps,
  selectCurrentSegmentId,
  selectTransportState,
  voiceMachine,
} from '../../../src/lib/voice/voice-machine.js';

function seg(id: string, text: string): SpeechSegment {
  return {
    segmentId: id,
    spokenText: text,
    blockIndex: 0,
    paragraphIndex: 0,
    ordinalInParagraph: 0,
    charRange: [0, 1],
    voice: 'dialogue',
  };
}

function makeDeps(overrides: Partial<VoiceDeps> = {}): VoiceDeps {
  return {
    fetchAudio: vi.fn(
      async (_segment: SpeechSegment, _signal: AbortSignal) =>
        new Blob(['x'], { type: 'audio/mpeg' }),
    ),
    play: vi.fn(async (_blob: Blob, _segment: SpeechSegment, _signal: AbortSignal) => {}),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    stop: vi.fn(),
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

function start(deps: VoiceDeps) {
  const actor = createActor(voiceMachine, { input: { deps } });
  actor.start();
  return actor;
}

describe('voiceMachine — happy path', () => {
  it('plays segments in order, returns to idle, endedPartial false, play called per segment with right blobs', async () => {
    const blobA = new Blob(['a']);
    const blobB = new Blob(['b']);
    const fetchAudio = vi.fn(async (s: SpeechSegment, _signal: AbortSignal) =>
      s.segmentId === '0:0' ? blobA : blobB,
    );
    const play = vi.fn(async (_blob: Blob, _segment: SpeechSegment, _signal: AbortSignal) => {});
    const deps = makeDeps({ fetchAudio, play });
    const actor = start(deps);

    actor.send({
      type: 'PLAY',
      messageId: 'm1',
      segments: [seg('0:0', 'one'), seg('0:1', 'two')],
      startIndex: 0,
    });

    await waitFor(actor, (s) => s.matches('idle') && s.context.messageId === null);

    expect(play).toHaveBeenCalledTimes(2);
    expect(play.mock.calls[0]?.[0]).toBe(blobA);
    expect(play.mock.calls[1]?.[0]).toBe(blobB);
    // The machine threads the segment it holds through to play (C1): the blob's
    // owning segment travels alongside it, so the hook never relies on a shared ref.
    expect(play.mock.calls[0]?.[1]?.segmentId).toBe('0:0');
    expect(play.mock.calls[1]?.[1]?.segmentId).toBe('0:1');
    expect(actor.getSnapshot().context.endedPartial).toBe(false);
    expect(selectTransportState(actor.getSnapshot())).toBe('idle');
  });

  it('exposes selectCurrentSegmentId while speaking, clears it on idle', async () => {
    const gate = deferred();
    const play = vi.fn(async () => gate.promise);
    const deps = makeDeps({ play });
    const actor = start(deps);

    actor.send({ type: 'PLAY', messageId: 'm1', segments: [seg('0:0', 'one')], startIndex: 0 });
    await waitFor(actor, (s) => selectTransportState(s) === 'speaking');
    expect(selectCurrentSegmentId(actor.getSnapshot())).toBe('0:0');

    gate.resolve();
    await waitFor(actor, (s) => s.matches('idle'));
    expect(selectCurrentSegmentId(actor.getSnapshot())).toBe(null);
  });
});

describe('voiceMachine — pause / resume', () => {
  it('PAUSE freezes without re-invoking play; RESUME continues; segment finishes with a single fetch', async () => {
    const gate = deferred();
    const fetchAudio = vi.fn(async () => new Blob(['x']));
    const play = vi.fn(async () => gate.promise);
    const deps = makeDeps({ fetchAudio, play });
    const actor = start(deps);

    actor.send({ type: 'PLAY', messageId: 'm1', segments: [seg('0:0', 'one')], startIndex: 0 });
    await waitFor(actor, (s) => selectTransportState(s) === 'speaking');
    expect(play).toHaveBeenCalledTimes(1);

    actor.send({ type: 'PAUSE' });
    await waitFor(actor, (s) => selectTransportState(s) === 'paused');
    expect(deps.pause).toHaveBeenCalledTimes(1);
    // The frozen state must still report the active segment.
    expect(selectCurrentSegmentId(actor.getSnapshot())).toBe('0:0');
    // The in-flight play actor was NOT re-invoked.
    expect(play).toHaveBeenCalledTimes(1);

    actor.send({ type: 'RESUME' });
    await waitFor(actor, (s) => selectTransportState(s) === 'speaking');
    expect(deps.resume).toHaveBeenCalledTimes(1);

    gate.resolve();
    await waitFor(actor, (s) => s.matches('idle'));
    // No re-fetch, no re-play.
    expect(fetchAudio).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
  });
});

describe('voiceMachine — stop / leave', () => {
  it('STOP aborts the in-flight fetch, calls deps.stop(), idles', async () => {
    const gate = deferred<Blob>();
    let captured: AbortSignal | null = null;
    const fetchAudio = vi.fn(async (_s: SpeechSegment, signal: AbortSignal) => {
      captured = signal;
      return gate.promise;
    });
    const deps = makeDeps({ fetchAudio });
    const actor = start(deps);

    actor.send({ type: 'PLAY', messageId: 'm1', segments: [seg('0:0', 'one')], startIndex: 0 });
    await waitFor(actor, () => fetchAudio.mock.calls.length === 1);
    if (captured === null) throw new Error('fetch signal was not captured');
    const signal: AbortSignal = captured;
    expect(signal.aborted).toBe(false);

    actor.send({ type: 'STOP' });
    await waitFor(actor, (s) => s.matches('idle'));

    expect(signal.aborted).toBe(true);
    expect(deps.stop).toHaveBeenCalledTimes(1);
    expect(selectTransportState(actor.getSnapshot())).toBe('idle');
  });

  it('LEAVE_CHAT idles and calls deps.stop(), context still carries messageId/currentIndex at send time', async () => {
    const gate = deferred();
    const play = vi.fn(async () => gate.promise);
    const deps = makeDeps({ play });
    const actor = start(deps);

    actor.send({
      type: 'PLAY',
      messageId: 'm7',
      segments: [seg('0:0', 'one'), seg('0:1', 'two')],
      startIndex: 1,
    });
    await waitFor(actor, (s) => selectTransportState(s) === 'speaking');

    // Mirror how the hook snapshots position BEFORE/with sending LEAVE_CHAT.
    const pre = actor.getSnapshot();
    expect(pre.context.messageId).toBe('m7');
    expect(pre.context.currentIndex).toBe(1);

    actor.send({ type: 'LEAVE_CHAT' });
    await waitFor(actor, (s) => s.matches('idle'));
    expect(deps.stop).toHaveBeenCalledTimes(1);
  });
});

describe('voiceMachine — failure & recovery', () => {
  it('fetch failure → failed; RETRY re-fetches the same index and completes', async () => {
    let attempt = 0;
    const fetchAudio = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('synthesis failed');
      return new Blob(['ok']);
    });
    const deps = makeDeps({ fetchAudio });
    const actor = start(deps);

    actor.send({ type: 'PLAY', messageId: 'm1', segments: [seg('0:0', 'one')], startIndex: 0 });
    await waitFor(actor, (s) => selectTransportState(s) === 'failed');
    expect(actor.getSnapshot().context.failedIndex).toBe(0);

    actor.send({ type: 'RETRY' });
    await waitFor(actor, (s) => s.matches('idle'));
    expect(fetchAudio).toHaveBeenCalledTimes(2);
    expect(deps.play).toHaveBeenCalledTimes(1);
    expect(selectTransportState(actor.getSnapshot())).toBe('idle');
  });

  it('SKIP from a failed non-final segment advances and plays the next', async () => {
    const fetchAudio = vi.fn(async (s: SpeechSegment, _signal: AbortSignal) => {
      if (s.segmentId === '0:0') throw new Error('synthesis failed');
      return new Blob(['ok']);
    });
    const play = vi.fn(async (_blob: Blob, _segment: SpeechSegment, _signal: AbortSignal) => {});
    const deps = makeDeps({ fetchAudio, play });
    const actor = start(deps);

    actor.send({
      type: 'PLAY',
      messageId: 'm1',
      segments: [seg('0:0', 'one'), seg('0:1', 'two')],
      startIndex: 0,
    });
    await waitFor(actor, (s) => selectTransportState(s) === 'failed');

    actor.send({ type: 'SKIP' });
    await waitFor(actor, (s) => s.matches('idle'));
    expect(play).toHaveBeenCalledTimes(1);
    expect(play.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect(actor.getSnapshot().context.endedPartial).toBe(false);
  });

  it('SKIP from a failed FINAL segment → idle with ended-partial', async () => {
    const fetchAudio = vi.fn(async () => {
      throw new Error('synthesis failed');
    });
    const deps = makeDeps({ fetchAudio });
    const actor = start(deps);

    actor.send({ type: 'PLAY', messageId: 'm1', segments: [seg('0:0', 'one')], startIndex: 0 });
    await waitFor(actor, (s) => selectTransportState(s) === 'failed');

    actor.send({ type: 'SKIP' });
    await waitFor(actor, (s) => s.matches('idle'));
    expect(actor.getSnapshot().context.endedPartial).toBe(true);
    expect(selectTransportState(actor.getSnapshot())).toBe('ended-partial');
  });

  it('DISMISS from ended-partial clears the flag → plain idle', async () => {
    const fetchAudio = vi.fn(async () => {
      throw new Error('synthesis failed');
    });
    const deps = makeDeps({ fetchAudio });
    const actor = start(deps);

    actor.send({ type: 'PLAY', messageId: 'm1', segments: [seg('0:0', 'one')], startIndex: 0 });
    await waitFor(actor, (s) => selectTransportState(s) === 'failed');

    actor.send({ type: 'SKIP' });
    await waitFor(actor, (s) => selectTransportState(s) === 'ended-partial');

    actor.send({ type: 'DISMISS' });
    expect(actor.getSnapshot().context.endedPartial).toBe(false);
    expect(selectTransportState(actor.getSnapshot())).toBe('idle');
  });

  it('a play() rejection (decode failure) also lands in failed', async () => {
    const play = vi.fn(async () => {
      throw new Error('decode failed');
    });
    const deps = makeDeps({ play });
    const actor = start(deps);

    actor.send({ type: 'PLAY', messageId: 'm1', segments: [seg('0:0', 'one')], startIndex: 0 });
    await waitFor(actor, (s) => selectTransportState(s) === 'failed');
    expect(actor.getSnapshot().context.failedIndex).toBe(0);
  });
});

describe('voiceMachine — skip while speaking', () => {
  it('SKIP mid-speaking a non-final segment cancels it and plays the next', async () => {
    // play never resolves, so the machine stays in `speaking` on segment 0
    // until the user skips — mirroring an in-progress read.
    const gate = deferred();
    const play = vi.fn(
      async (_blob: Blob, _segment: SpeechSegment, _signal: AbortSignal) => gate.promise,
    );
    const deps = makeDeps({ play });
    const actor = start(deps);

    actor.send({
      type: 'PLAY',
      messageId: 'm1',
      segments: [seg('0:0', 'one'), seg('0:1', 'two')],
      startIndex: 0,
    });
    await waitFor(actor, (s) => selectTransportState(s) === 'speaking');
    expect(actor.getSnapshot().context.currentIndex).toBe(0);

    actor.send({ type: 'SKIP' });
    await waitFor(actor, (s) => s.context.currentIndex === 1);
    expect(selectTransportState(actor.getSnapshot())).toBe('speaking');
    expect(play).toHaveBeenCalledTimes(2);
    expect(play.mock.calls[1]?.[1]?.segmentId).toBe('0:1');
  });

  it('SKIP mid-speaking the FINAL segment ends cleanly (idle, not ended-partial)', async () => {
    const gate = deferred();
    const play = vi.fn(async () => gate.promise);
    const deps = makeDeps({ play });
    const actor = start(deps);

    // Default PLAY is a one-shot read (streamComplete true), so skipping the
    // last segment is a deliberate "done", not a partial finish.
    actor.send({ type: 'PLAY', messageId: 'm1', segments: [seg('0:0', 'one')], startIndex: 0 });
    await waitFor(actor, (s) => selectTransportState(s) === 'speaking');

    actor.send({ type: 'SKIP' });
    await waitFor(actor, (s) => s.matches('idle'));
    expect(actor.getSnapshot().context.endedPartial).toBe(false);
    expect(selectTransportState(actor.getSnapshot())).toBe('idle');
  });

  it('SKIP mid-speaking the last KNOWN segment while still streaming parks in waiting', async () => {
    const gate = deferred();
    const play = vi.fn(async () => gate.promise);
    const deps = makeDeps({ play });
    const actor = start(deps);

    // streamComplete false: more segments may still arrive, so skipping the
    // last known one must wait for them, not end the read.
    actor.send({
      type: 'PLAY',
      messageId: 'm1',
      segments: [seg('0:0', 'one')],
      startIndex: 0,
      streamComplete: false,
    });
    await waitFor(actor, (s) => selectTransportState(s) === 'speaking');

    actor.send({ type: 'SKIP' });
    await waitFor(actor, (s) => selectTransportState(s) === 'waiting');
    expect(actor.getSnapshot().context.endedPartial).toBe(false);
  });
});

describe('voiceMachine — stop / leave while paused', () => {
  it('STOP while paused never resumes the context (no blip)', async () => {
    const gate = deferred();
    const play = vi.fn(async () => gate.promise);
    const deps = makeDeps({ play });
    const actor = start(deps);

    actor.send({ type: 'PLAY', messageId: 'm1', segments: [seg('0:0', 'one')], startIndex: 0 });
    await waitFor(actor, (s) => selectTransportState(s) === 'speaking');

    actor.send({ type: 'PAUSE' });
    await waitFor(actor, (s) => selectTransportState(s) === 'paused');

    actor.send({ type: 'STOP' });
    await waitFor(actor, (s) => s.matches('idle'));

    // deps.resume must NOT have been called — resuming just before stop would
    // cause an audible blip if the audio context momentarily unsuspends.
    expect(deps.resume).not.toHaveBeenCalled();
    expect(deps.stop).toHaveBeenCalledTimes(1);
    expect(selectTransportState(actor.getSnapshot())).toBe('idle');
  });

  it('LEAVE_CHAT while paused never resumes the context', async () => {
    const gate = deferred();
    const play = vi.fn(async () => gate.promise);
    const deps = makeDeps({ play });
    const actor = start(deps);

    actor.send({ type: 'PLAY', messageId: 'm1', segments: [seg('0:0', 'one')], startIndex: 0 });
    await waitFor(actor, (s) => selectTransportState(s) === 'speaking');

    actor.send({ type: 'PAUSE' });
    await waitFor(actor, (s) => selectTransportState(s) === 'paused');

    actor.send({ type: 'LEAVE_CHAT' });
    await waitFor(actor, (s) => s.matches('idle'));

    expect(deps.resume).not.toHaveBeenCalled();
    expect(deps.stop).toHaveBeenCalledTimes(1);
  });

  it('STOP from failed state → idle + deps.stop called (bubbling pin)', async () => {
    const fetchAudio = vi.fn(async () => {
      throw new Error('synthesis failed');
    });
    const deps = makeDeps({ fetchAudio });
    const actor = start(deps);

    actor.send({ type: 'PLAY', messageId: 'm1', segments: [seg('0:0', 'one')], startIndex: 0 });
    await waitFor(actor, (s) => selectTransportState(s) === 'failed');

    actor.send({ type: 'STOP' });
    await waitFor(actor, (s) => s.matches('idle'));

    expect(deps.stop).toHaveBeenCalledTimes(1);
    expect(selectTransportState(actor.getSnapshot())).toBe('idle');
  });

  it('PAUSE during fetch then fetch failure → transport reports failed (not paused)', async () => {
    // The machine is frozen (gate=frozen) when the playSegment actor's fetch
    // rejects. 'failed' must win over 'paused' in selectTransportState because
    // the playback region takes precedence when both hold simultaneously.
    let rejectFetch!: (e: unknown) => void;
    const fetchAudio = vi.fn(
      (_s: SpeechSegment, _signal: AbortSignal) =>
        new Promise<Blob>((_res, rej) => {
          rejectFetch = rej;
        }),
    );
    const deps = makeDeps({ fetchAudio });
    const actor = start(deps);

    actor.send({ type: 'PLAY', messageId: 'm1', segments: [seg('0:0', 'one')], startIndex: 0 });
    await waitFor(actor, (s) => selectTransportState(s) === 'speaking');
    await waitFor(actor, () => fetchAudio.mock.calls.length === 1);

    actor.send({ type: 'PAUSE' });
    await waitFor(actor, (s) => selectTransportState(s) === 'paused');

    // Reject the in-flight fetch while the gate is frozen.
    rejectFetch(new Error('synthesis failed'));
    await waitFor(actor, (s) => selectTransportState(s) === 'failed');

    expect(selectTransportState(actor.getSnapshot())).toBe('failed');
  });
});

describe('voiceMachine — prefetch', () => {
  it('prefetches index+1 while index plays; next segment plays without a second fetch', async () => {
    const gate0 = deferred();
    let playCall = 0;
    const fetchAudio = vi.fn(
      async (s: SpeechSegment, _signal: AbortSignal) =>
        new Blob([s.segmentId], { type: 'audio/mpeg' }),
    );
    const play = vi.fn(async (_blob: Blob, _segment: SpeechSegment, _signal: AbortSignal) => {
      playCall += 1;
      if (playCall === 1) return gate0.promise;
      return undefined;
    });
    const deps = makeDeps({ fetchAudio, play });
    const actor = start(deps);

    actor.send({
      type: 'PLAY',
      messageId: 'm1',
      segments: [seg('0:0', 'one'), seg('0:1', 'two')],
      startIndex: 0,
    });
    await waitFor(actor, (s) => selectTransportState(s) === 'speaking');

    // While segment 0 is gated mid-play, segment 1 should already be prefetched.
    await waitFor(actor, () => fetchAudio.mock.calls.length === 2);
    expect(fetchAudio.mock.calls.map((c) => c[0]?.segmentId).sort()).toEqual(['0:0', '0:1']);

    gate0.resolve();
    await waitFor(actor, (s) => s.matches('idle'));

    // Exactly one fetch per segment: the prefetch WAS the fetch for segment 1.
    expect(fetchAudio).toHaveBeenCalledTimes(2);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('re-arms the look-ahead across 3 segments: index 2 is fetched while index 1 plays, 3 fetches total', async () => {
    // One release gate per segment so we can freeze playback at each step and
    // inspect what has been fetched. This exercises the second `speaking`
    // re-entry — the case the old parallel `prefetch` region failed to re-arm.
    const gates = [deferred(), deferred(), deferred()];
    let playCall = 0;
    const fetchAudio = vi.fn(
      async (s: SpeechSegment, _signal: AbortSignal) =>
        new Blob([s.segmentId], { type: 'audio/mpeg' }),
    );
    const play = vi.fn(async (_blob: Blob, _segment: SpeechSegment, _signal: AbortSignal) => {
      const gate = gates[playCall];
      playCall += 1;
      return gate?.promise;
    });
    const deps = makeDeps({ fetchAudio, play });
    const actor = start(deps);

    actor.send({
      type: 'PLAY',
      messageId: 'm1',
      segments: [seg('0:0', 'one'), seg('0:1', 'two'), seg('0:2', 'three')],
      startIndex: 0,
    });

    // s0 is playing (gated). The look-ahead has already fetched s1.
    await waitFor(actor, (s) => selectTransportState(s) === 'speaking');
    await waitFor(actor, () => fetchAudio.mock.calls.length === 2);
    expect(fetchAudio.mock.calls.map((c) => c[0]?.segmentId).sort()).toEqual(['0:0', '0:1']);

    // Finish s0 → advance to s1. While s1 plays, s2 must ALREADY be fetched —
    // the re-armed look-ahead. This is the regression the fix restores.
    gates[0]?.resolve();
    await waitFor(actor, (s) => s.context.currentIndex === 1);
    await waitFor(actor, () => fetchAudio.mock.calls.length === 3);
    expect(fetchAudio.mock.calls.map((c) => c[0]?.segmentId).sort()).toEqual(['0:0', '0:1', '0:2']);

    // s2 already cached: finishing s1 then s2 adds no further fetches.
    gates[1]?.resolve();
    await waitFor(actor, (s) => s.context.currentIndex === 2);
    gates[2]?.resolve();
    await waitFor(actor, (s) => s.matches('idle'));

    // Exactly one fetch per segment, no duplicates; play ran for each.
    expect(fetchAudio).toHaveBeenCalledTimes(3);
    expect(play).toHaveBeenCalledTimes(3);
  });
});
