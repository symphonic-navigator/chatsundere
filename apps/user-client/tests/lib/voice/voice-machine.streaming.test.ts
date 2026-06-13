// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import type { SpeechSegment } from '../../../src/lib/voice/segmentation.js';
import { type VoiceDeps, voiceMachine } from '../../../src/lib/voice/voice-machine.js';

function seg(id: string): SpeechSegment {
  return {
    segmentId: id,
    spokenText: id,
    blockIndex: 0,
    paragraphIndex: Number(id.split(':')[1]),
    ordinalInParagraph: 0,
    charRange: [0, 1],
    voice: 'dialogue',
  };
}

function deps(): VoiceDeps {
  return {
    fetchAudio: vi.fn(async () => new Blob()),
    play: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    stop: vi.fn(),
  };
}

describe('voice machine — streaming', () => {
  it('parks in waiting when the queue drains before the stream is done', async () => {
    const actor = createActor(voiceMachine, { input: { deps: deps() } }).start();
    actor.send({
      type: 'PLAY',
      messageId: 'm1',
      segments: [seg('0:0')],
      startIndex: 0,
      streamComplete: false,
    });
    await vi.waitFor(() =>
      expect(actor.getSnapshot().matches({ active: { playback: 'waiting' } })).toBe(true),
    );
  });

  it('SEGMENTS_UPDATED wakes it from waiting and plays the next segment', async () => {
    const actor = createActor(voiceMachine, { input: { deps: deps() } }).start();
    actor.send({
      type: 'PLAY',
      messageId: 'm1',
      segments: [seg('0:0')],
      startIndex: 0,
      streamComplete: false,
    });
    await vi.waitFor(() =>
      expect(actor.getSnapshot().matches({ active: { playback: 'waiting' } })).toBe(true),
    );
    actor.send({ type: 'SEGMENTS_UPDATED', segments: [seg('0:0'), seg('0:1')] });
    await vi.waitFor(() => expect(actor.getSnapshot().context.currentIndex).toBe(1));
  });

  it('STREAM_DONE in waiting ends cleanly (back to idle)', async () => {
    const actor = createActor(voiceMachine, { input: { deps: deps() } }).start();
    actor.send({
      type: 'PLAY',
      messageId: 'm1',
      segments: [seg('0:0')],
      startIndex: 0,
      streamComplete: false,
    });
    await vi.waitFor(() =>
      expect(actor.getSnapshot().matches({ active: { playback: 'waiting' } })).toBe(true),
    );
    actor.send({ type: 'STREAM_DONE' });
    await vi.waitFor(() => expect(actor.getSnapshot().matches('idle')).toBe(true));
  });

  it('manual path (streamComplete defaulting true) never enters waiting', async () => {
    const actor = createActor(voiceMachine, { input: { deps: deps() } }).start();
    actor.send({ type: 'PLAY', messageId: 'm1', segments: [seg('0:0')], startIndex: 0 });
    await vi.waitFor(() => expect(actor.getSnapshot().matches('idle')).toBe(true));
  });

  it('grows the queue while speaking and ends after the last segment once stream-complete', async () => {
    const d = deps();
    // Make play() resolve slowly enough that SEGMENTS_UPDATED/STREAM_DONE land
    // while still in `speaking`, exercising the active-level handlers.
    // Wrap in an object so TS can narrow the type after vi.waitFor confirms it
    // is set (a plain `let` cannot be narrowed across async boundaries).
    const gate = { resolve: null as (() => void) | null };
    (d.play as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(async () => {
        await new Promise<void>((r) => {
          gate.resolve = r;
        });
      })
      .mockImplementation(async () => {});
    const actor = createActor(voiceMachine, { input: { deps: d } }).start();
    actor.send({
      type: 'PLAY',
      messageId: 'm1',
      segments: [seg('0:0')],
      startIndex: 0,
      streamComplete: false,
    });
    // Wait until play() has been invoked (fetchAudio resolves first, then play
    // is called) so that gate.resolve is guaranteed to be set before we use it.
    await vi.waitFor(() => expect(gate.resolve).not.toBeNull());
    // While seg0 is still "playing", the queue grows and the stream completes.
    actor.send({ type: 'SEGMENTS_UPDATED', segments: [seg('0:0'), seg('0:1')] });
    actor.send({ type: 'STREAM_DONE' });
    expect(actor.getSnapshot().context.segments).toHaveLength(2);
    expect(actor.getSnapshot().context.streamComplete).toBe(true);
    // Let seg0 finish → machine advances to seg1, plays it, then ends.
    if (gate.resolve !== null) gate.resolve();
    await vi.waitFor(() => expect(actor.getSnapshot().matches('idle')).toBe(true));
  });
});
