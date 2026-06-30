// SPDX-License-Identifier: AGPL-3.0-only
import { type CSSProperties, type JSX, useEffect, useMemo, useRef } from 'react';

/** Motion profile for a shower. Full plays richly; reduced is a calm token. */
interface ShowerProfile {
  count: number;
  spawnMs: number;
  sizeMin: number;
  sizeMax: number;
  drift: number;
  riseMsMin: number;
  riseMsMax: number;
}

const PROFILE_FULL: ShowerProfile = {
  count: 40,
  spawnMs: 2800,
  sizeMin: 22,
  sizeMax: 38,
  drift: 30,
  riseMsMin: 2850,
  riseMsMax: 3750,
};

const PROFILE_REDUCED: ShowerProfile = {
  count: 4,
  spawnMs: 1200,
  sizeMin: 22,
  sizeMax: 30,
  drift: 12,
  riseMsMin: 2300,
  riseMsMax: 2900,
};

// Module-level instance counter so two simultaneous showers differ without
// Math.random (forbidden — would break determinism); paired with the particle
// index it seeds an integer hash.
let instanceSeq = 0;

/** Deterministic 32-bit integer hash of two inputs. */
function hash(a: number, b: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Deterministic [0, 1) value from a seed pair. */
const rand01 = (a: number, b: number): number => hash(a, b) / 0x1_0000_0000;

interface Particle {
  emoji: string;
  style: CSSProperties;
}

interface EmojiShowerEffectProps {
  emoji: string[];
  reducedMotion: boolean;
  onDone: () => void;
}

/**
 * A single emoji shower: spawns a profile-sized field of particles, each with
 * per-particle randomisation computed once at mount (start X, drift, size,
 * rotation, duration, delay) fed into the `screenEffectsRise` keyframe via CSS
 * custom properties. Calls `onDone` once — on the last particle's animationend
 * or via a safety timeout (jsdom / backgrounded tabs never fire animationend).
 */
export function EmojiShowerEffect({
  emoji,
  reducedMotion,
  onDone,
}: EmojiShowerEffectProps): JSX.Element {
  const profile = reducedMotion ? PROFILE_REDUCED : PROFILE_FULL;
  const palette = emoji.length > 0 ? emoji : ['✨'];

  // Seed and particles are computed once per mount so re-renders are equivalent,
  // not frozen mid-flight (spec §4.3).
  const seedRef = useRef<number>(0);
  if (seedRef.current === 0) seedRef.current = ++instanceSeq;
  const seed = seedRef.current;

  // biome-ignore lint/correctness/useExhaustiveDependencies: particles are mount-stable by design — profile/palette/seed are fixed per instance, so re-renders stay equivalent, not frozen mid-flight (spec §4.3)
  const particles = useMemo<Particle[]>(() => {
    const out: Particle[] = [];
    for (let i = 0; i < profile.count; i++) {
      const sx = rand01(seed, i * 7) * 100;
      const drift = (rand01(seed, i * 7 + 1) - 0.5) * 2 * profile.drift;
      const size = profile.sizeMin + rand01(seed, i * 7 + 2) * (profile.sizeMax - profile.sizeMin);
      const rot0 = (rand01(seed, i * 7 + 3) - 0.5) * 60;
      const rot1 = (rand01(seed, i * 7 + 4) - 0.5) * 160;
      const dur =
        profile.riseMsMin + rand01(seed, i * 7 + 5) * (profile.riseMsMax - profile.riseMsMin);
      const delay = rand01(seed, i * 7 + 6) * profile.spawnMs;
      out.push({
        emoji: palette[i % palette.length] ?? '✨',
        style: {
          left: `${sx}vw`,
          fontSize: `${size}px`,
          // Custom properties consumed by the keyframe (typed loosely on purpose).
          '--sfx-drift': `${drift}px`,
          '--sfx-rot0': `${rot0}deg`,
          '--sfx-rot1': `${rot1}deg`,
          animationDuration: `${dur}ms`,
          animationDelay: `${delay}ms`,
        } as CSSProperties,
      });
    }
    return out;
  }, []);

  // A single timer sized to the LAST possible finish (max delay + max duration +
  // a small margin) owns removal. Per-particle `animationend` cannot, because
  // delay and duration are randomised — the highest-indexed particle is rarely
  // the last to land, so keying removal off it would unmount still-rising emoji.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the timer is armed once at mount; profile is fixed per instance
  useEffect(() => {
    const ms = profile.spawnMs + profile.riseMsMax + 500;
    const t = setTimeout(onDone, ms);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="sfx-shower" aria-hidden="true">
      {particles.map((p, i) => (
        <span
          // Particles are positionally stable for this instance; index keys are safe.
          // biome-ignore lint/suspicious/noArrayIndexKey: particle list is mount-stable
          key={i}
          className="sfx-particle"
          style={p.style}
        >
          {p.emoji}
        </span>
      ))}
    </div>
  );
}
