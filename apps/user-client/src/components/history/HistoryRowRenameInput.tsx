// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import { sanitiseTitle } from '../../lib/title-generator.js';

interface Props {
  initialValue: string;
  onCommit: (next: string | null) => void;
  onCancel: () => void;
  /** Maximum character length. Defaults to 60 (the chat rename cap). */
  maxLength?: number;
  /**
   * Whether to run the committed value through {@link sanitiseTitle} (caps at 60,
   * strips surrounding quotes, collapses whitespace). Right for AI-style chat
   * titles; wrong for free user text such as bookmark labels. Defaults to `true`.
   */
  sanitise?: boolean;
}

export function HistoryRowRenameInput({
  initialValue,
  onCommit,
  onCancel,
  maxLength = 60,
  sanitise = true,
}: Props): JSX.Element {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const discardRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = (raw: string): void => {
    if (sanitise) {
      onCommit(sanitiseTitle(raw));
    } else {
      const t = raw.trim();
      onCommit(t === '' ? null : t);
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      maxLength={maxLength}
      className="w-full rounded-md border border-paper-soft/40 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none focus:border-paper-soft"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit(value);
        } else if (e.key === 'Escape') {
          discardRef.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (!discardRef.current) commit(value);
      }}
    />
  );
}
