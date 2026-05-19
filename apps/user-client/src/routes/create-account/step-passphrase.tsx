// SPDX-License-Identifier: AGPL-3.0-only
import { type FormEvent, useMemo, useState } from 'react';
import * as v from 'valibot';
import { PassphraseField } from '../../components/PassphraseField.js';
import { copy } from '../../lib/copy.js';
import { pickWithin, seedRandom } from '../../lib/motion.js';
import { PassphrasePair } from '../../lib/validators.js';

export interface StepPassphraseProps {
  value: string;
  setValue(v: string): void;
  /** External error forwarded from the account-creation call (step 3 async). */
  error: string | null;
  onBack(): void;
  onNext(): void;
}

/** Step 2 of the create-account wizard: choose and confirm a passphrase. */
export function StepPassphrase({
  value,
  setValue,
  error: externalError,
  onBack,
  onNext,
}: StepPassphraseProps) {
  const [confirmation, setConfirmation] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const c = copy.create.passphraseStep;

  // Per-step entrance timing — step 2 seed is 2.
  const animDuration = useMemo(() => {
    const rng = seedRandom(2);
    return Math.round(pickWithin(rng, 200, 280));
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    const result = v.safeParse(PassphrasePair, { passphrase: value, confirmation });
    if (!result.success) {
      const first = result.issues[0];
      setLocalError(first?.message ?? 'Invalid passphrase.');
      return;
    }
    onNext();
  }

  const displayError = localError ?? externalError;

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-8 space-y-6"
      style={{ animation: `wizard-step-in ${animDuration}ms ease-out both` }}
    >
      <div className="space-y-1">
        <h1 className="font-display text-4xl italic lg:text-5xl">{c.title}</h1>
        <p className="text-sm text-paper-soft">{c.hint}</p>
      </div>

      <div className="space-y-4">
        <PassphraseField
          id="passphrase"
          label={c.passphraseLabel}
          value={value}
          onChange={setValue}
          meter
          autoComplete="new-password"
        />
        <PassphraseField
          id="passphrase-confirm"
          label={c.confirmLabel}
          value={confirmation}
          onChange={setConfirmation}
          autoComplete="new-password"
        />
        {displayError !== null && (
          <p className="text-xs text-danger" role="alert">
            {displayError}
          </p>
        )}
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-[var(--radius-card)] px-6 py-3 font-mono text-sm uppercase tracking-wider text-paper-soft ring-1 ring-inset ring-aurora-700/40 hover:text-paper"
        >
          {c.backCta}
        </button>
        <button
          type="submit"
          className="flex-1 rounded-[var(--radius-card)] bg-aurora-500 px-6 py-3 font-mono text-sm uppercase tracking-wider text-paper hover:bg-aurora-200 hover:text-ink"
        >
          {c.nextCta}
        </button>
      </div>
    </form>
  );
}
