// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand';

export type StagingOutcome = { kind: 'none' } | { kind: 'rolled_back' } | { kind: 'completed' };

export type BootPhase =
  | { kind: 'pending' }
  | { kind: 'runtime_failure'; missing: string[] }
  | { kind: 'db_failure'; error: string }
  | { kind: 'ready'; staging: StagingOutcome };

interface BootState {
  phase: BootPhase;
  set(phase: BootPhase): void;
}

export const useBootStore = create<BootState>((set) => ({
  phase: { kind: 'pending' },
  set: (phase) => set({ phase }),
}));
