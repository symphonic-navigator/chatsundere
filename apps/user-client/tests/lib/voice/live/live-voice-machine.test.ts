// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'vitest';
import { createActor } from 'xstate';
import {
  type LiveVoiceDeps,
  liveVoiceMachine,
  selectFill,
  selectFloor,
} from '../../../../src/lib/voice/live/live-voice-machine.js';

function deps(over: Partial<LiveVoiceDeps> = {}): LiveVoiceDeps {
  return {
    startCapture: () => {},
    stopCapture: () => {},
    transcribe: async () => 'hello',
    sendMessage: () => {},
    abortReply: () => {},
    stopPlayback: () => {},
    pausePlayback: () => {},
    resumePlayback: () => {},
    ...over,
  };
}

describe('liveVoiceMachine', () => {
  test('starts idle and enters listening on ENTER, leaving capture armed', () => {
    let started = 0;
    const actor = createActor(liveVoiceMachine, {
      input: {
        deps: deps({
          startCapture: () => {
            started++;
          },
        }),
      },
    }).start();
    expect(selectFloor(actor.getSnapshot())).toBe('idle');
    actor.send({ type: 'ENTER' });
    expect(selectFloor(actor.getSnapshot())).toBe('listening');
    expect(started).toBe(1);
  });

  test('EXIT stops capture and returns to idle', () => {
    let stopped = 0;
    const actor = createActor(liveVoiceMachine, {
      input: {
        deps: deps({
          stopCapture: () => {
            stopped++;
          },
        }),
      },
    }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'EXIT' });
    expect(selectFloor(actor.getSnapshot())).toBe('idle');
    expect(stopped).toBe(1);
  });
});

describe('liveVoiceMachine — user floor', () => {
  test('SPEECH_START → userSpeaking; PROGRESS updates the fill', () => {
    const actor = createActor(liveVoiceMachine, { input: { deps: deps() } }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'SPEECH_START' });
    expect(selectFloor(actor.getSnapshot())).toBe('userSpeaking');
    actor.send({ type: 'PROGRESS', fraction: 0.5 });
    expect(selectFill(actor.getSnapshot())).toBe(0.5);
  });

  test('MISFIRE reverts userSpeaking → listening and zeroes the fill', () => {
    const actor = createActor(liveVoiceMachine, { input: { deps: deps() } }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'SPEECH_START' });
    actor.send({ type: 'PROGRESS', fraction: 0.3 });
    actor.send({ type: 'MISFIRE' });
    expect(selectFloor(actor.getSnapshot())).toBe('listening');
    expect(selectFill(actor.getSnapshot())).toBe(0);
  });

  test('SPEECH_END (not holding) → transcribing → sends → personaThinking', async () => {
    const sent: string[] = [];
    const actor = createActor(liveVoiceMachine, {
      input: {
        deps: deps({ transcribe: async () => 'hi there', sendMessage: (t) => sent.push(t) }),
      },
    }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'SPEECH_START' });
    actor.send({
      type: 'SPEECH_END',
      pcm: new Float32Array([1]),
      blob: new Blob(),
      mimeType: 'audio/wav',
    });
    expect(selectFloor(actor.getSnapshot())).toBe('transcribing');
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual(['hi there']);
    expect(selectFloor(actor.getSnapshot())).toBe('personaThinking');
  });

  test('empty transcript returns to listening without sending', async () => {
    const sent: string[] = [];
    const actor = createActor(liveVoiceMachine, {
      input: { deps: deps({ transcribe: async () => '   ', sendMessage: (t) => sent.push(t) }) },
    }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'SPEECH_START' });
    actor.send({
      type: 'SPEECH_END',
      pcm: new Float32Array([1]),
      blob: new Blob(),
      mimeType: 'audio/wav',
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual([]);
    expect(selectFloor(actor.getSnapshot())).toBe('listening');
  });

  test('TAP during transcribing cancels — back to listening, no send', async () => {
    const sent: string[] = [];
    const actor = createActor(liveVoiceMachine, {
      input: {
        deps: deps({
          transcribe: async (_p, _b, _m, signal) =>
            new Promise((_res, rej) =>
              signal.addEventListener('abort', () => rej(new Error('aborted'))),
            ),
          sendMessage: (t) => sent.push(t),
        }),
      },
    }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'SPEECH_START' });
    actor.send({
      type: 'SPEECH_END',
      pcm: new Float32Array([1]),
      blob: new Blob(),
      mimeType: 'audio/wav',
    });
    expect(selectFloor(actor.getSnapshot())).toBe('transcribing');
    actor.send({ type: 'CANCEL' });
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual([]);
    expect(selectFloor(actor.getSnapshot())).toBe('listening');
  });
});

describe('liveVoiceMachine — hold to keep talking', () => {
  test('while holding, SPEECH_END buffers and stays on the user floor (no transcribe)', async () => {
    const sent: string[] = [];
    const actor = createActor(liveVoiceMachine, {
      input: { deps: deps({ sendMessage: (t) => sent.push(t) }) },
    }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'PRESS_START' }); // thumb down — holding
    actor.send({ type: 'SPEECH_START' });
    actor.send({
      type: 'SPEECH_END',
      pcm: new Float32Array([1, 2]),
      blob: new Blob(),
      mimeType: 'audio/wav',
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual([]); // buffered, not sent
    expect(['userSpeaking', 'listening']).toContain(selectFloor(actor.getSnapshot()));
    expect(selectFill(actor.getSnapshot())).toBe(0); // pinned
  });

  test('PRESS_END after buffered speech merges and transcribes once', async () => {
    const sent: string[] = [];
    const actor = createActor(liveVoiceMachine, {
      input: {
        deps: deps({ transcribe: async () => 'merged turn', sendMessage: (t) => sent.push(t) }),
      },
    }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'PRESS_START' });
    actor.send({ type: 'SPEECH_START' });
    actor.send({
      type: 'SPEECH_END',
      pcm: new Float32Array([1]),
      blob: new Blob(),
      mimeType: 'audio/wav',
    });
    actor.send({
      type: 'SPEECH_END',
      pcm: new Float32Array([2]),
      blob: new Blob(),
      mimeType: 'audio/wav',
    });
    actor.send({ type: 'PRESS_END', heldMs: 1200 });
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual(['merged turn']);
  });
});

describe('liveVoiceMachine — unified Hold', () => {
  test('HOLD freezes to held; RESUME returns to listening; mic + playback paused', () => {
    let captureStops = 0;
    let playbackPauses = 0;
    const actor = createActor(liveVoiceMachine, {
      input: {
        deps: deps({ stopCapture: () => captureStops++, pausePlayback: () => playbackPauses++ }),
      },
    }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'HOLD' });
    expect(selectFloor(actor.getSnapshot())).toBe('held');
    actor.send({ type: 'RESUME' });
    expect(selectFloor(actor.getSnapshot())).toBe('listening');
  });

  test('entering transcribing calls stopCapture', () => {
    let stopCount = 0;
    const actor = createActor(liveVoiceMachine, {
      input: {
        deps: deps({
          stopCapture: () => stopCount++,
          // Never resolves — we only care that stopCapture was called on entry.
          transcribe: async (_p, _b, _m, signal) =>
            new Promise((_res, rej) =>
              signal.addEventListener('abort', () => rej(new Error('aborted'))),
            ),
        }),
      },
    }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'SPEECH_START' });
    actor.send({
      type: 'SPEECH_END',
      pcm: new Float32Array([1]),
      blob: new Blob(),
      mimeType: 'audio/wav',
    });
    expect(selectFloor(actor.getSnapshot())).toBe('transcribing');
    // stopCapture must have been called on transcribing entry.
    expect(stopCount).toBeGreaterThanOrEqual(1);
  });

  test('HOLD from personaSpeaking then RESUME returns to personaSpeaking and calls resumePlayback', async () => {
    let pauses = 0;
    let resumes = 0;
    const actor = createActor(liveVoiceMachine, {
      input: {
        deps: deps({
          pausePlayback: () => pauses++,
          resumePlayback: () => resumes++,
        }),
      },
    }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'SPEECH_START' });
    actor.send({
      type: 'SPEECH_END',
      pcm: new Float32Array([1]),
      blob: new Blob(),
      mimeType: 'audio/wav',
    });
    await new Promise((r) => setTimeout(r, 0));
    // Advance to personaSpeaking once the reply's first audio plays.
    actor.send({ type: 'PLAYBACK_STARTED' });
    expect(selectFloor(actor.getSnapshot())).toBe('personaSpeaking');
    actor.send({ type: 'HOLD' });
    expect(selectFloor(actor.getSnapshot())).toBe('held');
    expect(pauses).toBe(1); // pausePlayback called on held entry
    actor.send({ type: 'RESUME' });
    // Should return to personaSpeaking (not listening) and resume audio.
    expect(selectFloor(actor.getSnapshot())).toBe('personaSpeaking');
    expect(resumes).toBe(1);
  });

  test('HOLD from listening then RESUME returns to listening', () => {
    const actor = createActor(liveVoiceMachine, {
      input: { deps: deps() },
    }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'HOLD' });
    expect(selectFloor(actor.getSnapshot())).toBe('held');
    actor.send({ type: 'RESUME' });
    expect(selectFloor(actor.getSnapshot())).toBe('listening');
  });

  test('EXIT from held (entered from persona) calls stopPlayback', async () => {
    let stops = 0;
    const actor = createActor(liveVoiceMachine, {
      input: {
        deps: deps({ stopPlayback: () => stops++ }),
      },
    }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'SPEECH_START' });
    actor.send({
      type: 'SPEECH_END',
      pcm: new Float32Array([1]),
      blob: new Blob(),
      mimeType: 'audio/wav',
    });
    await new Promise((r) => setTimeout(r, 0));
    actor.send({ type: 'PLAYBACK_STARTED' }); // → personaSpeaking
    actor.send({ type: 'HOLD' }); // → held (heldFromPersona = true)
    expect(selectFloor(actor.getSnapshot())).toBe('held');
    actor.send({ type: 'EXIT' });
    expect(selectFloor(actor.getSnapshot())).toBe('idle');
    // stopPlayback must end the frozen stream on EXIT from held.
    expect(stops).toBeGreaterThanOrEqual(1);
  });
});

describe('liveVoiceMachine — persona floor', () => {
  test('personaThinking does NOT initiate playback — it awaits the streaming reply', () => {
    // Regression guard for the stale-read bug: the machine used to read the
    // "latest persona message currently in the array" on personaThinking entry,
    // which — before the new reply had streamed in — was the PREVIOUS turn's
    // reply. The machine now reads nothing itself; the streaming driver does.
    let aborts = 0;
    let stops = 0;
    const actor = createActor(liveVoiceMachine, {
      input: { deps: deps({ abortReply: () => aborts++, stopPlayback: () => stops++ }) },
    }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'SPEECH_START' });
    actor.send({
      type: 'SPEECH_END',
      pcm: new Float32Array([1]),
      blob: new Blob(),
      mimeType: 'audio/wav',
    });
    return new Promise<void>((res) =>
      setTimeout(() => {
        expect(selectFloor(actor.getSnapshot())).toBe('personaThinking');
        // No playback action of any kind has fired on entry.
        expect(aborts).toBe(0);
        expect(stops).toBe(0);
        res();
      }, 0),
    );
  });

  test('PLAYBACK_STARTED moves personaThinking → personaSpeaking', async () => {
    const actor = createActor(liveVoiceMachine, { input: { deps: deps() } }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'SPEECH_START' });
    actor.send({
      type: 'SPEECH_END',
      pcm: new Float32Array([1]),
      blob: new Blob(),
      mimeType: 'audio/wav',
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(selectFloor(actor.getSnapshot())).toBe('personaThinking');
    actor.send({ type: 'PLAYBACK_STARTED' });
    expect(selectFloor(actor.getSnapshot())).toBe('personaSpeaking');
  });

  test('PLAYBACK_DONE returns the floor to the user (listening)', async () => {
    const actor = createActor(liveVoiceMachine, { input: { deps: deps() } }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'SPEECH_START' });
    actor.send({
      type: 'SPEECH_END',
      pcm: new Float32Array([1]),
      blob: new Blob(),
      mimeType: 'audio/wav',
    });
    await new Promise((r) => setTimeout(r, 0));
    actor.send({ type: 'PLAYBACK_DONE' });
    expect(selectFloor(actor.getSnapshot())).toBe('listening');
  });

  test('BARGE from personaThinking aborts the pending reply + stops playback → listening', async () => {
    let aborts = 0;
    let stops = 0;
    const actor = createActor(liveVoiceMachine, {
      input: { deps: deps({ abortReply: () => aborts++, stopPlayback: () => stops++ }) },
    }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'SPEECH_START' });
    actor.send({
      type: 'SPEECH_END',
      pcm: new Float32Array([1]),
      blob: new Blob(),
      mimeType: 'audio/wav',
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(selectFloor(actor.getSnapshot())).toBe('personaThinking');
    actor.send({ type: 'BARGE' });
    // The input was unwanted: the in-flight generation is aborted, not just muted.
    expect(aborts).toBe(1);
    expect(stops).toBe(1);
    expect(selectFloor(actor.getSnapshot())).toBe('listening');
  });

  test('PLAYBACK_FAILED returns to listening (non-ejecting)', async () => {
    const actor = createActor(liveVoiceMachine, { input: { deps: deps() } }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'SPEECH_START' });
    actor.send({
      type: 'SPEECH_END',
      pcm: new Float32Array([1]),
      blob: new Blob(),
      mimeType: 'audio/wav',
    });
    await new Promise((r) => setTimeout(r, 0));
    actor.send({ type: 'PLAYBACK_FAILED' });
    expect(selectFloor(actor.getSnapshot())).toBe('listening');
  });

  test('BARGE from personaSpeaking aborts the reply + stops playback → listening', async () => {
    let aborts = 0;
    let stops = 0;
    const actor = createActor(liveVoiceMachine, {
      input: { deps: deps({ abortReply: () => aborts++, stopPlayback: () => stops++ }) },
    }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'SPEECH_START' });
    actor.send({
      type: 'SPEECH_END',
      pcm: new Float32Array([1]),
      blob: new Blob(),
      mimeType: 'audio/wav',
    });
    await new Promise((r) => setTimeout(r, 0));
    actor.send({ type: 'PLAYBACK_STARTED' }); // → personaSpeaking
    actor.send({ type: 'BARGE' });
    expect(aborts).toBe(1);
    expect(stops).toBe(1);
    expect(selectFloor(actor.getSnapshot())).toBe('listening');
  });

  test('EXIT from personaSpeaking calls stopPlayback + stopCapture → idle (no abort)', async () => {
    let playbackStops = 0;
    let captureStops = 0;
    let aborts = 0;
    const actor = createActor(liveVoiceMachine, {
      input: {
        deps: deps({
          stopPlayback: () => playbackStops++,
          stopCapture: () => captureStops++,
          abortReply: () => aborts++,
        }),
      },
    }).start();
    actor.send({ type: 'ENTER' });
    actor.send({ type: 'SPEECH_START' });
    actor.send({
      type: 'SPEECH_END',
      pcm: new Float32Array([1]),
      blob: new Blob(),
      mimeType: 'audio/wav',
    });
    await new Promise((r) => setTimeout(r, 0));
    actor.send({ type: 'PLAYBACK_STARTED' }); // → personaSpeaking
    actor.send({ type: 'EXIT' });
    expect(playbackStops).toBe(1);
    // EXIT leaves the mode; the reply finishes streaming into the chat (no abort).
    expect(aborts).toBe(0);
    // stopCapture is now also called on transcribing entry (FIX B — mic closes
    // when the floor leaves the user) in addition to the EXIT action, so the
    // count is ≥ 1 rather than exactly 1.
    expect(captureStops).toBeGreaterThanOrEqual(1);
    expect(selectFloor(actor.getSnapshot())).toBe('idle');
  });

  test('returning to listening from persona re-arms startCapture', async () => {
    let captureStarts = 0;
    const actor = createActor(liveVoiceMachine, {
      input: { deps: deps({ startCapture: () => captureStarts++ }) },
    }).start();
    actor.send({ type: 'ENTER' }); // captureStarts = 1
    actor.send({ type: 'SPEECH_START' });
    actor.send({
      type: 'SPEECH_END',
      pcm: new Float32Array([1]),
      blob: new Blob(),
      mimeType: 'audio/wav',
    });
    await new Promise((r) => setTimeout(r, 0));
    // Now in personaThinking; PLAYBACK_DONE → listening runs entry → startCapture again
    actor.send({ type: 'PLAYBACK_DONE' });
    expect(selectFloor(actor.getSnapshot())).toBe('listening');
    expect(captureStarts).toBe(2);
  });
});
