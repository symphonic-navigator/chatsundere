# Spectrum Analyser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an ambient, frequency-driven spectrum analyser over the chat view that pulses to the persona's TTS, tinted in the active mindspace accent, with user settings — a near-verbatim port of chatsune's voice visualiser adapted to chatsundere's seams.

**Architecture:** Insert an `AnalyserNode` into the existing `AudioSink` (`source → analyser → destination`). A new `SpectrumAnalyser` canvas component runs a RAF loop, drawing real frequency bins while the voice machine is `speaking`, an idle shimmer while `waiting`, and a frozen breath while `paused`. Colour comes reactively from the mindspace store; geometry centres on the `.chat-stream` column. Settings (enable/style/opacity/barCount) persist via a new Dexie v25 migration and a Settings → Voice subsection.

**Tech Stack:** React 18, TypeScript (strict), XState v5 (existing voice machine), Web Audio API, Dexie, Zustand (mindspace store), Vitest, Biome.

**Spec:** `superpowers/specs/2026-06-14-spectrum-analyser-design.md`

**Conventions:**
- Every new source file starts with `// SPDX-License-Identifier: AGPL-3.0-only`.
- British English in all identifiers, comments, copy.
- Run the gate yourself before each commit: `pnpm --filter @chatsundere/user-client typecheck` and `pnpm --filter @chatsundere/user-client test` (or the repo's `pnpm typecheck --force` + vitest). Biome runs on commit; also run it on touched files.
- Commit messages: free-form imperative, no Conventional-Commits prefix. **No** `[skip ci]` (these are code commits). Co-author: `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`.
- These are working commits during the feature; Liz squashes to one unit before the push (do NOT squash inside tasks).

---

## File structure

**Create:**
- `apps/user-client/src/lib/voice/visualiser-bucketing.ts` — log-frequency FFT bucketing (port).
- `apps/user-client/src/lib/voice/visualiser-noise.ts` — deterministic idle-noise filler (port).
- `apps/user-client/src/lib/voice/visualiser-renderers.ts` — per-style draw functions (port, glass + dots removed).
- `apps/user-client/src/lib/voice/use-tts-frequency-data.ts` — analyser → smoothed log bins (port, adapted to a `getAnalyser` accessor).
- `apps/user-client/src/lib/voice/spectrum-settings.ts` — clamp helpers + defaults (small, testable).
- `apps/user-client/src/lib/voice/use-analyser-bounds.ts` — ResizeObserver on `.chat-stream`.
- `apps/user-client/src/components/voice/SpectrumAnalyser.tsx` — the canvas + RAF loop.
- Tests: `apps/user-client/tests/unit/visualiser-bucketing.test.ts`, `visualiser-noise.test.ts`, `visualiser-renderers.test.ts`, `spectrum-settings.test.ts`, `audio-sink-analyser.test.ts`.

**Modify:**
- `apps/user-client/src/lib/voice/audio-sink.ts` — add `AnalyserNode` + `getAnalyser()`.
- `apps/user-client/src/lib/voice/use-voice-playback.ts` — expose `getAnalyser` on the return.
- `apps/user-client/src/boot/client-data-db.ts` — `SettingsRow` fields, Dexie v25, seed defaults.
- `apps/user-client/src/routes/app/chat/chat-page.tsx` — mount `<SpectrumAnalyser>`.
- `apps/user-client/src/components/voice/VoiceSection.tsx` — settings controls.

**Source of truth for ports** (read these before copying):
- `chatsune/frontend/src/features/voice/infrastructure/visualiserBucketing.ts`
- `chatsune/frontend/src/features/voice/infrastructure/visualiserNoise.ts`
- `chatsune/frontend/src/features/voice/infrastructure/visualiserRenderers.ts`
- `chatsune/frontend/src/features/voice/infrastructure/useTtsFrequencyData.ts`
- `chatsune/frontend/src/features/voice/components/VoiceVisualiser.tsx`

> **Note on test paths:** confirm the user-client test convention before Task 1 — check whether existing voice tests live in `apps/user-client/tests/unit/` or co-located `__tests__/`. Use whichever the repo already uses; the paths above assume `tests/unit/` (per CLAUDE.md "tests live under tests/**"). Adjust all test paths to match.

---

## Task 1: Port the pure modules (bucketing + noise)

`visualiserBucketing.ts` and `visualiserNoise.ts` are pure, dependency-free, and fully testable. Port them verbatim (rename to kebab-case, add the SPDX header).

**Files:**
- Create: `apps/user-client/src/lib/voice/visualiser-bucketing.ts`
- Create: `apps/user-client/src/lib/voice/visualiser-noise.ts`
- Test: `apps/user-client/tests/unit/visualiser-bucketing.test.ts`
- Test: `apps/user-client/tests/unit/visualiser-noise.test.ts`

- [ ] **Step 1: Copy the two source files verbatim, then add the SPDX header**

```bash
cp chatsune/frontend/src/features/voice/infrastructure/visualiserBucketing.ts \
   apps/user-client/src/lib/voice/visualiser-bucketing.ts
cp chatsune/frontend/src/features/voice/infrastructure/visualiserNoise.ts \
   apps/user-client/src/lib/voice/visualiser-noise.ts
```

Prepend `// SPDX-License-Identifier: AGPL-3.0-only` as the first line of each. No other edits — both files are pure and self-contained (`bucketIntoLogBins`, `FREQ_MIN_HZ`, `FREQ_MAX_HZ`; `fillNoiseBins`, `NOISE_BASELINE`, `NOISE_AMP`, `NOISE_PHASE_STEP`, `NOISE_PERIOD_S`).

- [ ] **Step 2: Write the failing tests**

`tests/unit/visualiser-bucketing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FREQ_MAX_HZ, FREQ_MIN_HZ, bucketIntoLogBins } from '../../src/lib/voice/visualiser-bucketing.js';

describe('bucketIntoLogBins', () => {
  it('returns one normalised value per output bin', () => {
    const raw = new Uint8Array(128).fill(255);
    const out = bucketIntoLogBins(raw, 24_000, 256, 24);
    expect(out.length).toBe(24);
    for (const v of out) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of out) expect(v).toBeLessThanOrEqual(1);
  });

  it('maps a full-scale FFT to ~1.0 across all bars', () => {
    const raw = new Uint8Array(128).fill(255);
    const out = bucketIntoLogBins(raw, 24_000, 256, 24);
    for (const v of out) expect(v).toBeCloseTo(1, 5);
  });

  it('maps a zero FFT to 0 across all bars', () => {
    const raw = new Uint8Array(128).fill(0);
    const out = bucketIntoLogBins(raw, 24_000, 256, 24);
    for (const v of out) expect(v).toBe(0);
  });

  it('exposes the documented frequency span', () => {
    expect(FREQ_MIN_HZ).toBe(20);
    expect(FREQ_MAX_HZ).toBe(12_000);
  });
});
```

`tests/unit/visualiser-noise.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { NOISE_AMP, NOISE_BASELINE, fillNoiseBins } from '../../src/lib/voice/visualiser-noise.js';

describe('fillNoiseBins', () => {
  it('is deterministic for a given time', () => {
    const a = new Float32Array(24);
    const b = new Float32Array(24);
    fillNoiseBins(a, 1.234);
    fillNoiseBins(b, 1.234);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('stays within [BASELINE, BASELINE + AMP]', () => {
    const out = new Float32Array(48);
    for (let t = 0; t < 10; t += 0.137) {
      fillNoiseBins(out, t);
      for (const v of out) {
        expect(v).toBeGreaterThanOrEqual(NOISE_BASELINE - 1e-9);
        expect(v).toBeLessThanOrEqual(NOISE_BASELINE + NOISE_AMP + 1e-9);
      }
    }
  });
});
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm --filter @chatsundere/user-client test -- visualiser-bucketing visualiser-noise`
Expected: PASS (the ported code already satisfies these). If the import extension (`.js`) or test dir differs, fix to match repo convention.

- [ ] **Step 4: Typecheck + Biome**

Run: `pnpm --filter @chatsundere/user-client typecheck` and `pnpm biome check apps/user-client/src/lib/voice/visualiser-bucketing.ts apps/user-client/src/lib/voice/visualiser-noise.ts`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/voice/visualiser-bucketing.ts apps/user-client/src/lib/voice/visualiser-noise.ts apps/user-client/tests/unit/visualiser-bucketing.test.ts apps/user-client/tests/unit/visualiser-noise.test.ts
git commit -m "Port spectrum visualiser bucketing and noise"
```

---

## Task 2: Port the renderers (sharp / soft / glow only)

Port `visualiserRenderers.ts`, removing the `glass` style and the entire transcription-dots subsystem (Spec §9). Replace the two chatsune store type-imports with local type definitions.

**Files:**
- Create: `apps/user-client/src/lib/voice/visualiser-renderers.ts`
- Test: `apps/user-client/tests/unit/visualiser-renderers.test.ts`

- [ ] **Step 1: Copy the source, then apply the edits**

```bash
cp chatsune/frontend/src/features/voice/infrastructure/visualiserRenderers.ts \
   apps/user-client/src/lib/voice/visualiser-renderers.ts
```

Apply exactly these edits:

1. Prepend `// SPDX-License-Identifier: AGPL-3.0-only`.
2. **Remove** the two top imports:
   ```ts
   import type { VisualiserStyle } from '../stores/voiceSettingsStore'
   import type { Bounds } from '../stores/visualiserLayoutStore'
   ```
   and replace with local definitions at the top of the file:
   ```ts
   export type VisualiserStyle = 'sharp' | 'soft' | 'glow';
   export interface Bounds {
     x: number;
     y: number;
     w: number;
     h: number;
   }
   ```
3. In `drawVisualiserFrame`'s `switch`, **delete** the `case 'glass':` line.
4. **Delete** the function `drawGlass`.
5. **Delete** the entire transcription-dots subsystem: `DOT_BASE_RADIUS`, `DOT_GAP`, `dotLayout`, `dotPulse`, `drawTranscriptionDots`, `drawDotsSharp`, `drawDotsSoft`, `drawDotsGlow`, `drawDotsGlass`. (None are used — chatsundere has no dots until Spec 3.)
6. Keep `barLayout`, `RenderOpts`, `BarGeometry`, `drawVisualiserFrame`, `drawSharp`, `drawSoft`, `drawGlow`.

After the edits the file exports: `VisualiserStyle`, `Bounds`, `RenderOpts`, `BarGeometry`, `barLayout`, `drawVisualiserFrame`.

- [ ] **Step 2: Write the failing smoke test**

Canvas pixels aren't meaningfully assertable in jsdom, but we can assert the dispatch runs each style without throwing against a minimal 2D-context stub.

`tests/unit/visualiser-renderers.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  type BarGeometry,
  type RenderOpts,
  type VisualiserStyle,
  drawVisualiserFrame,
} from '../../src/lib/voice/visualiser-renderers.js';

function stubCtx(): CanvasRenderingContext2D {
  // Minimal stub — only the calls the draw functions make.
  const grd = { addColorStop: vi.fn() };
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    createLinearGradient: vi.fn(() => grd),
    createRadialGradient: vi.fn(() => grd),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    shadowColor: '',
    shadowBlur: 0,
  } as unknown as CanvasRenderingContext2D;
}

const OPTS: RenderOpts = {
  rgb: [140, 118, 215],
  rgbLight: [180, 158, 255],
  opacity: 0.5,
  maxHeightFraction: 0.36,
};
const GEO: BarGeometry = {
  chatview: { x: 0, y: 0, w: 400, h: 800 },
  textColumn: { x: 20, y: 0, w: 360, h: 800 },
};

describe('drawVisualiserFrame', () => {
  it.each<VisualiserStyle>(['sharp', 'soft', 'glow'])('renders style %s without throwing', (style) => {
    const ctx = stubCtx();
    const bins = new Float32Array([0.1, 0.5, 0.9, 0.3, 0.7]);
    expect(() => drawVisualiserFrame(style, ctx, 800, bins, OPTS, GEO)).not.toThrow();
    expect((ctx.fillRect as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails, then passes after the edits**

Run: `pnpm --filter @chatsundere/user-client test -- visualiser-renderers`
Expected: PASS once the port + edits are in. If it imports a deleted symbol, the edits in Step 1 are incomplete — fix.

- [ ] **Step 4: Typecheck + Biome**

Run: `pnpm --filter @chatsundere/user-client typecheck` and `pnpm biome check apps/user-client/src/lib/voice/visualiser-renderers.ts`
Expected: clean (no unused imports, no references to removed dots/glass).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/voice/visualiser-renderers.ts apps/user-client/tests/unit/visualiser-renderers.test.ts
git commit -m "Port spectrum visualiser renderers (sharp/soft/glow)"
```

---

## Task 3: Add the AnalyserNode to AudioSink

Insert an `AnalyserNode` between the source and the destination so frequency data is observable, and expose it. The node lives on the same `AudioContext`, created lazily in `ensureCtx`.

**Files:**
- Modify: `apps/user-client/src/lib/voice/audio-sink.ts`
- Test: `apps/user-client/tests/unit/audio-sink-analyser.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/audio-sink-analyser.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { AudioSink } from '../../src/lib/voice/audio-sink.js';

describe('AudioSink.getAnalyser', () => {
  it('returns null before any AudioContext exists', () => {
    const sink = new AudioSink();
    expect(sink.getAnalyser()).toBeNull();
  });

  it('exposes the analyser once the context is created', async () => {
    // Minimal AudioContext stub: enough for ensureCtx + createAnalyser.
    const analyser = { fftSize: 0, frequencyBinCount: 128, connect: vi.fn(), getByteFrequencyData: vi.fn() };
    const ctxStub = {
      state: 'running',
      createAnalyser: vi.fn(() => analyser),
      destination: {},
      resume: vi.fn(),
      suspend: vi.fn(),
      close: vi.fn(),
    };
    vi.stubGlobal('AudioContext', vi.fn(() => ctxStub));

    const sink = new AudioSink();
    // ensureAnalyser is reached by ensureCtx; trigger context creation.
    sink.ensureAnalyserForTest(); // see Step 2 — a tiny test seam
    expect(sink.getAnalyser()).toBe(analyser);
    expect(analyser.connect).toHaveBeenCalledWith(ctxStub.destination);
    vi.unstubAllGlobals();
  });
});
```

> If you prefer not to add a test seam, drop the second test and cover analyser wiring in the manual-verification step instead. The first test (null before context) is the must-have.

- [ ] **Step 2: Implement the analyser wiring**

In `audio-sink.ts`, add an analyser field and create+connect it in `ensureCtx`, then route the source through it in `play`. Concrete edits:

Add field next to the others:
```ts
  private analyser: AnalyserNode | null = null;
```

In `ensureCtx`, after the context is created, create and connect the analyser once:
```ts
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

  /** Test-only seam: force context+analyser creation without decoding audio. */
  ensureAnalyserForTest(): void {
    this.ensureCtx();
  }
```

In `play`, connect the source to the analyser instead of straight to the destination:
```ts
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.analyser ?? ctx.destination);
```

In `dispose`, null the analyser after closing the context:
```ts
  async dispose(): Promise<void> {
    this.stop();
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
      this.analyser = null;
    }
  }
```

(`stop()` only touches `this.source`; leave it unchanged. The analyser persists across plays — each new source connects into it.)

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @chatsundere/user-client test -- audio-sink-analyser`
Expected: PASS.

- [ ] **Step 4: Typecheck + Biome**

Run: `pnpm --filter @chatsundere/user-client typecheck` and `pnpm biome check apps/user-client/src/lib/voice/audio-sink.ts`
Expected: clean. Confirm the existing `audio-sink` behaviour (play/pause/resume/stop) is untouched.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/voice/audio-sink.ts apps/user-client/tests/unit/audio-sink-analyser.test.ts
git commit -m "Add analyser node to AudioSink for spectrum data"
```

---

## Task 4: Port useTtsFrequencyData (adapted to a getAnalyser accessor)

Port the hook, replacing its dependency on chatsune's `audioPlayback` singleton with an injected `getAnalyser` accessor (chatsundere's `AudioSink` is owned by `useVoicePlayback`, not a singleton).

**Files:**
- Create: `apps/user-client/src/lib/voice/use-tts-frequency-data.ts`

- [ ] **Step 1: Copy the source, then apply the edits**

```bash
cp chatsune/frontend/src/features/voice/infrastructure/useTtsFrequencyData.ts \
   apps/user-client/src/lib/voice/use-tts-frequency-data.ts
```

Apply exactly these edits:

1. Prepend `// SPDX-License-Identifier: AGPL-3.0-only`.
2. Replace the import line `import { audioPlayback } from './audioPlayback'` and the bucketing import path. New imports:
   ```ts
   import { useEffect, useRef } from 'react';
   import { bucketIntoLogBins } from './visualiser-bucketing.js';
   ```
3. Change the hook signature to take a `getAnalyser` accessor and drop `isActive` from the returned accessors (play/idle now comes from the voice machine's `transportState`, not the singleton):
   ```ts
   interface FrequencyAccessors {
     /** Reads current frequency bins, log-bucketed and smoothed. Null if no analyser yet. */
     getBins(): Float32Array | null;
   }

   export function useTtsFrequencyData(
     barCount: number,
     getAnalyser: () => AnalyserNode | null,
   ): FrequencyAccessors {
   ```
4. In `getBins`, replace `const analyser = audioPlayback.getAnalyser()` with `const analyser = getAnalyser()`. Keep everything else (the `rawBuffer`/`smoothed`/`barCountRef` logic, `SMOOTHING = 0.28`, the log-bucketing call) identical.
5. **Remove** the `isActive` accessor entirely.

> **Stable-reference caveat:** the ported hook builds the accessor object once and reads `barCount` via a ref. `getAnalyser` must likewise be read via a ref so the accessor object stays stable. Add inside the hook:
> ```ts
>   const getAnalyserRef = useRef(getAnalyser);
>   getAnalyserRef.current = getAnalyser;
> ```
> and call `getAnalyserRef.current()` inside `getBins`. This keeps the accessor identity stable across renders even if the caller passes a fresh closure.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: clean. (No standalone unit test — the hook needs a real analyser; it is exercised by the component + manual verification. The bucketing it calls is already tested in Task 1.)

- [ ] **Step 3: Biome**

Run: `pnpm biome check apps/user-client/src/lib/voice/use-tts-frequency-data.ts`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/lib/voice/use-tts-frequency-data.ts
git commit -m "Port useTtsFrequencyData onto AudioSink analyser"
```

---

## Task 5: Expose getAnalyser from useVoicePlayback

The component needs the analyser accessor. `useVoicePlayback` owns the `AudioSink` (`sinkRef`); expose a stable getter on its return.

**Files:**
- Modify: `apps/user-client/src/lib/voice/use-voice-playback.ts`

- [ ] **Step 1: Add `getAnalyser` to the `VoicePlayback` interface**

In the `VoicePlayback` interface (around line 26-55), add:
```ts
  /** The TTS playback analyser node for the spectrum visualiser, or null before first play. */
  getAnalyser: () => AnalyserNode | null;
```

- [ ] **Step 2: Implement it in the return**

In the returned object (around line 388-413), add:
```ts
    getAnalyser: () => sinkRef.current?.getAnalyser() ?? null,
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: clean. (`transportState` is already on the return — no new selector needed; the component reads `speaking`/`waiting`/`paused` from it.)

- [ ] **Step 4: Biome + Commit**

```bash
pnpm biome check apps/user-client/src/lib/voice/use-voice-playback.ts
git add apps/user-client/src/lib/voice/use-voice-playback.ts
git commit -m "Expose playback analyser from useVoicePlayback"
```

---

## Task 6: Settings fields, clamp helpers, Dexie v25, seed defaults

Add the four spectrum settings to `SettingsRow`, a v25 migration that backfills defaults, the seed defaults for fresh installs, and a small tested clamp/defaults module.

**Files:**
- Create: `apps/user-client/src/lib/voice/spectrum-settings.ts`
- Modify: `apps/user-client/src/boot/client-data-db.ts`
- Test: `apps/user-client/tests/unit/spectrum-settings.test.ts`

- [ ] **Step 1: Write the clamp/defaults module + failing test**

`apps/user-client/src/lib/voice/spectrum-settings.ts`:
```ts
// SPDX-License-Identifier: AGPL-3.0-only

export type SpectrumStyle = 'sharp' | 'soft' | 'glow';

export const SPECTRUM_STYLES: readonly SpectrumStyle[] = ['sharp', 'soft', 'glow'] as const;

export const SPECTRUM_DEFAULTS = {
  spectrumEnabled: true,
  spectrumStyle: 'soft' as SpectrumStyle,
  spectrumOpacity: 0.5,
  spectrumBarCount: 24,
} as const;

export const SPECTRUM_OPACITY_MIN = 0.05;
export const SPECTRUM_OPACITY_MAX = 0.8;
export const SPECTRUM_BARCOUNT_MIN = 16;
export const SPECTRUM_BARCOUNT_MAX = 96;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Clamp opacity to its valid display range. */
export function clampSpectrumOpacity(v: number): number {
  return clamp(v, SPECTRUM_OPACITY_MIN, SPECTRUM_OPACITY_MAX);
}

/** Clamp bar count to range and round to an integer. */
export function clampSpectrumBarCount(v: number): number {
  return clamp(Math.round(v), SPECTRUM_BARCOUNT_MIN, SPECTRUM_BARCOUNT_MAX);
}
```

`tests/unit/spectrum-settings.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  SPECTRUM_DEFAULTS,
  clampSpectrumBarCount,
  clampSpectrumOpacity,
} from '../../src/lib/voice/spectrum-settings.js';

describe('spectrum settings clamps', () => {
  it('defaults match the spec', () => {
    expect(SPECTRUM_DEFAULTS).toEqual({
      spectrumEnabled: true,
      spectrumStyle: 'soft',
      spectrumOpacity: 0.5,
      spectrumBarCount: 24,
    });
  });

  it('clamps opacity to [0.05, 0.80]', () => {
    expect(clampSpectrumOpacity(0)).toBe(0.05);
    expect(clampSpectrumOpacity(1)).toBe(0.8);
    expect(clampSpectrumOpacity(0.4)).toBe(0.4);
  });

  it('clamps and rounds bar count to [16, 96]', () => {
    expect(clampSpectrumBarCount(2)).toBe(16);
    expect(clampSpectrumBarCount(200)).toBe(96);
    expect(clampSpectrumBarCount(24.7)).toBe(25);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @chatsundere/user-client test -- spectrum-settings`
Expected: PASS.

- [ ] **Step 3: Add the `SettingsRow` fields**

In `apps/user-client/src/boot/client-data-db.ts`, after `voiceStopHintSeen` (line 58), add:
```ts
  /** Spectrum analyser: master on/off (behaviour-axis setting — global, persisted). */
  spectrumEnabled: boolean;
  /** Spectrum analyser: bar render style. */
  spectrumStyle: 'sharp' | 'soft' | 'glow';
  /** Spectrum analyser: bar opacity, clamped [0.05, 0.80]. */
  spectrumOpacity: number;
  /** Spectrum analyser: number of bars, clamped [16, 96]. */
  spectrumBarCount: number;
```

- [ ] **Step 4: Add the v25 migration**

In `client-data-db.ts`, immediately after the `this.version(24)` block (ends ~line 803), add:
```ts
    // Version 25 — spectrum analyser. Settings gain enable/style/opacity/barCount;
    // existing installs get the spec defaults (analyser on, soft, 0.5, 24 bars).
    this.version(25).upgrade(async (tx) => {
      await tx
        .table('settings')
        .toCollection()
        .modify((s: Record<string, unknown>) => {
          if (typeof s.spectrumEnabled !== 'boolean') s.spectrumEnabled = true;
          if (s.spectrumStyle !== 'sharp' && s.spectrumStyle !== 'soft' && s.spectrumStyle !== 'glow') {
            s.spectrumStyle = 'soft';
          }
          if (typeof s.spectrumOpacity !== 'number') s.spectrumOpacity = 0.5;
          if (typeof s.spectrumBarCount !== 'number') s.spectrumBarCount = 24;
        });
    });
```

- [ ] **Step 5: Add the seed defaults**

In the `db.settings.add({ ... })` seed block (the `id: 1` object, ~line 902-927), add before `createdAt: now`:
```ts
        spectrumEnabled: true,
        spectrumStyle: 'soft',
        spectrumOpacity: 0.5,
        spectrumBarCount: 24,
```

- [ ] **Step 6: Typecheck + Biome**

Run: `pnpm --filter @chatsundere/user-client typecheck`
Expected: clean — the new required `SettingsRow` fields are satisfied by the seed block (Step 5). If typecheck flags other `SettingsRow` literals (e.g. test fixtures or a settings factory), update them with the four defaults too. Grep first: `rg -n "spectrumEnabled|SettingsRow =|: SettingsRow" apps/user-client` and any place that constructs a full `SettingsRow`.
Run: `pnpm biome check apps/user-client/src/boot/client-data-db.ts apps/user-client/src/lib/voice/spectrum-settings.ts`

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/src/lib/voice/spectrum-settings.ts apps/user-client/tests/unit/spectrum-settings.test.ts
git commit -m "Add spectrum analyser settings and Dexie v25 migration"
```

---

## Task 7: The analyser-bounds hook

A small hook that measures the `.chat-stream` column (the `textColumn`) via a `ResizeObserver`, so the bars centre on the message column. `chatview` is simply the viewport.

**Files:**
- Create: `apps/user-client/src/lib/voice/use-analyser-bounds.ts`

- [ ] **Step 1: Implement the hook**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import type { Bounds } from './visualiser-renderers.js';

export interface AnalyserBounds {
  /** Whole viewport — there is no sidebar in chatsundere. */
  chatview: Bounds;
  /** The message column (`.chat-stream`), centred-on target for the bars. */
  textColumn: Bounds;
}

function viewportBounds(): Bounds {
  return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
}

/**
 * Track the chat message-column rectangle for the spectrum analyser. Observes
 * `.chat-stream` (the scroll container) and the viewport. Falls back to the
 * viewport for `textColumn` until the element mounts. Re-measures on resize.
 */
export function useAnalyserBounds(): AnalyserBounds {
  const [bounds, setBounds] = useState<AnalyserBounds>(() => ({
    chatview: viewportBounds(),
    textColumn: viewportBounds(),
  }));
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const measure = (): void => {
      const el = document.querySelector('.chat-stream');
      const chatview = viewportBounds();
      const textColumn = el
        ? (() => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
          })()
        : chatview;
      setBounds({ chatview, textColumn });
    };

    // Initial measure after paint (the element may mount a tick later).
    rafRef.current = requestAnimationFrame(measure);

    const ro = new ResizeObserver(measure);
    const el = document.querySelector('.chat-stream');
    if (el) ro.observe(el);
    window.addEventListener('resize', measure);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return bounds;
}
```

> The `.chat-stream` element exists once the chat route renders (`components/chat/ChatStream.tsx` line ~201). The RAF-delayed initial measure handles the mount-order race; the `ResizeObserver` keeps it current. If `ChatStream` is conditionally unmounted (e.g. empty state), the fallback to viewport keeps the bars sensible.

- [ ] **Step 2: Typecheck + Biome**

Run: `pnpm --filter @chatsundere/user-client typecheck` and `pnpm biome check apps/user-client/src/lib/voice/use-analyser-bounds.ts`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/lib/voice/use-analyser-bounds.ts
git commit -m "Add analyser bounds hook measuring the chat column"
```

---

## Task 8: The SpectrumAnalyser component

The canvas + RAF loop. Adapted from chatsune's `VoiceVisualiser.tsx`, simplified to chatsundere's seams: colour from the mindspace store, play/idle/paused from `transportState`, guards on `spectrumEnabled` + `animationsEnabled` + reduced-motion, all chatsune barge/redemption/dots/hit-strip machinery dropped.

**Files:**
- Create: `apps/user-client/src/components/voice/SpectrumAnalyser.tsx`
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx`

- [ ] **Step 1: Implement the component**

Read chatsune `VoiceVisualiser.tsx` for the RAF structure, the `hexToRgb`/`brighten` helpers, the fade envelopes, and the paused-breath branch. Reproduce that structure with these substitutions:

- Props:
  ```ts
  import type { TransportState } from '../../lib/voice/voice-machine.js';

  interface Props {
    transportState: TransportState;
    getAnalyser: () => AnalyserNode | null;
  }
  ```
- Settings come from `useSettings()` (read `spectrumEnabled`, `spectrumStyle`, `spectrumOpacity`, `spectrumBarCount`, and `animationsEnabled`, each with the `SPECTRUM_DEFAULTS` fallback).
- Colour comes from the mindspace store:
  ```ts
  import { useMindspaceStore } from '../../state/mindspace.store.js';
  const accentHex = useMindspaceStore((s) => s.resolved?.palette.accent) ?? '#8C76D7';
  ```
  Keep chatsune's `hexToRgb` + `brighten` helpers verbatim.
- Frequency data:
  ```ts
  import { useTtsFrequencyData } from '../../lib/voice/use-tts-frequency-data.js';
  const accessors = useTtsFrequencyData(barCount, getAnalyser);
  ```
- Geometry:
  ```ts
  import { useAnalyserBounds } from '../../lib/voice/use-analyser-bounds.js';
  const { chatview, textColumn } = useAnalyserBounds();
  ```
- **Master guard:** if `!spectrumEnabled || !animationsEnabled`, the effect cancels any RAF, clears the canvas, and returns (same shape as chatsune's `!enabled` early-out). Keep the existing reduced-motion ref + subscription so `prefers-reduced-motion` rests the draw.
- **State mapping (replaces chatsune's singleton `isActive()` + `ttsExpected()` + pause store):**
  - `transportState === 'speaking'` → real bins: `bins = accessors.getBins()`.
  - `transportState === 'waiting'` → idle-noise: `fillNoiseBins(noiseBufferRef.current, performance.now() / 1000); bins = noiseBufferRef.current`.
  - `transportState === 'paused'` → frozen breath: snapshot the last bins once into `frozenBinsRef` and modulate opacity by chatsune's `breath` sine (port that branch verbatim, minus the redemption-fade multiplier).
  - any other state (`idle`, `failed`, `ended-partial`) → not visible: ramp `activeRef` toward 0 and, once faded, park the RAF (`rafRef.current = null`), exactly like chatsune's terminal `else` branch.
  - Pass `transportState` as a ref-mirrored value the `tick` closure reads (mirror it into a ref updated by an effect, like chatsune mirrors `redemptionActive`), so the closure sees the live state without re-binding every frame. Add `transportState` to the effect dep array as well.
- **Drop entirely** (Spec §9): `useVisualiserPauseStore`, `usePauseRedemptionStore`, `useVoicePipeline`, `usePhase`, `useTtsExpected`, `useVisualiserLayoutStore`, the `transcribing`/dots branches, `drawTranscriptionDots`, the redemption-fade envelope (`barsFadeRef` and `redemptionRef`), and the `chatview/textColumn`-from-store reads (they now come from `useAnalyserBounds`).
- **Resume-on-event:** chatsune resumed the parked RAF via `audioPlayback.subscribe`. Replace that with: the effect re-runs when `transportState` changes (it's in the dep array), and the first `tick` of the re-run restarts the loop. So when state goes `idle → speaking`, the effect teardown+resetup naturally restarts the RAF. No audio-singleton subscription needed.
- `MAX_HEIGHT_FRACTION = 0.36` (Spec §6 — taller than chatsune's 0.28).
- Canvas markup identical to chatsune: `aria-hidden`, `position: fixed; inset: 0; width/height 100%; pointer-events: none; zIndex: 1`.

Skeleton of the effect's `tick` (fill in from the chatsune port):
```tsx
const tick = () => {
  if (stopped) return;
  const c = canvasRef.current;
  if (!c) { rafRef.current = requestAnimationFrame(tick); return; }
  const rect = c.getBoundingClientRect();
  const w = Math.round(rect.width), h = Math.round(rect.height);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  if (reducedMotionRef.current) { rafRef.current = requestAnimationFrame(tick); return; }

  const geometry = { chatview, textColumn };
  const rgb = hexToRgb(accentHex);
  const rgbLight = brighten(rgb);
  const state = transportStateRef.current;

  if (state === 'paused') {
    // ... port chatsune's paused-breath branch (snapshot frozenBinsRef, breath sine),
    //     drawing with opacity * breath; keep the RAF running.
    rafRef.current = requestAnimationFrame(tick);
    return;
  }
  frozenBinsRef.current = null;

  const visible = state === 'speaking' || state === 'waiting';
  activeRef.current += ((visible ? 1 : 0) - activeRef.current) * FADE_RATE;

  if (activeRef.current > 0.005) {
    let bins: Float32Array | null = null;
    if (state === 'speaking') bins = accessors.getBins();
    else if (state === 'waiting') { fillNoiseBins(noiseBufferRef.current, performance.now() / 1000); bins = noiseBufferRef.current; }
    if (bins) {
      drawVisualiserFrame(style, ctx, h, bins, {
        rgb, rgbLight, opacity: opacity * activeRef.current, maxHeightFraction: MAX_HEIGHT_FRACTION,
      }, geometry);
    }
    rafRef.current = requestAnimationFrame(tick);
  } else if (visible) {
    rafRef.current = requestAnimationFrame(tick);
  } else {
    rafRef.current = null; // faded out, nothing playing — park
  }
};
```

- [ ] **Step 2: Mount it in chat-page**

In `routes/app/chat/chat-page.tsx`, the hook is already called: `const voice = useVoicePlayback(activeChatId ?? '', effectivePersona, messages)`. Render the analyser inside the `.chat-page` container (line ~510), as a sibling of the chat content so it shares the stacking context but sits at `z-1` beneath cockpit/overlays:
```tsx
<SpectrumAnalyser transportState={voice.transportState} getAnalyser={voice.getAnalyser} />
```
Add the import. Place it as the first child of the `.chat-page` div so the fixed canvas is positioned but visually behind interactive children (which establish their own stacking / sit at higher z).

> **Verify occlusion:** the MCP approval modal and lightbox render at `z-50` / as portals — above `z-1`. Confirm visually in manual step 6. If any chat-level overlay renders *below* `z-1`, raise it; do not lower the analyser below the message text (it must stay over the text per the spec).

- [ ] **Step 3: Typecheck + Biome**

Run: `pnpm --filter @chatsundere/user-client typecheck` and `pnpm biome check apps/user-client/src/components/voice/SpectrumAnalyser.tsx apps/user-client/src/routes/app/chat/chat-page.tsx`
Expected: clean. Biome bans non-null `!`; use `?? fallback` everywhere (the settings reads and `getContext`).

- [ ] **Step 4: Commit**

```bash
git add apps/user-client/src/components/voice/SpectrumAnalyser.tsx apps/user-client/src/routes/app/chat/chat-page.tsx
git commit -m "Add SpectrumAnalyser component and mount on chat page"
```

---

## Task 9: Settings → Voice controls

Add the spectrum subsection to `VoiceSection.tsx`: an enable toggle, a 3-way style selector (reusing the existing `ModeOption`), and two range sliders (opacity, bar count), all immediate-persist.

**Files:**
- Modify: `apps/user-client/src/components/voice/VoiceSection.tsx`

- [ ] **Step 1: Read the current settings + add the controls**

Inside `VoiceSection`, after the existing reads (line ~104), add:
```ts
import {
  SPECTRUM_DEFAULTS,
  SPECTRUM_BARCOUNT_MAX,
  SPECTRUM_BARCOUNT_MIN,
  SPECTRUM_OPACITY_MAX,
  SPECTRUM_OPACITY_MIN,
  type SpectrumStyle,
  clampSpectrumBarCount,
  clampSpectrumOpacity,
} from '../../lib/voice/spectrum-settings.js';
// ...
const spectrumEnabled = settings?.spectrumEnabled ?? SPECTRUM_DEFAULTS.spectrumEnabled;
const spectrumStyle: SpectrumStyle = settings?.spectrumStyle ?? SPECTRUM_DEFAULTS.spectrumStyle;
const spectrumOpacity = settings?.spectrumOpacity ?? SPECTRUM_DEFAULTS.spectrumOpacity;
const spectrumBarCount = settings?.spectrumBarCount ?? SPECTRUM_DEFAULTS.spectrumBarCount;
```

Add a new subsection block (mirroring the Dictation block's markup) at the end of the returned `<div>`, before its close:
```tsx
{/* ── Spectrum analyser ───────────────────────────────────────────────── */}
<div>
  <div className="mb-2 text-[11px] uppercase tracking-widest text-paper-soft">
    Spectrum analyser
  </div>

  {/* Enable */}
  <div className="mb-3">
    <button
      type="button"
      aria-pressed={spectrumEnabled}
      onClick={() => update.mutate({ spectrumEnabled: !spectrumEnabled })}
      className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
        spectrumEnabled
          ? 'border-paper bg-white/5 text-paper'
          : 'border-white/5 text-paper-soft hover:border-paper-soft/50'
      }`}
    >
      Show the spectrum analyser
    </button>
    <p className="mt-1.5 text-[11px] text-paper-soft">
      An ambient equaliser that pulses to your Circle’s voice while it reads aloud.
    </p>
  </div>

  {/* Style (sharp / soft / glow) */}
  {spectrumEnabled && (
    <>
      <div className="mb-3 flex flex-col gap-2">
        <ModeOption id="sharp" label="Sharp" description="Crisp solid bars"
          selected={spectrumStyle === 'sharp'} onSelect={() => update.mutate({ spectrumStyle: 'sharp' })} />
        <ModeOption id="soft" label="Soft" description="Gradient bars (recommended)"
          selected={spectrumStyle === 'soft'} onSelect={() => update.mutate({ spectrumStyle: 'soft' })} />
        <ModeOption id="glow" label="Glow" description="Luminous bars with a halo"
          selected={spectrumStyle === 'glow'} onSelect={() => update.mutate({ spectrumStyle: 'glow' })} />
      </div>

      {/* Opacity */}
      <div className="mb-3">
        <input
          type="range"
          min={SPECTRUM_OPACITY_MIN}
          max={SPECTRUM_OPACITY_MAX}
          step={0.05}
          value={spectrumOpacity}
          aria-label="Spectrum opacity"
          onChange={(e) => update.mutate({ spectrumOpacity: clampSpectrumOpacity(Number(e.target.value)) })}
          className="w-full"
        />
        <span className="text-[11px] text-paper-soft">
          Opacity {Math.round(spectrumOpacity * 100)}%
        </span>
      </div>

      {/* Bar count */}
      <div className="mb-3">
        <input
          type="range"
          min={SPECTRUM_BARCOUNT_MIN}
          max={SPECTRUM_BARCOUNT_MAX}
          step={1}
          value={spectrumBarCount}
          aria-label="Spectrum bar count"
          onChange={(e) => update.mutate({ spectrumBarCount: clampSpectrumBarCount(Number(e.target.value)) })}
          className="w-full"
        />
        <span className="text-[11px] text-paper-soft">{spectrumBarCount} bars</span>
      </div>
    </>
  )}
</div>
```

> The 3-way style selector follows §11 "Disabled over hidden" loosely: the style/opacity/bar-count controls collapse when the analyser is off (they have no meaning then). This matches the Dictation block's pattern of hiding sub-options behind their parent toggle, so it is consistent with the existing section. If Laura flags the collapse as hiding, switch to rendering them disabled (greyed) instead — keep the change localised.

- [ ] **Step 2: Typecheck + Biome**

Run: `pnpm --filter @chatsundere/user-client typecheck` and `pnpm biome check apps/user-client/src/components/voice/VoiceSection.tsx`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/components/voice/VoiceSection.tsx
git commit -m "Add spectrum analyser controls to voice settings"
```

---

## Task 10: Full-suite gate + manual verification + STATUS

- [ ] **Step 1: Full gate**

Run, from the repo root:
```bash
pnpm typecheck --force
pnpm --filter @chatsundere/user-client test
pnpm run build --force
pnpm biome check apps/user-client/src
```
Expected: typecheck clean; vitest = prior baseline (the known 8 Node-localStorage failures, no new failures — verify the count is exactly 8 and the failing files are the known localStorage trio, per the vitest-baseline memory); build green; biome clean. Investigate any new failure before proceeding — do not wave through a 9th failure.

- [ ] **Step 2: Manual verification (device — Chris runs these)**

Restart `pnpm dev` first (lib edits; Vite HMR can miss `lib/voice` churn). Then walk Spec §11 steps 1-8:
1. Voice mode on → send → bars swing in the mindspace accent, centred over the column, semi-transparent, text legible.
2. Multi-paragraph → between paragraphs (`waiting`) idle shimmer, not frozen/blank.
3. Settings → Voice: switch style (sharp/soft/glow), drag opacity, drag bar count → visible live.
4. Toggle analyser off → canvas clears, no motion.
5. Voice mode off → no analyser.
6. Open lightbox / sheet / MCP approval → analyser occluded; close → restored.
7. OS reduced-motion → analyser rests while audio plays.
8. Different mindspace → bars adopt that accent.
Also confirm: global Settings "animations" off → analyser rests (the `animationsEnabled` guard).

- [ ] **Step 3: Update STATUS**

Update `obsidian/STATUS-CLIENT-ONLY.md`: move the spectrum analyser from "next zwischenfeature" to done (squash hash once squashed), note Spec 3 (live voice) is now the next item, and refresh `Last updated:`. (Liz does this around the squash, per CLAUDE.md §16.)

---

## Self-review (against the spec)

**Spec coverage:**
- §3 colour (mindspace accent) → Task 8 (`useMindspaceStore`). ✓
- §3 layering / over-text / pointer-events-none → Task 8 (canvas markup) + Task 8 Step 2 occlusion note. ✓
- §3 styles sharp/soft/glow, soft default → Tasks 2, 6, 9. ✓
- §4 file layout → Tasks 1-9 cover every listed file. ✓
- §5 AnalyserNode insertion → Task 3. ✓
- §5 play/idle from machine state → Task 8 (`transportState` mapping). ✓
- §6 geometry / `.chat-stream` / MAX_HEIGHT 0.36 → Tasks 7, 8. ✓
- §7 settings + Dexie v25 + seed → Task 6; UI → Task 9. ✓
- §8 reduced-motion + aria-hidden → Task 8; plus the `animationsEnabled` guard (additional, noted in Task 8/10). ✓
- §9 scope cuts (glass, dots, redemption, barge, hit-strip) → Tasks 2, 8 explicit drops. ✓
- §10 tests → Tasks 1, 2, 3, 6. ✓
- §11 manual verification → Task 10. ✓
- §12 gates + Laura → Task 10; Laura pre-squash is Liz's gate (outside the plan).

**Deviations from the spec, called out:**
- Spec §6 said colour via the `--mindspace-accent` CSS var; the plan reads it from the mindspace store reactively instead (same value `MindspaceLayer` sets on `:root`, no per-frame `getComputedStyle`, no DOM-tree coupling). Strict improvement, same intent.
- Added an `animationsEnabled` guard (not in the spec) — the analyser is decorative motion and chatsundere has a global animations switch; resting when it is off is the consistent, least-astonishing behaviour. Worth a line in the spec if Chris agrees.
- `waiting` is the sole idle-shimmer trigger (the spec floated "armed/auto-read-on between generations" too); tying shimmer strictly to `waiting` keeps motion meaningful and avoids a constant idle wash. Note for Laura/Chris at pre-squash.

**Type consistency:** `VisualiserStyle`/`SpectrumStyle` are `'sharp'|'soft'|'glow'` everywhere (renderers, settings, SettingsRow, UI). `Bounds` defined once in `visualiser-renderers.ts`, reused by `use-analyser-bounds.ts`. `getAnalyser: () => AnalyserNode | null` consistent across `AudioSink`, `useVoicePlayback`, the freq hook, and the component props.
