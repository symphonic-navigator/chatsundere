// SPDX-License-Identifier: AGPL-3.0-only
import { copy } from '../copy.js';
import { HttpError } from '../lib/fetch.js';

interface Props {
  error: unknown;
  onRetry: () => void;
}

/**
 * The constructive failure state: name what went wrong, offer the next step.
 * Replaces every eternal-spinner branch (the old blank audit screen).
 */
export function QueryErrorPanel({ error, onRetry }: Props) {
  const detail =
    error instanceof HttpError
      ? `${error.status}${error.code ? ` · ${error.code}` : ''}`
      : copy.errors.network;
  return (
    <div
      role="alert"
      className="space-y-3 rounded-md border border-[var(--color-red)] bg-[var(--color-mantle)] p-4"
    >
      <p className="text-[var(--color-red)]">{copy.errors.queryFailedTitle}</p>
      <p className="font-mono text-xs text-[var(--color-subtext-0)]">{detail}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md bg-[var(--color-mauve)] px-3 py-1 text-[var(--color-base)]"
      >
        {copy.errors.retry}
      </button>
    </div>
  );
}
