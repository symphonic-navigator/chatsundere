// SPDX-License-Identifier: AGPL-3.0-only
import type { MouseEvent, ReactNode } from 'react';

export interface PillProps {
  /** Visual role. Defaults to 'filter'. */
  variant?: 'filter' | 'tag' | 'add';
  /** Active state — rendered with the gold accent. */
  active?: boolean;
  onClick?: () => void;
  /** When provided, renders a × control; clicking it removes without selecting. */
  onRemove?: () => void;
  children: ReactNode;
}

/**
 * Interactive chip. A Pill ACTS (filter toggle, removable tag, "+ add"). For
 * read-only status use Badge (spec §6).
 */
export function Pill({
  variant = 'filter',
  active,
  onClick,
  onRemove,
  children,
}: PillProps): JSX.Element {
  function handleRemove(e: MouseEvent): void {
    e.stopPropagation();
    onRemove?.();
  }
  return (
    <button
      type="button"
      className="cs-pill"
      data-variant={variant}
      data-active={active ? 'true' : undefined}
      onClick={onClick}
    >
      <span>{children}</span>
      {onRemove ? (
        <span
          // biome-ignore lint/a11y/useSemanticElements: intentional span-with-button-role to avoid nested <button> HTML violation
          className="cs-pill-x"
          role="button"
          tabIndex={0}
          aria-label={`Remove ${typeof children === 'string' ? children : 'tag'}`}
          onClick={handleRemove}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') handleRemove(e as unknown as MouseEvent);
          }}
        >
          ×
        </span>
      ) : null}
    </button>
  );
}
