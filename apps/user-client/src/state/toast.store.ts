// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand';

export type ToastTone = 'info' | 'warn' | 'success';

export interface ToastEntry {
  id: number;
  message: string;
  tone: ToastTone;
  durationMs: number;
}

interface ToastStoreState {
  toasts: ToastEntry[];
  show: (entry: { message: string; tone: ToastTone; durationMs: number }) => void;
  dismiss: (id: number) => void;
  clear: () => void;
}

let nextId = 1;

const useToastStoreInternal = create<ToastStoreState>((set, get) => ({
  toasts: [],
  show: (entry) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, ...entry }] }));
    setTimeout(() => get().dismiss(id), entry.durationMs);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

export const useToastStore = useToastStoreInternal;

/** Imperative façade for non-React callers (mutations, effects, etc.). */
export const toastStore = {
  show: (entry: { message: string; tone: ToastTone; durationMs: number }): void => {
    useToastStoreInternal.getState().show(entry);
  },
  dismiss: (id: number): void => useToastStoreInternal.getState().dismiss(id),
  clear: (): void => useToastStoreInternal.getState().clear(),
};
