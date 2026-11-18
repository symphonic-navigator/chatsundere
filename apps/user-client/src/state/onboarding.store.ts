// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand';

export type OnboardingState =
  | { kind: 'idle' }
  | { kind: 'invitation_input'; baseUrl: string; code: string; suggestedUsername?: string }
  | {
      kind: 'invitation_confirm';
      sessionId: string;
      baseUrl: string;
      code: string;
      suggestedUsername: string | null;
      registrationState: unknown;
    }
  | {
      kind: 'invitation_recovery';
      userId: string;
      username: string;
      recoveryKeyString: string;
      /** The wizard's search (its `?return=`), so a held reveal keeps it. */
      search?: string;
    }
  | {
      /** A local account's (or a recovery's) new key, shown on `at` until acknowledged. */
      kind: 'local_recovery';
      recoveryKeyString: string;
      at: '/onboarding/local' | '/login/recovery';
    }
  | { kind: 'pairing_input'; baseUrl: string; code: string }
  | {
      kind: 'pairing_confirm';
      sessionId: string;
      baseUrl: string;
      code: string;
      username: string;
      loginState: unknown;
    }
  | { kind: 'success'; userId: string };

interface OnboardingStore {
  state: OnboardingState;
  setState: (next: OnboardingState) => void;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingStore>((set) => ({
  state: { kind: 'idle' },
  setState: (next) => set({ state: next }),
  reset: () => set({ state: { kind: 'idle' } }),
}));
