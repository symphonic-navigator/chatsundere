// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AudioSink,
  READ_ALOUD_MEDIA_BRIDGE,
  isReadAloudBridgeEnabled,
} from '../../src/lib/voice/audio-sink.js';

// jsdom has no Web Audio and no real media playback, so the graph and the
// element are fakes that keep the semantics the sink relies on: play() flips
// `paused` synchronously when allowed, and the play/pause events arrive a task
// later.

function node() {
  return { connect: vi.fn(), disconnect: vi.fn() };
}

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  static refuse = false;
  paused = true;
  muted = false;
  srcObject: unknown = null;
  constructor() {
    super();
    FakeAudio.instances.push(this);
  }
  play(): Promise<void> {
    if (FakeAudio.refuse) {
      return Promise.reject(new DOMException('not allowed', 'NotAllowedError'));
    }
    if (this.paused) {
      this.paused = false;
      setTimeout(() => this.dispatchEvent(new Event('play')), 0);
    }
    return Promise.resolve();
  }
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    setTimeout(() => this.dispatchEvent(new Event('pause')), 0);
  }
  /** The platform acting on the element (lock screen, headset, audio focus). */
  platformPause(): void {
    this.paused = true;
    setTimeout(() => this.dispatchEvent(new Event('pause')), 0);
  }
  platformPlay(): void {
    this.paused = false;
    setTimeout(() => this.dispatchEvent(new Event('play')), 0);
  }
}

let analyser: ReturnType<typeof node> & { fftSize: number };
let streamDest: ReturnType<typeof node> & { stream: object };
let ctx: {
  state: string;
  destination: object;
  createAnalyser: () => typeof analyser;
  createMediaStreamDestination: () => typeof streamDest;
  resume: () => Promise<void>;
  suspend: () => Promise<void>;
  close: () => Promise<void>;
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const element = () => FakeAudio.instances[0];

beforeEach(() => {
  FakeAudio.instances = [];
  FakeAudio.refuse = false;
  analyser = { ...node(), fftSize: 0 };
  streamDest = { ...node(), stream: { id: 'stream' } };
  ctx = {
    state: 'running',
    destination: { id: 'destination' },
    createAnalyser: () => analyser,
    createMediaStreamDestination: vi.fn(() => streamDest),
    resume: vi.fn(async () => {
      ctx.state = 'running';
    }),
    suspend: vi.fn(async () => {
      ctx.state = 'suspended';
    }),
    close: vi.fn(async () => {}),
  };
  vi.stubGlobal(
    'AudioContext',
    vi.fn(() => ctx),
  );
  vi.stubGlobal('Audio', FakeAudio);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.removeItem('cs.readAloudBridge');
});

describe('isReadAloudBridgeEnabled', () => {
  it('follows the constant without an override', () => {
    expect(isReadAloudBridgeEnabled()).toBe(READ_ALOUD_MEDIA_BRIDGE);
  });

  it('lets the test-only override win both ways', () => {
    localStorage.setItem('cs.readAloudBridge', 'off');
    expect(isReadAloudBridgeEnabled()).toBe(false);
    localStorage.setItem('cs.readAloudBridge', 'on');
    expect(isReadAloudBridgeEnabled()).toBe(true);
  });

  it('falls back to the constant when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(isReadAloudBridgeEnabled()).toBe(READ_ALOUD_MEDIA_BRIDGE);
    vi.restoreAllMocks();
  });
});

describe('AudioSink with the bridge off', () => {
  it('keeps the direct graph and never creates an element', () => {
    const sink = new AudioSink({ mediaElementBridge: false });
    sink.setRoute('bridge');
    sink.setReadPhase('playing');
    sink.primeBridge();
    sink.ensureAnalyserForTest();
    expect(analyser.connect).toHaveBeenCalledTimes(1);
    expect(analyser.connect).toHaveBeenCalledWith(ctx.destination);
    expect(ctx.createMediaStreamDestination).not.toHaveBeenCalled();
    expect(FakeAudio.instances).toHaveLength(0);
  });
});

describe('AudioSink with the bridge on', () => {
  it('feeds the analyser into the stream played by one hidden element', () => {
    const sink = new AudioSink({ mediaElementBridge: true });
    sink.ensureAnalyserForTest();
    expect(analyser.connect).toHaveBeenCalledWith(streamDest);
    expect(analyser.connect).not.toHaveBeenCalledWith(ctx.destination);
    expect(FakeAudio.instances).toHaveLength(1);
    expect(element()?.srcObject).toBe(streamDest.stream);
    expect(element()?.paused).toBe(true);
  });

  it('plays the element while reading, pauses it on pause and on idle', () => {
    const sink = new AudioSink({ mediaElementBridge: true });
    sink.setReadPhase('playing');
    expect(element()?.paused).toBe(false);
    sink.setReadPhase('paused');
    expect(element()?.paused).toBe(true);
    sink.setReadPhase('playing');
    expect(element()?.paused).toBe(false);
    sink.setReadPhase('idle');
    expect(element()?.paused).toBe(true);
    expect(element()?.srcObject).toBe(streamDest.stream);
  });

  it('routes direct for live voice: no element is created or played', () => {
    const sink = new AudioSink({ mediaElementBridge: true });
    sink.setRoute('direct');
    sink.setReadPhase('playing');
    sink.ensureAnalyserForTest(); // the first play() opens the context
    expect(analyser.connect).toHaveBeenLastCalledWith(ctx.destination);
    expect(FakeAudio.instances).toHaveLength(0);
    expect(sink.routeForTest()).toEqual({ route: 'direct', hasElement: false });
  });

  it('switching to direct mid-read reconnects only the analyser and pauses the element', async () => {
    const onElementPause = vi.fn();
    const sink = new AudioSink({ mediaElementBridge: true, onElementPause });
    sink.setReadPhase('playing');
    sink.setRoute('direct');
    expect(analyser.disconnect).toHaveBeenCalledTimes(1);
    expect(analyser.connect).toHaveBeenLastCalledWith(ctx.destination);
    expect(element()?.paused).toBe(true);
    await flush();
    expect(onElementPause).not.toHaveBeenCalled();
  });

  it('falls back to direct for a read whose play() is refused, and retries on the next read', async () => {
    FakeAudio.refuse = true;
    const sink = new AudioSink({ mediaElementBridge: true });
    sink.setReadPhase('playing');
    await flush();
    expect(sink.routeForTest().route).toBe('direct');
    expect(analyser.connect).toHaveBeenLastCalledWith(ctx.destination);

    // Pausing and resuming within the same read stays direct.
    sink.setReadPhase('paused');
    sink.setReadPhase('playing');
    expect(sink.routeForTest().route).toBe('direct');

    sink.setReadPhase('idle');
    expect(sink.routeForTest().route).toBe('bridge');
    FakeAudio.refuse = false;
    sink.setReadPhase('playing');
    await flush();
    expect(sink.routeForTest().route).toBe('bridge');
    expect(analyser.connect).toHaveBeenLastCalledWith(streamDest);
    expect(element()?.paused).toBe(false);
  });

  it('reports a platform pause once, and never its own pause', async () => {
    const onElementPause = vi.fn();
    const sink = new AudioSink({ mediaElementBridge: true, onElementPause });
    sink.setReadPhase('playing');
    await flush();

    // Our own pause, then a quick resume before the pause event lands.
    sink.setReadPhase('paused');
    sink.setReadPhase('playing');
    await flush();
    expect(onElementPause).not.toHaveBeenCalled();

    element()?.platformPause();
    await flush();
    expect(onElementPause).toHaveBeenCalledTimes(1);
    element()?.dispatchEvent(new Event('pause'));
    await flush();
    expect(onElementPause).toHaveBeenCalledTimes(1);
  });

  it('reports a platform play while paused, and takes the element back while idle', async () => {
    const onElementPlay = vi.fn();
    const sink = new AudioSink({ mediaElementBridge: true, onElementPlay });
    sink.setReadPhase('playing');
    sink.setReadPhase('paused');
    await flush();
    element()?.platformPlay();
    await flush();
    expect(onElementPlay).toHaveBeenCalledTimes(1);

    sink.setReadPhase('idle');
    await flush();
    element()?.platformPlay();
    await flush();
    expect(onElementPlay).toHaveBeenCalledTimes(1);
    expect(element()?.paused).toBe(true);
  });

  it('primes with a muted play then pause, without reporting either', async () => {
    const onElementPause = vi.fn();
    const onElementPlay = vi.fn();
    const sink = new AudioSink({ mediaElementBridge: true, onElementPause, onElementPlay });
    const played = vi.spyOn(FakeAudio.prototype, 'play');
    sink.primeBridge();
    expect(element()?.muted).toBe(true);
    await flush();
    await flush();
    expect(played).toHaveBeenCalledTimes(1);
    expect(element()?.paused).toBe(true);
    expect(element()?.muted).toBe(false);
    expect(onElementPause).not.toHaveBeenCalled();
    expect(onElementPlay).not.toHaveBeenCalled();
    // A context opened only to prime does not keep running idle.
    expect(ctx.suspend).toHaveBeenCalled();
    sink.primeBridge();
    expect(played).toHaveBeenCalledTimes(1);
    played.mockRestore();
  });

  it('retries priming on the next gesture after a refusal', async () => {
    FakeAudio.refuse = true;
    const sink = new AudioSink({ mediaElementBridge: true });
    const played = vi.spyOn(FakeAudio.prototype, 'play');
    sink.primeBridge();
    await flush();
    FakeAudio.refuse = false;
    sink.primeBridge();
    await flush();
    expect(played).toHaveBeenCalledTimes(2);
    played.mockRestore();
  });

  it('does not prime in live voice', () => {
    const sink = new AudioSink({ mediaElementBridge: true });
    sink.setRoute('direct');
    sink.primeBridge();
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it('dispose pauses the element and clears its source', async () => {
    const sink = new AudioSink({ mediaElementBridge: true });
    sink.setReadPhase('playing');
    const el = element();
    await sink.dispose();
    expect(el?.paused).toBe(true);
    expect(el?.srcObject).toBeNull();
    expect(ctx.close).toHaveBeenCalled();
  });
});
