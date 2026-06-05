// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import { sanitiseTitle } from '../../lib/title-generator.js';

interface Props {
  initialValue: string;
  onCommit: (next: string | null) => void;
  onCancel: () => void;
}

export function HistoryRowRenameInput({ initialValue, onCommit, onCancel }: Props): JSX.Element {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const discardRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      maxLength={60}
      className="w-full rounded-md border border-paper-soft/40 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none focus:border-paper-soft"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          onCommit(sanitiseTitle(value));
        } else if (e.key === 'Escape') {
          discardRef.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (!discardRef.current) onCommit(sanitiseTitle(value));
      }}
    />
  );
}
