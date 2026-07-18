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
  disabled?: boolean;
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
    disabled,
  } = props;
  const ref = useRef<HTMLTextAreaElement>(null);

  // Imperative (not the native `autoFocus` attribute): React's native autoFocus
  // steals focus unconditionally on mount, including from an input the user is
  // already editing elsewhere (e.g. a chat rename in the topbar) — which can
  // fire mid-edit now that the cockpit can mount after the topbar, once a
  // broken-model chat's offering resolves (spec 2026-07-18 §5.6). Skipping the
  // steal when another editable element already holds focus preserves the
  // intended behaviour (land the caret when the cockpit first opens) without
  // interrupting unrelated in-progress input.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only by design
  useEffect(() => {
    if (!autoFocus) return;
    const active = document.activeElement;
    const alreadyEditing =
      active instanceof HTMLElement &&
      (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
    if (!alreadyEditing) ref.current?.focus();
  }, []);

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
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={(e) => onBlur?.(e.target.value)}
      placeholder={placeholder}
      rows={minRows}
      style={{ maxHeight, overflowY: 'hidden', resize: 'none' }}
      className={`w-full rounded-md border border-white/10 bg-black/30 p-3 font-mono text-sm leading-snug text-paper outline-none focus:border-paper-soft disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    />
  );
}
