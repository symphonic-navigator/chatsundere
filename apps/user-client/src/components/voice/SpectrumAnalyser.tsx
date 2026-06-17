// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef } from 'react';
import { useSettings } from '../../data/settings.js';
import { SPECTRUM_DEFAULTS } from '../../lib/voice/spectrum-settings.js';
import { useAnalyserBounds } from '../../lib/voice/use-analyser-bounds.js';
import { useTtsFrequencyData } from '../../lib/voice/use-tts-frequency-data.js';
import { fillNoiseBins } from '../../lib/voice/visualiser-noise.js';
import { drawVisualiserFrame } from '../../lib/voice/visualiser-renderers.js';
import type { TransportState } from '../../lib/voice/voice-machine.js';
import { useMindspaceStore } from '../../state/mindspace.store.js';

/** Hard-coded fraction of viewport height occupied by total deflection. Taller than chatsune (0.28) per Spec §6. */
const MAX_HEIGHT_FRACTION = 0.36;
/** Per-frame easing rate for the visibility envelope. ~50 ms ramp at 60 Hz. */
const FADE_RATE = 0.05;

interface Props {
  transportState: TransportState;
  getAnalyser: () => AnalyserNode | null;
  /**
   * True while live voice is on the persona's thinking floor — the reply is
   * being generated and no audio plays yet (transport is idle). The analyser
   * fills this silence with the same synthetic "waiting" wave, so the pause
   * while the persona/TTS prepares reads as live presence, not a dead screen.
   */
  personaThinking?: boolean;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

function brighten([r, g, b]: [number, number, number]): [number, number, number] {
  return [Math.min(255, r + 40), Math.min(255, g + 40), Math.min(255, b + 40)];
}

/**
 * Full-viewport spectrum analyser overlay for TTS playback. A fixed,
 * pointer-events-none canvas behind the cockpit/overlays (z-index 1). Reacts to
 * the voice transport state: equaliser bars from the live FFT while speaking,
 * synthetic noise while waiting, and a frozen breathing snapshot while paused.
 */
export function SpectrumAnalyser({ transportState, getAnalyser, personaThinking = false }: Props) {
  const { data: settings } = useSettings();
  const spectrumEnabled = settings?.spectrumEnabled ?? SPECTRUM_DEFAULTS.spectrumEnabled;
  const animationsEnabled = settings?.animationsEnabled ?? true;
  const style = settings?.spectrumStyle ?? SPECTRUM_DEFAULTS.spectrumStyle;
  const opacity = settings?.spectrumOpacity ?? SPECTRUM_DEFAULTS.spectrumOpacity;
  const barCount = settings?.spectrumBarCount ?? SPECTRUM_DEFAULTS.spectrumBarCount;

  const accentHex = useMindspaceStore((s) => s.resolved?.palette.accent) ?? '#8C76D7';

  const { chatview, textColumn } = useAnalyserBounds();
  const accessors = useTtsFrequencyData(barCount, getAnalyser);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const activeRef = useRef(0);
  const reducedMotionRef = useRef(false);
  const frozenBinsRef = useRef<Float32Array | null>(null);

  // Buffer used when the noise branch is the data source.
  // Stable across renders; resized when barCount changes.
  const noiseBufferRef = useRef<Float32Array>(new Float32Array(barCount));
  if (noiseBufferRef.current.length !== barCount) {
    noiseBufferRef.current = new Float32Array(barCount);
  }

  // Reduced-motion subscription. Honours OS-level preference live.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = mq.matches;
    const listener = () => {
      reducedMotionRef.current = mq.matches;
    };
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, []);

  useEffect(() => {
    if (!spectrumEnabled || !animationsEnabled) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      const c = canvasRef.current;
      if (c) c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
      activeRef.current = 0;
      return;
    }

    let stopped = false;

    const tick = () => {
      if (stopped) return;
      const c = canvasRef.current;
      if (!c) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // DPR clamped to 1 — soft decorative shapes, saves ~4× memory at 4K.
      // Use getBoundingClientRect rather than clientWidth/Height: under
      // body { zoom: --ui-scale } the canvas is position: fixed and
      // clientWidth returns pre-zoom CSS pixels while the canvas is
      // visually rendered at post-zoom size. Our bounds are also post-zoom
      // (getBoundingClientRect everywhere), so the buffer must match.
      const rect = c.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }

      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);

      if (reducedMotionRef.current) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const geometry = { chatview, textColumn };
      const rgb = hexToRgb(accentHex);
      const rgbLight = brighten(rgb);

      if (transportState === 'paused') {
        if (!frozenBinsRef.current) {
          frozenBinsRef.current = accessors.getBins()?.slice() ?? new Float32Array(barCount);
        }
        const t = performance.now() / 1000;
        const breath = 0.8 + 0.2 * Math.sin((t * 2 * Math.PI) / 2.5); // 0.6..1.0
        drawVisualiserFrame(
          style,
          ctx,
          h,
          frozenBinsRef.current,
          { rgb, rgbLight, opacity: opacity * breath, maxHeightFraction: MAX_HEIGHT_FRACTION },
          geometry,
        );
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // Not paused — clear any stale snapshot.
      frozenBinsRef.current = null;

      // The synthetic "waiting" wave covers both the TTS audio-fetch (transport
      // 'waiting') and the live-voice thinking floor (reply still generating,
      // transport idle) — so the silent pause before audio reads as presence.
      const waitingWave = transportState === 'waiting' || personaThinking;
      const visible = transportState === 'speaking' || waitingWave;
      activeRef.current += ((visible ? 1 : 0) - activeRef.current) * FADE_RATE;

      if (activeRef.current > 0.005) {
        let bins: Float32Array | null = null;
        if (transportState === 'speaking') {
          bins = accessors.getBins();
        } else if (waitingWave) {
          fillNoiseBins(noiseBufferRef.current, performance.now() / 1000);
          bins = noiseBufferRef.current;
        }
        if (bins) {
          drawVisualiserFrame(
            style,
            ctx,
            h,
            bins,
            {
              rgb,
              rgbLight,
              opacity: opacity * activeRef.current,
              maxHeightFraction: MAX_HEIGHT_FRACTION,
            },
            geometry,
          );
        }
        rafRef.current = requestAnimationFrame(tick);
      } else if (visible) {
        // Visible but still ramping in — keep the loop running.
        rafRef.current = requestAnimationFrame(tick);
      } else {
        // Fully faded out and nothing playing — park the loop until state changes.
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      stopped = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [
    spectrumEnabled,
    animationsEnabled,
    style,
    opacity,
    barCount,
    accentHex,
    transportState,
    personaThinking,
    accessors,
    chatview,
    textColumn,
  ]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1,
      }}
    />
  );
}
