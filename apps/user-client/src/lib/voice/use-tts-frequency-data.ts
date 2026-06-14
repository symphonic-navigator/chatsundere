// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react';
import { bucketIntoLogBins } from './visualiser-bucketing.js';
import { applySpectralTilt } from './visualiser-tilt.js';

const SMOOTHING = 0.28;

interface FrequencyAccessors {
  /** Reads current frequency bins, log-bucketed and smoothed. Null if no analyser yet. */
  getBins(): Float32Array | null;
}

/**
 * Hook bridging a TTS `AnalyserNode` (supplied via an accessor) to log-bucketed,
 * smoothed frequency bins. The returned accessor object has a stable reference
 * across renders — closures read the current `barCount` and `getAnalyser` via
 * internal refs so we don't need to recreate them, which would force consumers'
 * effects to tear down and restart their RAF loops on every parent render.
 */
export function useTtsFrequencyData(
  barCount: number,
  getAnalyser: () => AnalyserNode | null,
): FrequencyAccessors {
  // Explicit ArrayBuffer parameterisation — `getByteFrequencyData` rejects
  // the default `Uint8Array<ArrayBufferLike>` because that union includes
  // `SharedArrayBuffer`, which the Web Audio API does not accept here.
  const rawBuffer = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(128));
  const smoothed = useRef<Float32Array>(new Float32Array(barCount));
  const barCountRef = useRef(barCount);

  // Keep getAnalyser current without recreating the stable accessor.
  const getAnalyserRef = useRef(getAnalyser);
  getAnalyserRef.current = getAnalyser;

  // Keep the buffer + ref in sync with the latest barCount on render. This
  // does not affect the stable reference returned below.
  if (barCountRef.current !== barCount) {
    barCountRef.current = barCount;
    if (smoothed.current.length !== barCount) {
      smoothed.current = new Float32Array(barCount);
    }
  }

  // Belt-and-braces: also resize on effect, in case a consumer re-renders
  // without going through the synchronous path above (e.g. StrictMode).
  useEffect(() => {
    barCountRef.current = barCount;
    if (smoothed.current.length !== barCount) {
      smoothed.current = new Float32Array(barCount);
    }
  }, [barCount]);

  // Initialised once per component lifetime — closures read refs, so this
  // object's identity is stable across renders.
  const accessorsRef = useRef<FrequencyAccessors | null>(null);
  if (accessorsRef.current === null) {
    accessorsRef.current = {
      getBins: () => {
        const analyser = getAnalyserRef.current();
        if (!analyser) return null;
        const bc = barCountRef.current;
        if (rawBuffer.current.length !== analyser.frequencyBinCount) {
          rawBuffer.current = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(rawBuffer.current);
        const target = bucketIntoLogBins(
          rawBuffer.current,
          analyser.context.sampleRate,
          analyser.fftSize,
          bc,
        );
        // Compensate speech's bass-heavy spectrum so the low bars stop
        // saturating while the treble bars sit dead. Real bins only — the
        // idle-noise field is already flat.
        applySpectralTilt(target);
        const out = smoothed.current;
        for (let i = 0; i < bc; i++) {
          out[i] = (out[i] ?? 0) + ((target[i] ?? 0) - (out[i] ?? 0)) * SMOOTHING;
        }
        return out;
      },
    };
  }

  return accessorsRef.current;
}
