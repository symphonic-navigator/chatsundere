// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { copy } from '../../lib/copy.js';
import { parseInvitationUrl } from '../../lib/qr.js';
import { useLinkingStore } from '../../state/linking.store.js';

/**
 * `/linking/paste` — Paste-fallback invitation entry.
 *
 * Accepts either a full `https://<server>/link?payload=<base64url>` URL or a
 * bare invitation token. On success, stores the parsed payload in the linking
 * store and navigates to `/linking/confirm`.
 */
export function LinkingPaste() {
  const navigate = useNavigate();
  const setPayload = useLinkingStore((s) => s.setPayload);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const c = copy.linking.paste;

  function handleContinue() {
    setError(null);
    const result = parseInvitationUrl(value.trim());
    if (!result.ok) {
      setError(c.parseError);
      return;
    }
    setPayload(result.value);
    navigate('/linking/confirm', { replace: true });
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="font-display text-3xl italic tracking-tight text-aurora-200 lg:text-4xl">
          {c.title}
        </h1>
        <p className="text-sm leading-relaxed text-paper-soft">{c.body}</p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleContinue();
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <label
              htmlFor="invitation-input"
              className="text-xs font-medium uppercase tracking-wider text-paper-soft"
            >
              {c.label}
            </label>
            <textarea
              id="invitation-input"
              rows={4}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              placeholder={c.placeholder}
              autoComplete="off"
              spellCheck={false}
              className="w-full resize-none rounded-[var(--radius-card)] bg-ink-soft px-4 py-3 font-mono text-sm text-paper placeholder-paper-soft/40 ring-1 ring-inset ring-aurora-700/30 focus:outline-none focus:ring-aurora-500"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={value.trim().length === 0}
            className="w-full rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {c.continueCta}
          </button>
        </form>

        <div className="text-center">
          <Link
            to="/settings/server-linking"
            className="text-sm text-paper-soft underline-offset-2 hover:text-paper hover:underline"
          >
            {c.cancelCta}
          </Link>
        </div>
      </div>
    </div>
  );
}
