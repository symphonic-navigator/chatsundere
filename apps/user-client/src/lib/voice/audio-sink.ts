// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Thin Web Audio wrapper for voice playback: decode an encoded audio blob,
 * play it, signal completion. Deliberately holds no queue and no state
 * machine — the XState voice machine owns all sequencing. Kept this thin
 * so that being untestable in jsdom (no real audio) is acceptable;
 * behaviour is covered by the spec's manual-verification steps.
 *
 * ## The media-element bridge (read-aloud only)
 * Platforms attach lock-screen and headset controls to media elements, not to
 * Web Audio output. With the bridge on, the analyser feeds a
 * `MediaStreamAudioDestinationNode` played by one hidden `<audio>` element
 * instead of `ctx.destination`; the filter chain, the analyser and the
 * sample-accurate pause stay exactly as they are. The element's play state
 * follows read-aloud's phase (set by the owner), never the sink's lifetime: a
 * `MediaStream` keeps flowing silence, so an element left playing would keep a
 * stale entry on the lock screen. With the bridge off, the graph is the
 * original direct one and no element is ever created.
 */
import { buildMonologueImpulse } from './monologue-reverb.js';
import type { VoiceFilterProfile } from './voice-filter.js';

/**
 * Master switch for the read-aloud bridge. Turning it off returns read-aloud to
 * the direct route everywhere and, with it, the Media Session hook registers
 * nothing (spec: "The bridge is separable, with a decision rule").
 */
export const READ_ALOUD_MEDIA_BRIDGE = false;

/** Test-only A/B override for one installed build; not a user setting. */
const BRIDGE_OVERRIDE_KEY = 'cs.readAloudBridge';

/** Whether read-aloud uses the media-element bridge: the constant, unless the test-only `cs.readAloudBridge` override (`on`/`off`) says otherwise. */
export function isReadAloudBridgeEnabled(): boolean {
  try {
    const override = globalThis.localStorage?.getItem(BRIDGE_OVERRIDE_KEY);
    if (override === 'on') return true;
    if (override === 'off') return false;
  } catch {
    // Storage blocked (private mode, sandboxed frame): the constant decides.
  }
  return READ_ALOUD_MEDIA_BRIDGE;
}

/** Where the analyser's output goes: through the media element, or straight to the speakers. */
export type OutputRoute = 'bridge' | 'direct';

/** Read-aloud's phase as the sink needs it: the element plays only while `playing`. */
export type ReadPhase = 'playing' | 'paused' | 'idle';

export interface AudioSinkOptions {
  /** Route through the hidden media element (read-aloud). Off: today's direct graph. */
  mediaElementBridge?: boolean;
  /** The platform paused the element while read-aloud was playing (lock screen, headset, audio focus). */
  onElementPause?: () => void;
  /** The platform played the element while read-aloud was paused. */
  onElementPlay?: () => void;
}

export class AudioSink {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  /** Filter nodes created for the current play, disconnected on stop/replace. */
  private chain: AudioNode[] = [];

  private readonly bridgeEnabled: boolean;
  private readonly onElementPause: (() => void) | undefined;
  private readonly onElementPlay: (() => void) | undefined;
  private requestedRoute: OutputRoute;
  /** This read's bridged play() was refused: it finishes on the direct route. */
  private fellBack = false;
  private phase: ReadPhase = 'idle';
  private streamDest: MediaStreamAudioDestinationNode | null = null;
  private element: HTMLAudioElement | null = null;
  /** The node the analyser currently feeds, so a re-route only touches that one edge. */
  private output: AudioNode | null = null;
  private priming = false;
  private primed = false;
  /**
   * Our own play()/pause() calls whose `play`/`pause` events are still queued.
   * The events arrive a task later, by which time the wanted state may already
   * have flipped back, so comparing against the wanted state alone would read
   * our own echo as the platform acting.
   */
  private ownPlays = 0;
  private ownPauses = 0;

  constructor(opts: AudioSinkOptions = {}) {
    this.bridgeEnabled = opts.mediaElementBridge ?? false;
    this.onElementPause = opts.onElementPause;
    this.onElementPlay = opts.onElementPlay;
    this.requestedRoute = this.bridgeEnabled ? 'bridge' : 'direct';
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256; // matches the ported bucketing constants
      this.connectOutput();
    }
    return this.ctx;
  }

  private effectiveRoute(): OutputRoute {
    return this.bridgeEnabled && this.requestedRoute === 'bridge' && !this.fellBack
      ? 'bridge'
      : 'direct';
  }

  /** Point the analyser at the current route. Only the analyser's output edge changes. */
  private connectOutput(): void {
    const ctx = this.ctx;
    const analyser = this.analyser;
    if (!ctx || !analyser) return;
    const target: AudioNode =
      this.effectiveRoute() === 'bridge' ? this.ensureBridge(ctx) : ctx.destination;
    if (this.output === target) return;
    if (this.output) analyser.disconnect();
    analyser.connect(target);
    this.output = target;
  }

  /** The stream destination and its element, created on the first bridged connect. */
  private ensureBridge(ctx: AudioContext): MediaStreamAudioDestinationNode {
    if (!this.streamDest) {
      this.streamDest = ctx.createMediaStreamDestination();
      // Never attached to the DOM: a detached element plays a MediaStream and
      // still claims the platform's media session.
      const element = new Audio();
      element.srcObject = this.streamDest.stream;
      element.addEventListener('play', this.handleElementPlay);
      element.addEventListener('pause', this.handleElementPause);
      this.element = element;
    }
    return this.streamDest;
  }

  private wantsElementPlaying(): boolean {
    return this.phase === 'playing' && this.effectiveRoute() === 'bridge';
  }

  private playElement(element: HTMLAudioElement): Promise<void> {
    const wasPaused = element.paused;
    let result: Promise<void> | undefined;
    try {
      result = element.play();
    } catch (error) {
      result = Promise.reject(error);
    }
    // play() flips `paused` synchronously when it is allowed; only then is a
    // `play` event on its way.
    if (wasPaused && !element.paused) this.ownPlays += 1;
    return Promise.resolve(result);
  }

  private pauseElement(element: HTMLAudioElement): void {
    if (element.paused) return;
    element.pause();
    this.ownPauses += 1;
  }

  /** Bring the element's play state in line with the phase and the route. */
  private applyElement(): void {
    const element = this.element;
    if (!element) return;
    if (this.wantsElementPlaying()) {
      element.muted = false;
      if (element.paused) {
        this.playElement(element).catch((error: unknown) => this.onBridgeRefused(error));
      }
    } else if (!this.priming) {
      this.pauseElement(element);
    }
  }

  private onBridgeRefused(error: unknown): void {
    // An AbortError is our own pause() overtaking a pending play(), not a refusal.
    if (error instanceof Error && error.name === 'AbortError') return;
    if (!this.wantsElementPlaying()) return;
    // Refused (autoplay policy, an old browser): this read finishes direct,
    // without platform controls. setReadPhase('idle') clears it for the next read.
    this.fellBack = true;
    this.connectOutput();
  }

  private readonly handleElementPlay = (): void => {
    if (this.ownPlays > 0) {
      this.ownPlays -= 1;
      return;
    }
    if (this.wantsElementPlaying()) return;
    if (this.phase === 'paused' && this.effectiveRoute() === 'bridge') {
      this.phase = 'playing';
      this.onElementPlay?.();
      return;
    }
    // Played while idle or on the direct route: nothing to resume, and an
    // element left playing silence would surface a stale entry. Take it back.
    if (this.element) this.pauseElement(this.element);
  };

  private readonly handleElementPause = (): void => {
    if (this.ownPauses > 0) {
      this.ownPauses -= 1;
      return;
    }
    if (!this.wantsElementPlaying()) return;
    // Mirror it locally at once, so a further stray event cannot report it twice
    // before the owner's phase catches up.
    this.phase = 'paused';
    this.onElementPause?.();
  };

  /** Choose the output route; the live-voice owner forces `direct`. A no-op with the bridge off. */
  setRoute(route: OutputRoute): void {
    if (!this.bridgeEnabled || this.requestedRoute === route) return;
    this.requestedRoute = route;
    this.connectOutput();
    this.applyElement();
  }

  /** Tell the sink read-aloud's phase; the element plays only while `playing` on the bridge. */
  setReadPhase(phase: ReadPhase): void {
    if (!this.bridgeEnabled) return;
    this.phase = phase;
    // A new read tries the bridge again, whatever the last one met.
    if (phase === 'idle') this.fellBack = false;
    if (this.wantsElementPlaying()) this.ensureCtx();
    this.connectOutput();
    this.applyElement();
  }

  /**
   * Unlock the element for later play() calls: a muted play() then pause, from
   * a user gesture (iOS and Chrome allow element playback only from or after
   * one). Idempotent once it has succeeded; retried on the next gesture if not.
   */
  primeBridge(): void {
    if (!this.bridgeEnabled || this.requestedRoute !== 'bridge') return;
    if (this.primed || this.priming) return;
    const ctx = this.ensureCtx();
    const element = this.element;
    if (!element) return;
    if (!element.paused) {
      this.primed = true;
      return;
    }
    this.priming = true;
    element.muted = true;
    this.playElement(element)
      .then(
        () => {
          this.primed = true;
        },
        () => {
          // Refused outside a gesture: the next gesture tries again.
        },
      )
      .finally(() => {
        this.priming = false;
        if (this.element !== element) return; // disposed meanwhile
        element.muted = false;
        if (this.wantsElementPlaying()) return;
        this.pauseElement(element);
        // A context opened only to prime should not keep running idle.
        if (this.phase === 'idle' && this.source === null && ctx.state === 'running') {
          void ctx.suspend();
        }
      });
  }

  /** Test-only view of where the analyser feeds and whether an element exists. */
  routeForTest(): { route: OutputRoute; hasElement: boolean } {
    return { route: this.effectiveRoute(), hasElement: this.element !== null };
  }

  /** The playback analyser, or null before the first play() creates the context. */
  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  /** Whether a source is currently sounding — true between source.start() and its
   *  end/stop. Frame-safe (synchronous, allocation-free): the spectrum reads this
   *  every animation frame to choose the synthetic wave vs real FFT. */
  isAudible(): boolean {
    return this.source !== null;
  }

  /** Test-only seam: force context+analyser creation without decoding audio. */
  ensureAnalyserForTest(): void {
    this.ensureCtx();
  }

  /**
   * Build the profile's node chain between the source and the analyser. Returns
   * the node the source connects INTO. Created nodes are tracked on `this.chain`
   * so stop()/dispose() can disconnect them. The 'monologue' branch is wired in
   * a later task; until then it behaves as plain.
   */
  private buildChain(ctx: AudioContext, profile: VoiceFilterProfile, sink: AudioNode): AudioNode {
    this.chain = [];
    if (profile.kind === 'highpass') {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = profile.hz;
      hp.Q.value = Math.SQRT1_2; // Butterworth — gentle 12 dB/octave, not steep
      hp.connect(sink);
      this.chain.push(hp);
      return hp;
    }
    if (profile.kind === 'monologue') {
      // Ethereal / otherworldly: thin the low end, then split into a dry path and
      // a reverberant wet path summed back together (60/40). Device-tuned values
      // (see the 2026-06-17 audio spec §4.5).
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 280;
      hp.Q.value = 0.7;

      const dry = ctx.createGain();
      dry.gain.value = 0.6;

      const wet = ctx.createGain();
      wet.gain.value = 0.4;

      const convolver = ctx.createConvolver();
      convolver.buffer = buildMonologueImpulse(ctx);

      hp.connect(dry);
      dry.connect(sink);
      hp.connect(convolver);
      convolver.connect(wet);
      wet.connect(sink);

      this.chain.push(hp, dry, wet, convolver);
      return hp;
    }
    return sink; // 'plain'
  }

  /**
   * Decode and play the blob; resolves when playback of this blob ends
   * (or immediately on abort). Rejects on decode failure so the caller
   * can evict a poisoned cache entry and re-synthesise.
   */
  async play(
    blob: Blob,
    opts: { profile: VoiceFilterProfile; signal?: AbortSignal },
  ): Promise<void> {
    const { profile, signal } = opts;
    this.stop();
    const ctx = this.ensureCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (signal?.aborted) return;
    return new Promise<void>((resolve) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const sink: AudioNode = this.analyser ?? ctx.destination;
      source.connect(this.buildChain(ctx, profile, sink));

      const abortHandler = () => {
        source.onended = null;
        try {
          source.stop();
        } catch {
          // already stopped
        }
        if (this.source === source) this.source = null;
        resolve();
      };

      source.onended = () => {
        if (signal) signal.removeEventListener('abort', abortHandler);
        if (this.source === source) this.source = null;
        resolve();
      };

      this.source = source;
      signal?.addEventListener('abort', abortHandler, { once: true });
      source.start();
    });
  }

  /** Sample-accurate freeze — resume continues mid-word (AudioContext.suspend). */
  async pause(): Promise<void> {
    if (this.ctx?.state === 'running') await this.ctx.suspend();
  }

  /** Continue exactly where pause() froze. */
  async resume(): Promise<void> {
    if (this.ctx?.state === 'suspended') await this.ctx.resume();
  }

  /**
   * Hard-stop the current source. The in-flight play() promise is abandoned
   * (neither resolved nor rejected) — only call stop() when the owning actor
   * is being torn down and the dangling promise will be GC'd. The XState voice
   * machine satisfies this contract: it cancels the invoked actor on exit,
   * so the promise lifetime is bounded by the actor lifetime. Callers outside
   * the machine should use the AbortSignal passed to play() instead, which
   * resolves the promise cleanly.
   */
  stop(): void {
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        // already stopped
      }
      this.source = null;
    }
    for (const node of this.chain) node.disconnect();
    this.chain = [];
  }

  /** Release the AudioContext entirely (component unmount). */
  async dispose(): Promise<void> {
    this.stop();
    const element = this.element;
    if (element) {
      element.removeEventListener('play', this.handleElementPlay);
      element.removeEventListener('pause', this.handleElementPause);
      if (!element.paused) element.pause();
      element.srcObject = null;
      this.element = null;
      this.streamDest = null;
    }
    this.output = null;
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
      this.analyser = null;
    }
  }
}
