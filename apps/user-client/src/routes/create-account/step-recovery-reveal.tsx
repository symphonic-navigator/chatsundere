// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo, useState } from 'react';
import { RecoveryKeyReveal } from '../../components/RecoveryKeyReveal.js';
import { copy } from '../../lib/copy.js';
import { pickWithin, seedRandom } from '../../lib/motion.js';

export interface StepRecoveryRevealProps {
  recoveryKey: string;
  onDone(): void;
}

/** Step 3 of the create-account wizard: reveal the recovery key and gate on confirmation. */
export function StepRecoveryReveal({ recoveryKey, onDone }: StepRecoveryRevealProps) {
  const [confirmStored, setConfirmStored] = useState(false);
  const c = copy.create.recoveryStep;

  // Per-step entrance timing — step 3 seed is 3.
  const animDuration = useMemo(() => {
    const rng = seedRandom(3);
    return Math.round(pickWithin(rng, 200, 280));
  }, []);

  return (
    <div
      className="mt-8 space-y-6"
      style={{ animation: `wizard-step-in ${animDuration}ms ease-out both` }}
    >
      <div className="space-y-1">
        <h1 className="font-display text-4xl italic lg:text-5xl">{c.title}</h1>
        <p className="text-sm text-paper-soft">{c.body}</p>
      </div>

      <RecoveryKeyReveal value={recoveryKey} />

      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={confirmStored}
          onChange={(e) => setConfirmStored(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-aurora-500"
        />
        <span className="text-sm text-paper-soft">{c.confirmLabel}</span>
      </label>

      <button
        type="button"
        disabled={!confirmStored}
        onClick={onDone}
        className="w-full rounded-[var(--radius-card)] bg-aurora-500 px-6 py-3 font-mono text-sm uppercase tracking-wider text-paper hover:bg-aurora-200 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        aria-disabled={!confirmStored}
      >
        {c.finishCta}
      </button>
    </div>
  );
}
