// SPDX-License-Identifier: AGPL-3.0-only
import { BreathingOrb } from '../components/BreathingOrb.js';
import { PostOnboardingBiometricPrompt } from '../components/PostOnboardingBiometricPrompt.js';

export function AppShell() {
  return (
    <>
      <PostOnboardingBiometricPrompt />
      <section className="relative grid min-h-[60dvh] place-items-center overflow-hidden text-center">
        <BreathingOrb seed={1} />
        <BreathingOrb seed={42} />
        <BreathingOrb seed={7} />
        <div className="relative">
          <h1 className="font-display text-5xl italic tracking-tight">Your space is ready.</h1>
          <p className="mt-4 text-paper-soft">
            Chat, personas, and sync will arrive in upcoming phases.
          </p>
        </div>
      </section>
    </>
  );
}
