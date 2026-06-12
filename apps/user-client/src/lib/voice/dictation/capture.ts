// SPDX-License-Identifier: AGPL-3.0-only

// Ported from chatsune's audioCapture.ts. The class-singleton shape and the
// session-counter race guards are kept verbatim — they encode device-found
// bugs (orphan VAD after async MicVAD.new, stale recorder-chunk arrays,
// teardown ordering so MediaRecorder flushes before tracks die).

import { MicVAD } from '@ricky0123/vad-web';
import { createRecorder, pickRecordingMimeType } from './audio-recording.js';
import { VAD_PRESETS, type VadSensitivity } from './vad-presets.js';
import { float32ToWavBlob } from './wav-encoder.js';

/** One captured utterance, ready for STT upload. */
export interface CapturedAudio {
  /** Raw 16 kHz mono PCM from the capture path. */
  pcm: Float32Array;
  /** Upload-ready payload: Opus/AAC when available, WAV fallback otherwise. */
  blob: Blob;
  mimeType: string;
  /** 0 = container-embedded (MediaRecorder); 16000 for the WAV path. */
  sampleRate: number;
  durationMs: number;
}

export interface AudioCaptureCallbacks {
  onSpeechStart: () => void;
  /**
   * Fired when a captured utterance is ready. `audio.pcm` is the raw 16 kHz
   * mono Float32 stream from VAD/ScriptProcessor; `audio.blob` is the
   * upload-ready payload (compressed Opus/AAC when available, WAV when
   * falling back to Tier 3).
   */
  onSpeechEnd: (audio: CapturedAudio) => void;
  onVolumeChange: (level: number) => void;
  /**
   * Continuous/VAD mode only: fired when a speech-start was a false positive
   * (noise burst too short to count as speech). Silero does NOT fire
   * onSpeechEnd in this case, so callers that optimistically transitioned to
   * "user-speaking" on speech-start need this to revert their state.
   */
  onMisfire?: () => void;
}

export interface StartContinuousOptions {
  sensitivity: VadSensitivity;
  /** VAD redemption window in ms. Resolved by the caller from settings. */
  redemptionMs: number;
}

// vad-web bundles its own onnxruntime-web (pnpm resolves ^1.17.0 → 1.26.0
// here, isolated by pnpm). We cannot configure that internal ORT instance
// from outside, so vad-web loads ONNX Runtime WASM + the VAD model from CDN
// instead (Vite blocks .mjs from public/). The CDN pin of 1.22.0 is
// deliberately NOT the lockfile-resolved version: it is the known-good WASM
// set proven on device by the chatsune reference deployment.
//
// baseAssetPath: used for both the VAD model AND the AudioWorklet JS
// onnxWASMBasePath: used for ONNX Runtime .wasm + .mjs files
//
// ~14 MB total (WASM + model) — browser-cached after first load.
// Only engine code is fetched — no voice data leaves the browser.
const ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
const VAD_CDN = 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/';

// Target sample rate for VAD-path PCM. MediaRecorder records at the
// browser's native rate (typically 48 kHz), but the PCM we build the
// Tier-3 WAV from comes from the 16 kHz AudioContext.
const VAD_SAMPLE_RATE = 16_000;

class AudioCaptureImpl {
  // -- shared state --
  private callbacks: AudioCaptureCallbacks | null = null;
  private analyser: AnalyserNode | null = null;
  private animFrameId: number | null = null;

  // -- PTT state --
  private pttContext: AudioContext | null = null;
  private pttStream: MediaStream | null = null;
  private pttProcessor: ScriptProcessorNode | null = null;
  private pttChunks: Float32Array[] = [];
  private pttStartedAt = 0;
  private pttSession = 0; // incremented on each start, checked after await
  private pttRecorder: MediaRecorder | null = null;
  private pttRecorderMime: string | null = null;
  private pttRecorderChunks: Blob[] = [];

  // -- VAD (continuous) state --
  private vad: MicVAD | null = null;
  private vadSession = 0; // incremented on each start/stop, checked after await MicVAD.new
  private vadContext: AudioContext | null = null;
  private vadStream: MediaStream | null = null;
  private vadRecorder: MediaRecorder | null = null;
  private vadRecorderMime: string | null = null;
  private vadRecorderChunks: Blob[] = [];
  private vadSegmentStartedAt = 0;
  // True from the moment a VAD speech-end (or stop-flush) finalise begins
  // until its snapshotted callback has delivered — the MediaRecorder's
  // 'stop' event is async, so the utterance is in flight but no longer
  // visible via vadRecorder during that window.
  private vadDeliveryPending = false;

  /**
   * Push-to-talk: record raw audio from mic. No VAD needed.
   * Call stopPTT() to get the recorded audio via onSpeechEnd.
   *
   * Must not be called while startContinuous is running — the dictation
   * machine enforces single-mode capture. A getUserMedia rejection propagates
   * to the caller, which is expected to classify it (permission vs device).
   */
  async startPTT(callbacks: AudioCaptureCallbacks): Promise<void> {
    this.callbacks = callbacks;
    this.pttChunks = [];
    this.pttRecorderChunks = [];
    const session = ++this.pttSession;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    // If stopPTT was called while we were awaiting getUserMedia, abort
    if (session !== this.pttSession) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }

    this.pttStream = stream;
    this.pttContext = new AudioContext({ sampleRate: VAD_SAMPLE_RATE });
    const source = this.pttContext.createMediaStreamSource(this.pttStream);

    // Collect raw PCM samples
    this.pttProcessor = this.pttContext.createScriptProcessor(4096, 1, 1);
    this.pttProcessor.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      this.pttChunks.push(new Float32Array(data));
    };
    source.connect(this.pttProcessor);
    this.pttProcessor.connect(this.pttContext.destination);

    // Volume meter
    this.analyser = this.pttContext.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);
    this.startVolumeMeter();

    // Parallel compressed recording. If no supported MIME type, fall
    // through to Tier-3 WAV at stop() time.
    //
    // Bind the chunk array as a closure variable rather than reading
    // `this.pttRecorderChunks` inside the callback. `recorder.stop()`
    // delivers its final `dataavailable` event asynchronously, after
    // stopPTT() has already moved the instance field into a local
    // reference; reading `this` at that point would write into a stale
    // array and produce an empty blob (triggering the WAV fallback).
    this.pttRecorderMime = pickRecordingMimeType();
    if (this.pttRecorderMime) {
      try {
        this.pttRecorder = createRecorder(stream, this.pttRecorderMime);
        const chunks = this.pttRecorderChunks;
        this.pttRecorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) chunks.push(ev.data);
        };
        this.pttRecorder.start();
      } catch (err) {
        console.warn('[capture] MediaRecorder start failed, falling back to WAV:', err);
        this.pttRecorder = null;
        this.pttRecorderMime = null;
      }
    }

    this.pttStartedAt = performance.now();
    callbacks.onSpeechStart();
  }

  /**
   * Stop PTT recording. Concatenates all chunks and delivers via onSpeechEnd.
   * Always calls onSpeechEnd (with empty audio if nothing was recorded).
   *
   * Teardown order matters: the MediaRecorder must be allowed to flush its
   * final `dataavailable` + `stop` events BEFORE the MediaStream tracks and
   * AudioContext nodes go away. If the tracks die first, Chrome emits an
   * empty final chunk and we fall back to WAV — which defeats the whole
   * parallel-recording pipeline. `teardown()` is idempotent and is invoked
   * from every terminal branch exactly once, after the recorder is done.
   */
  stopPTT(): void {
    this.pttSession++; // invalidate any in-flight startPTT
    this.stopVolumeMeter();
    const cb = this.callbacks;

    // Concatenate recorded PCM chunks
    const totalLength = this.pttChunks.reduce((sum, c) => sum + c.length, 0);
    const pcm = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of this.pttChunks) {
      pcm.set(chunk, offset);
      offset += chunk.length;
    }
    this.pttChunks = [];
    const durationMs = Math.max(0, performance.now() - this.pttStartedAt);

    const recorder = this.pttRecorder;
    const mime = this.pttRecorderMime;
    const chunks = this.pttRecorderChunks;
    const stream = this.pttStream;
    this.pttRecorder = null;
    this.pttRecorderMime = null;
    this.pttRecorderChunks = [];
    this.pttStream = null;
    this.callbacks = null;

    let tornDown = false;
    const teardown = (): void => {
      if (tornDown) return;
      tornDown = true;
      this.pttProcessor?.disconnect();
      this.pttProcessor = null;
      if (stream) {
        for (const track of stream.getTracks()) track.stop();
      }
      this.pttContext?.close();
      this.pttContext = null;
      this.analyser = null;
    };

    const deliver = (blob: Blob, mimeType: string, sampleRate: number): void => {
      cb?.onSpeechEnd({ pcm, blob, mimeType, sampleRate, durationMs });
    };

    // If a Tier-1/2 recorder was running, wait for its final dataavailable
    // via onstop before tearing down the stream and building the bundle.
    // Otherwise derive WAV from PCM immediately.
    if (recorder && mime) {
      const finalise = (): void => {
        const blob = new Blob(chunks, { type: mime });
        teardown();
        if (blob.size > 0) {
          // MediaRecorder doesn't reliably expose its actual sample rate;
          // report 0 to signal "server-negotiated / container-embedded".
          deliver(blob, mime, 0);
        } else {
          // Recorder produced no bytes (very short PTT). Fall back to WAV
          // so the STT engine still gets something to chew on.
          deliver(float32ToWavBlob(pcm, VAD_SAMPLE_RATE), 'audio/wav', VAD_SAMPLE_RATE);
        }
      };
      recorder.addEventListener('stop', finalise, { once: true });
      try {
        if (recorder.state !== 'inactive') recorder.stop();
        else finalise();
      } catch {
        finalise();
      }
    } else {
      teardown();
      deliver(float32ToWavBlob(pcm, VAD_SAMPLE_RATE), 'audio/wav', VAD_SAMPLE_RATE);
    }
  }

  /**
   * Continuous mode: use VAD to detect speech start/end automatically.
   * Call stopContinuous() to tear down.
   *
   * Must not be called while startPTT is running — the dictation machine
   * enforces single-mode capture. A getUserMedia/MicVAD failure propagates
   * to the caller, which is expected to classify it (permission vs device).
   */
  async startContinuous(
    callbacks: AudioCaptureCallbacks,
    options: StartContinuousOptions,
  ): Promise<void> {
    this.callbacks = callbacks;

    // Snapshot the in-flight session BEFORE awaiting MicVAD.new — first-load
    // ONNX/WASM downloads can take 0.5–2 s, during which stopContinuous may
    // arrive and bump the counter to invalidate this run.
    const session = ++this.vadSession;
    console.info(
      '[capture] startContinuous session=%d sensitivity=%s',
      session,
      options.sensitivity,
    );

    let capturedStream: MediaStream | null = null;
    const getStream = async (): Promise<MediaStream> => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      capturedStream = stream;
      return stream;
    };

    // vad-web 0.0.30 exposes redemption / min-speech durations as *Ms, not
    // *Frames, on its public API. The presets are authored in frames for
    // readability; convert here. Default Silero model is "legacy" → 1536
    // samples per frame at 16 kHz ⇒ 96 ms per frame.
    const preset = VAD_PRESETS[options.sensitivity];
    const MS_PER_FRAME = 96;

    const vad = await MicVAD.new({
      getStream,
      onnxWASMBasePath: ORT_CDN,
      baseAssetPath: VAD_CDN,
      positiveSpeechThreshold: preset.positiveSpeechThreshold,
      negativeSpeechThreshold: preset.negativeSpeechThreshold,
      minSpeechMs: preset.minSpeechFrames * MS_PER_FRAME,
      redemptionMs: options.redemptionMs,
      onSpeechStart: () => {
        this.handleVadSpeechStart();
      },
      onSpeechEnd: (audio: Float32Array) => {
        this.handleVadSpeechEnd(audio);
      },
      onVADMisfire: () => {
        this.handleVadMisfire();
      },
    });

    // If stopContinuous (or another startContinuous) ran while MicVAD.new was
    // resolving, this VAD is orphaned — nothing in the app references it.
    // Tear it down locally without touching this.* fields (already cleared).
    if (session !== this.vadSession) {
      try {
        vad.pause();
      } catch {
        /* ignore */
      }
      try {
        vad.destroy();
      } catch {
        /* ignore */
      }
      if (capturedStream) {
        for (const track of (capturedStream as MediaStream).getTracks()) track.stop();
      }
      console.warn(
        '[capture] Discarded orphan VAD (session=%d, current=%d)',
        session,
        this.vadSession,
      );
      return;
    }

    this.vad = vad;

    if (capturedStream) {
      this.vadStream = capturedStream;
      this.vadContext = new AudioContext();
      const source = this.vadContext.createMediaStreamSource(capturedStream);
      this.analyser = this.vadContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);
      this.startVolumeMeter();
    }

    await this.vad.start();
  }

  private handleVadSpeechStart(): void {
    this.vadSegmentStartedAt = performance.now();
    if (this.vadStream) {
      const mime = pickRecordingMimeType();
      this.vadRecorderMime = mime;
      this.vadRecorderChunks = [];
      if (mime) {
        try {
          this.vadRecorder = createRecorder(this.vadStream, mime);
          // Bind the chunk array in a closure — see the matching PTT
          // path for the rationale; without this, the final async
          // dataavailable event writes into a reset instance field.
          const chunks = this.vadRecorderChunks;
          this.vadRecorder.ondataavailable = (ev) => {
            if (ev.data && ev.data.size > 0) chunks.push(ev.data);
          };
          this.vadRecorder.start();
        } catch (err) {
          console.warn('[capture] VAD MediaRecorder start failed:', err);
          this.vadRecorder = null;
          this.vadRecorderMime = null;
        }
      }
    }
    this.callbacks?.onSpeechStart();
  }

  private handleVadSpeechEnd(pcm: Float32Array): void {
    const cb = this.callbacks;
    const durationMs = Math.max(0, performance.now() - this.vadSegmentStartedAt);
    this.vadDeliveryPending = true;

    const deliver = (blob: Blob, mimeType: string, sampleRate: number): void => {
      this.vadDeliveryPending = false;
      cb?.onSpeechEnd({ pcm, blob, mimeType, sampleRate, durationMs });
    };

    const recorder = this.vadRecorder;
    const mime = this.vadRecorderMime;
    const chunks = this.vadRecorderChunks;
    this.vadRecorder = null;
    this.vadRecorderMime = null;
    this.vadRecorderChunks = [];

    if (recorder && mime) {
      const finalise = (): void => {
        const blob = new Blob(chunks, { type: mime });
        if (blob.size > 0) {
          deliver(blob, mime, 0);
        } else {
          deliver(float32ToWavBlob(pcm, VAD_SAMPLE_RATE), 'audio/wav', VAD_SAMPLE_RATE);
        }
      };
      recorder.addEventListener('stop', finalise, { once: true });
      try {
        if (recorder.state !== 'inactive') recorder.stop();
        else finalise();
      } catch {
        finalise();
      }
    } else {
      deliver(float32ToWavBlob(pcm, VAD_SAMPLE_RATE), 'audio/wav', VAD_SAMPLE_RATE);
    }
  }

  private handleVadMisfire(): void {
    // Drop the recorder silently — no utterance to deliver.
    const recorder = this.vadRecorder;
    this.vadRecorder = null;
    this.vadRecorderMime = null;
    this.vadRecorderChunks = [];
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    this.callbacks?.onMisfire?.();
  }

  /**
   * True while a VAD utterance exists that has not been delivered yet:
   * either the per-segment recorder is rolling (speech started, redemption
   * window not yet elapsed) or a speech-end finalise has begun but its async
   * delivery is still deferred behind the MediaRecorder's 'stop' event.
   *
   * Tier-3 limitation (no MediaRecorder): there is no recorded audio
   * mid-segment by construction — the PCM only materialises when Silero
   * hands it over at speech-end — so this reports false and a stop-tap
   * cannot flush a tier-3 utterance.
   */
  hasInFlightUtterance(): boolean {
    if (this.vadDeliveryPending) return true;
    return this.vadRecorder !== null && this.vadRecorder.state === 'recording';
  }

  /**
   * Stop continuous (VAD) recording.
   *
   * If a VAD segment is mid-recording, the user's stop-tap ENDS that
   * utterance: it is finalised and delivered via the snapshotted callbacks —
   * flushing it is the no-silent-loss rule (spec §6 / D16). Silero only
   * fires speech-end after the redemption window, so tap-right-after-speaking
   * (the NORMAL gesture) always lands here with the segment still in flight;
   * discarding it would lose almost every single-utterance dictation.
   */
  stopContinuous(): void {
    // Bump first so any in-flight startContinuous awaiting MicVAD.new sees
    // an invalidated session when it resolves and cleans up its own VAD.
    this.vadSession++;
    this.stopVolumeMeter();

    const cb = this.callbacks;
    const vad = this.vad;
    const context = this.vadContext;
    const recorder = this.vadRecorder;
    const mime = this.vadRecorderMime;
    const chunks = this.vadRecorderChunks;
    this.vad = null;
    this.vadRecorder = null;
    this.vadRecorderMime = null;
    this.vadRecorderChunks = [];
    this.vadStream = null;
    this.vadContext = null;
    this.analyser = null;
    this.callbacks = null;

    // Pause inference immediately (no further speech events), but defer the
    // track-killing destroy until the recorder has flushed — same
    // teardown-order lesson as stopPTT: the final `dataavailable` must land
    // BEFORE the MediaStream tracks die, or Chrome emits an empty chunk.
    try {
      vad?.pause();
    } catch {
      /* ignore */
    }
    const teardown = (): void => {
      try {
        vad?.destroy();
      } catch {
        /* ignore */
      }
      context?.close();
    };

    if (recorder && mime && recorder.state !== 'inactive') {
      // Mirror handleVadSpeechEnd's finalise: stop → async 'stop' event →
      // build the blob from the closure-bound chunks → deliver. There is no
      // Silero PCM (speech-end never fired), so pcm is empty; the bridge
      // only consumes blob + mimeType.
      const durationMs = Math.max(0, performance.now() - this.vadSegmentStartedAt);
      this.vadDeliveryPending = true;
      const finalise = (): void => {
        const blob = new Blob(chunks, { type: mime });
        teardown();
        this.vadDeliveryPending = false;
        if (blob.size > 0) {
          cb?.onSpeechEnd({
            pcm: new Float32Array(0),
            blob,
            mimeType: mime,
            sampleRate: 0,
            durationMs,
          });
        } else {
          // Zero bytes recorded: deliver a silent WAV instead — Mistral
          // handles silent audio (empty transcript, which the emit layer
          // drops), mirroring stopPTT's always-deliver contract so the
          // machine's drain always settles.
          cb?.onSpeechEnd({
            pcm: new Float32Array(0),
            blob: float32ToWavBlob(new Float32Array(0)),
            mimeType: 'audio/wav',
            sampleRate: VAD_SAMPLE_RATE,
            durationMs,
          });
        }
      };
      recorder.addEventListener('stop', finalise, { once: true });
      try {
        recorder.stop();
      } catch {
        finalise();
      }
    } else {
      // No segment in flight (or the recorder already stopped — a deferred
      // speech-end finalise still owns its own delivery via its snapshotted
      // callback and is untouched by this teardown).
      teardown();
    }
  }

  // -- Volume meter (shared) --

  private startVolumeMeter(): void {
    if (!this.analyser || !this.callbacks) return;
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    const tick = () => {
      if (!this.analyser) return;
      this.analyser.getByteFrequencyData(dataArray);
      const sum = dataArray.reduce((a, b) => a + b, 0);
      const level = sum / (dataArray.length * 255);
      this.callbacks?.onVolumeChange(level);
      this.animFrameId = requestAnimationFrame(tick);
    };
    this.animFrameId = requestAnimationFrame(tick);
  }

  private stopVolumeMeter(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }
}

export const audioCapture = new AudioCaptureImpl();

/**
 * Named export of the implementation class so that unit tests can instantiate
 * isolated instances (rather than sharing the module-level singleton).
 */
export { AudioCaptureImpl as AudioCapture };
