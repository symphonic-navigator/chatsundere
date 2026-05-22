// SPDX-License-Identifier: AGPL-3.0-only
import { useId } from 'react';
import { normaliseCodeInput } from '../lib/code-input.js';

interface Props {
  baseUrl: string;
  code: string;
  onBaseUrlChange: (v: string) => void;
  onCodeChange: (v: string) => void;
}

/**
 * Variant-C form fields: URL field + Code field shared by the invitation
 * and pairing form screens. Includes paste-auto-split: pasting a
 * `https://<base>/join#<CODE>` URL into the URL field extracts the fragment
 * into the Code field and trims the URL to its base. See spec § 2 Decision 11.
 */
export function JoinFormFields({ baseUrl, code, onBaseUrlChange, onCodeChange }: Props) {
  const urlId = useId();
  const codeId = useId();

  function handleUrlChange(raw: string) {
    const match = raw.match(/^(.+\/join)#([A-Za-z0-9-]+)$/);
    const joinPart = match?.[1];
    const codePart = match?.[2];
    if (joinPart !== undefined && codePart !== undefined) {
      const base = joinPart.replace(/\/join$/, '/');
      onBaseUrlChange(base);
      onCodeChange(normaliseCodeInput(codePart));
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
