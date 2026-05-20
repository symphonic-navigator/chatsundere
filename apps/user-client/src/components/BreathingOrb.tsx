// SPDX-License-Identifier: AGPL-3.0-only
import { motion } from '@chatsundere/ui-shared';
import type React from 'react';
import { useMemo } from 'react';

export function BreathingOrb({ seed }: { seed?: number }) {
  // Deterministic per mount when no seed; jitter is per-instance.
  const params = useMemo(() => {
    const rng = motion.seedRandom(seed ?? Math.random() * 1e9);
    return {
      size: motion.pickWithin(rng, 140, 360),
      top: rng() * 100,
      left: rng() * 100,
      period: motion.pickWithin(rng, 7, 13),
      drift: motion.pickWithin(rng, 12, 30),
    };
  }, [seed]);

  // Cast widens CSSProperties to accept the --drift CSS custom property used
  // by the `breathe` keyframes; it is not part of the standard index.
  const style: React.CSSProperties & { '--drift': string } = {
    width: params.size,
    height: params.size,
    top: `${params.top}%`,
    left: `${params.left}%`,
    background: 'radial-gradient(circle, var(--color-aurora-500), transparent 70%)',
    animation: motion.respectsReducedMotion()
      ? 'none'
      : `breathe ${params.period}s ease-in-out infinite alternate`,
    '--drift': `${params.drift}px`,
  };

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute rounded-full blur-3xl opacity-40 mix-blend-screen"
      style={style}
    />
  );
}
