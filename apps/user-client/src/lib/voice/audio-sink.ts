/**
 * Thin Web Audio wrapper for voice playback: decode an encoded audio blob,
 * play it, signal completion. Deliberately holds no queue and no state
 * machine — the XState voice machine owns all sequencing. Kept this thin
 * so that being untestable in jsdom (no real audio) is acceptable;
 * behaviour is covered by the spec's manual-verification steps.
 */
import { buildMonologueImpulse } from './monologue-reverb.js';
import type { VoiceFilterProfile } from './voice-filter.js';

export class AudioSink {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  /** Filter nodes created for the current play, disconnected on stop/replace. */
  private chain: AudioNode[] = [];

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256; // matches the ported bucketing constants
      this.analyser.connect(this.ctx.destination);
    }
    return this.ctx;
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
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
      this.analyser = null;
    }
  }
}
