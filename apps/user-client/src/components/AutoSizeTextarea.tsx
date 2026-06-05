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
  /** Focus the textarea on mount — used by the chat cockpit so opening it
   *  (tap, or the reading-mode Enter hotkey) lands the caret ready to type. */
  autoFocus?: boolean;
  /** Optional key-down passthrough — e.g. the chat cockpit's desktop Enter-to-send. */
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

const LINE_HEIGHT_PX = 22;
const VERTICAL_PADDING_PX = 24;

export function AutoSizeTextarea(props: Props): JSX.Element {
  const {
    value,
    onChange,
    onBlur,
    placeholder,
    minRows = 3,
    maxRows,
    className = '',
    id,
    autoFocus,
    onKeyDown,
  } = props;
  const ref = useRef<HTMLTextAreaElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: value is necessary for resize effect
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const contentHeight = el.scrollHeight;
    el.style.height = `${contentHeight}px`;
    // Reveal the scrollbar only once the content genuinely exceeds the cap.
    // With a plain `overflow-y: auto`, starting a new line that still fits
    // within maxRows briefly reserves/flashes the scrollbar gutter; gating it
    // on the measured overflow keeps the growing input clean ("darf wachsen").
    if (maxRows) {
      const maxHeightPx = maxRows * LINE_HEIGHT_PX + VERTICAL_PADDING_PX;
      el.style.overflowY = contentHeight > maxHeightPx ? 'auto' : 'hidden';
    }
  }, [value, maxRows]);

  const maxHeight = maxRows ? `${maxRows * LINE_HEIGHT_PX + VERTICAL_PADDING_PX}px` : undefined;

  return (
    <textarea
      ref={ref}
      id={id}
      aria-label={props['aria-label']}
      // biome-ignore lint/a11y/noAutofocus: deliberate — the cockpit opens precisely so the user can type
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={(e) => onBlur?.(e.target.value)}
      placeholder={placeholder}
      rows={minRows}
      style={{ maxHeight, overflowY: 'hidden', resize: 'none' }}
      className={`w-full rounded-md border border-white/10 bg-black/30 p-3 font-mono text-sm leading-snug text-paper outline-none focus:border-paper-soft ${className}`}
    />
  );
}
