// SPDX-License-Identifier: AGPL-3.0-only
import type { EffectTrigger } from '@chatsundere/llm-unified';
import { create } from 'zustand';

/** A live effect instance the overlay renders and then removes when finished. */
export interface ActiveEffect {
  id: string;
  effect: EffectTrigger;
  /** Captured at trigger time so a later motion-preference change cannot retune
   *  an in-flight effect (spec §4.3). */
  reducedMotion: boolean;
}

// Monotonic id source — deterministic for tests, no Math.random/Date.now.
let seq = 0;

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface ScreenEffectsState {
  active: ActiveEffect[];
  /** Enqueue an effect, snapshotting the motion preference now. */
  trigger: (effect: EffectTrigger) => void;
  /** Drop a finished effect instance by id. */
  remove: (id: string) => void;
}

/** Global queue of active screen effects, drained by the overlay. */
export const useScreenEffectsStore = create<ScreenEffectsState>((set) => ({
  active: [],
  trigger: (effect) =>
    set((s) => ({
      active: [...s.active, { id: `fx-${++seq}`, effect, reducedMotion: prefersReducedMotion() }],
    })),
  remove: (id) => set((s) => ({ active: s.active.filter((e) => e.id !== id) })),
}));
