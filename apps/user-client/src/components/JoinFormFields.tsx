// SPDX-License-Identifier: AGPL-3.0-only
import { useId } from 'react';
import { normaliseCodeInput } from '../lib/code-input.js';
import { parseJoinUrl } from '../lib/qr.js';

interface Props {
  baseUrl: string;
  code: string;
  onBaseUrlChange: (v: string) => void;
  onCodeChange: (v: string) => void;
}

/**
 * Variant-C form fields: URL field + Code field shared by the invitation
 * and pairing form screens. Includes paste-auto-split: pasting a full join
 * URL (legacy `https://<base>/join#<CODE>` or client-origin
 * `https://<app>/join?server=<base>#<CODE>`) into the URL field extracts the
 * fragment into the Code field and the resolved server into the URL field.
 * Delegates to `parseJoinUrl` so both forms and their scheme/param
 * validation stay in one place. See spec § 2 Decision 11.
 */
export function JoinFormFields({ baseUrl, code, onBaseUrlChange, onCodeChange }: Props) {
  const urlId = useId();
  const codeId = useId();

  function handleUrlChange(raw: string) {
    const parsed = parseJoinUrl(raw);
    if (parsed.ok) {
      onBaseUrlChange(parsed.value.baseUrl);
      onCodeChange(normaliseCodeInput(parsed.value.code));
      return;
    }
    onBaseUrlChange(raw);
  }

  return (
    <>
      <div>
        <label
          htmlFor={urlId}
          className="text-xs font-medium uppercase tracking-wider text-paper-soft"
        >
          Server URL
        </label>
        <input
          id={urlId}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={baseUrl}
          onChange={(e) => handleUrlChange(e.target.value)}
          placeholder="https://chatsundere.me/"
          className="mt-1 w-full rounded-[var(--radius-input)] bg-ink-soft px-3 py-2 ring-1 ring-inset ring-aurora-700/30 focus:outline-none focus:ring-aurora-500"
        />
      </div>
      <div className="mt-4">
        <label
          htmlFor={codeId}
          className="text-xs font-medium uppercase tracking-wider text-paper-soft"
        >
          Code
        </label>
        <input
          id={codeId}
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(e) => onCodeChange(normaliseCodeInput(e.target.value))}
          placeholder="XXXXX-XXXXX"
          className="mt-1 w-full rounded-[var(--radius-input)] bg-ink-soft px-3 py-2 font-mono ring-1 ring-inset ring-aurora-700/30 focus:outline-none focus:ring-aurora-500"
        />
      </div>
    </>
  );
}
