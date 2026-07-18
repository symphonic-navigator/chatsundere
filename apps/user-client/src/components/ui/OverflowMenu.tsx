// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useId, useRef, useState } from 'react';
import { computeTransformOrigin } from '../../lib/origin-zoom.js';

export interface OverflowItem {
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
  /** Announced via aria-describedby when the item is disabled (spec §7, HARD-2). */
  disabledReason?: string;
  tone?: 'default' | 'destructive';
}

/** A visual divider between groups of items in the overflow menu. */
export interface OverflowSeparator {
  separator: true;
}

/** Union of a real menu item and a non-interactive group divider. */
export type OverflowEntry = OverflowItem | OverflowSeparator;

export function isSeparator(e: OverflowEntry): e is OverflowSeparator {
  return 'separator' in e && e.separator === true;
}

export interface OverflowMenuProps {
  items: OverflowEntry[];
  /** Accessible name for the trigger. Defaults to "More actions". */
  triggerLabel?: string;
  /**
   * Controls how the trigger is rendered.
   * - `'icon'` (default) — the classic ⋯ glyph in a 32 × 32 circle; `triggerLabel` is
   *   aria-only. Use for secondary/destructive actions that should stay visually quiet.
   * - `'labelled'` — renders `triggerLabel` as visible button text; use where the primary
   *   action must be self-explanatory (e.g. the Documents "Add ▾" control).
   */
  variant?: 'icon' | 'labelled';
  /**
   * Which way the menu opens relative to the trigger.
   * - `'down'` (default) — drops below; correct almost everywhere.
   * - `'up'` — rises above; use where the trigger sits at the bottom of the
   *   viewport (e.g. the cockpit's edit-send control), so the menu stays on
   *   screen instead of opening off the bottom edge.
   */
  placement?: 'down' | 'up';
}

/**
 * Context-menu primitive used in two visual modes (see `variant`). Secondary actions live
 * here so list rows stay calm; the menu is where "disabled over hidden" holds — disabled
 * items remain focusable (aria-disabled, not native disabled) and announce their reason
 * (spec §7). Appears via the origin-aware zoom (spec §3).
 *
 * Separator entries (`{ separator: true }`) render a visual divider between logical groups.
 */
export function OverflowMenu({
  items,
  triggerLabel = 'More actions',
  variant = 'icon',
  placement = 'down',
}: OverflowMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const reasonBase = useId();

  useEffect(() => {
    if (!open) return undefined;
    // Zoom out of the trigger (Unified-Experience motion).
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (menu && trigger) {
      const stage = menu.offsetParent as HTMLElement | null;
      if (stage) {
        menu.style.transformOrigin = computeTransformOrigin(
          trigger.getBoundingClientRect(),
          stage.getBoundingClientRect(),
        );
      }
    }
    const onOutside = (e: Event): void => {
      const t = e.target as Node | null;
      if (t && rootRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  function activate(item: OverflowItem): void {
    if (item.disabled) return; // aria-disabled: no-op rather than removed from tab order
    item.onSelect?.();
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="cs-overflow">
      <button
        ref={triggerRef}
        type="button"
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className={variant === 'labelled' ? 'cs-overflow-trigger-labelled' : 'cs-overflow-trigger'}
        onClick={() => setOpen((o) => !o)}
      >
        {variant === 'labelled' ? triggerLabel : '⋯'}
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          className="cs-overflow-menu cs-zoom-in"
          data-placement={placement}
        >
          {items.map((item, i) => {
            if (isSeparator(item)) {
              return (
                // biome-ignore lint/a11y/useFocusableInteractive: a separator is a non-interactive structural role and must not be focusable
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: caller-ordered list
                  key={i}
                  className="cs-overflow-sep"
                  data-testid="cs-overflow-sep"
                  role="separator"
                />
              );
            }
            const reasonId =
              item.disabled && item.disabledReason ? `${reasonBase}-${i}` : undefined;
            return (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: menu items are a stable, caller-ordered list
                key={i}
                type="button"
                role="menuitem"
                className="cs-overflow-item"
                data-tone={item.tone ?? 'default'}
                aria-disabled={item.disabled ? 'true' : undefined}
                aria-describedby={reasonId}
                title={item.disabled ? item.disabledReason : undefined}
                onClick={() => activate(item)}
              >
                <span>{item.label}</span>
                {reasonId ? (
                  <span id={reasonId} className="cs-overflow-reason" aria-hidden="true">
                    {item.disabledReason}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
