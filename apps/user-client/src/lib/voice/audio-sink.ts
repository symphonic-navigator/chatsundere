/**
 * Thin Web Audio wrapper for voice playback: decode an encoded audio blob,
 * play it, signal completion. Deliberately holds no queue and no state
 * machine — the XState voice machine owns all sequencing. Kept this thin
 * so that being untestable in jsdom (no real audio) is acceptable;
 * behaviour is covered by the spec's manual-verification steps.
 */
export class AudioSink {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;

  private ensureCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  /**
   * Decode and play the blob; resolves when playback of this blob ends
   * (or immediately on abort). Rejects on decode failure so the caller
   * can evict a poisoned cache entry and re-synthesise.
   */
  async play(blob: Blob, signal?: AbortSignal): Promise<void> {
    // Defensive eviction — the machine never double-plays, but a stale source must not keep sounding if it ever does.
    this.stop();
    const ctx = this.ensureCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (signal?.aborted) return;
    return new Promise<void>((resolve) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

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
  }

  /** Release the AudioContext entirely (component unmount). */
  async dispose(): Promise<void> {
    this.stop();
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
    }
  }
}
