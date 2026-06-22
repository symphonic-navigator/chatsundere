// src/components/ui/NavTile.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { motion } from '@chatsundere/ui-shared';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { NAV_BLINK_MS, useNavZoom } from '../../lib/use-nav-zoom.js';

export type NavTileColour = 'pink' | 'green' | 'blue' | 'purple';

export interface NavTileProps {
  /** Navigation-plane room identity (spec §2.3). */
  colour: NavTileColour;
  icon?: LucideIcon;
  label: string;
  /** Secondary line — a live count or a calm hint. */
  meta?: string;
  /** Destination route; omitted or disabled → not navigable. */
  to?: string;
  /** Alternative to `to`: tap triggers this callback (overlay / external link)
   *  instead of navigating, receiving the tile element so a consumer can use it
   *  as a zoom origin. Ignored when `to` is set or when disabled. */
  onActivate?: (el: HTMLElement) => void;
  /** Gold priority overlay — exactly one per screen (spec §2.2). */
  gold?: boolean;
  /** Span both grid columns (the Continue / Setup card). */
  wide?: boolean;
  disabled?: boolean;
  /** Announced reason shown when disabled ("disabled over hidden", §7). */
  disabledReason?: string;
  /** Body override; when present, replaces the icon/label/meta layout. */
  children?: ReactNode;
}

/**
 * The navigation-plane tile primitive (spec §2.2). Tapping it records its rect
 * in the transition store so the destination route zooms out of it (§7), plays
 * the gold trigger-blink, then navigates. Disabled tiles stay focusable and
 * announce their reason rather than vanishing. When `to` is absent and
 * `onActivate` is set, the tile plays the gold blink then calls the callback
 * with itself as the zoom origin (reduced motion: immediate, no blink).
 */
export function NavTile({
  colour,
  icon: Icon,
  label,
  meta,
  to,
  onActivate,
  gold,
  wide,
  disabled,
  disabledReason,
  children,
}: NavTileProps): JSX.Element {
  const navZoom = useNavZoom();
  const interactive = !disabled && (Boolean(to) || Boolean(onActivate));

  const handleActivate = (el: HTMLElement): void => {
    if (!interactive) return;
    if (to) {
      navZoom(el, to);
      return;
    }
    if (onActivate) {
      if (motion.respectsReducedMotion()) {
        onActivate(el);
      } else {
        el.classList.add('cs-tile-blink');
        window.setTimeout(() => onActivate(el), NAV_BLINK_MS);
      }
    }
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: disabled tiles must stay tappable/focusable to announce their reason — a native disabled <button> is removed from the tab order
    <div
      role="button"
      aria-disabled={disabled ? 'true' : undefined}
      aria-label={label}
      tabIndex={interactive || disabled ? 0 : -1}
      title={disabled ? disabledReason : undefined}
      data-colour={colour}
      data-gold={gold ? 'true' : undefined}
      data-wide={wide ? 'true' : undefined}
      className="cs-navtile"
      onClick={(e) => {
        handleActivate(e.currentTarget);
      }}
      onKeyDown={(e) => {
        if (interactive && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          handleActivate(e.currentTarget);
        }
      }}
    >
      {children ?? (
        <>
          {Icon ? <Icon className="cs-navtile-icon" size={22} aria-hidden="true" /> : null}
          <span className="cs-navtile-label">{label}</span>
          {meta ? <span className="cs-navtile-meta">{meta}</span> : null}
        </>
      )}
    </div>
  );
}
