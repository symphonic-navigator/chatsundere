// SPDX-License-Identifier: AGPL-3.0-only
import { CryptoError } from '@chatsundere/crypto';
import { type FormEvent, useMemo, useState } from 'react';
import { copy } from '../../lib/copy.js';
import { pickWithin, seedRandom } from '../../lib/motion.js';
import { validateUsername } from '../../lib/validators.js';

export interface StepUsernameProps {
  value: string;
  setValue(v: string): void;
  onNext(): void;
}

/** Step 1 of the create-account wizard: choose a username. */
export function StepUsername({ value, setValue, onNext }: StepUsernameProps) {
  const [error, setError] = useState<string | null>(null);
  const c = copy.create.usernameStep;

  // Per-step entrance timing — step 1 seed is 1.
  const animDuration = useMemo(() => {
    const rng = seedRandom(1);
    return Math.round(pickWithin(rng, 200, 280));
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      validateUsername(value);
      onNext();
    } catch (err) {
      if (err instanceof CryptoError) {
        setError(copy.errors.usernameInvalid);
      } else {
        setError('An unexpected error occurred.');
      }
    }
  }

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

      <div className="space-y-1">
        <label htmlFor="username" className="block text-sm text-paper-soft">
          {c.label}
        </label>
        <input
          id="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={c.placeholder}
          className="w-full rounded-[var(--radius-card)] bg-ink-soft px-4 py-3 font-mono text-base text-paper outline-none ring-1 ring-inset ring-aurora-700/40 focus:ring-aurora-500 placeholder:text-paper-soft/40"
        />
        {error !== null && (
          <p className="text-xs text-danger" role="alert">
            {error}
          </p>
        )}
      </div>

      <button
        type="submit"
        className="w-full rounded-[var(--radius-card)] bg-aurora-500 px-6 py-3 font-mono text-sm uppercase tracking-wider text-paper hover:bg-aurora-200 hover:text-ink"
      >
        {c.nextCta}
      </button>
    </form>
  );
}
