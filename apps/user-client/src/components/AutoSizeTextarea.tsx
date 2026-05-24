// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef } from 'react';

interface Props {
  value: string;
  onChange: (next: string) => void;
  onBlur?: (value: string) => void;
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
  className?: string;
  id?: string;
  'aria-label'?: string;
}

const LINE_HEIGHT_PX = 22;

export function AutoSizeTextarea(props: Props): JSX.Element {
  const { value, onChange, onBlur, placeholder, minRows = 3, maxRows, className = '', id } = props;
  const ref = useRef<HTMLTextAreaElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: value is necessary for resize effect
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const maxHeight = maxRows ? `${maxRows * LINE_HEIGHT_PX + 24}px` : undefined;

  return (
    <textarea
      ref={ref}
      id={id}
      aria-label={props['aria-label']}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onBlur?.(e.target.value)}
      placeholder={placeholder}
      rows={minRows}
      style={{ maxHeight, overflowY: maxRows ? 'auto' : 'hidden', resize: 'none' }}
      className={`w-full rounded-md border border-white/10 bg-black/30 p-3 font-mono text-sm leading-snug text-paper outline-none focus:border-paper-soft ${className}`}
    />
  );
}
