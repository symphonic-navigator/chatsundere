// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAppUpdateStore } from '../sw/app-update.store.js';
import { rememberReturnPath } from '../sw/post-update-return.js';

// Above every app layer, including modals and toasts that portal to body themselves.
const OVERLAY_Z_INDEX = 2147483000;

/**
 * Constructive exit for a tab stranded by another tab's update (spec §2.5
 * point 2): a full-viewport scrim blocks further interaction with the
 * mismatched worker, leaving Reload as the only action.
 */
export function UpdatedElsewhereOverlay(): JSX.Element | null {
  const updatedElsewhere = useAppUpdateStore((s) => s.updatedElsewhere);
  const reloadRef = useRef<HTMLButtonElement>(null);

  // Biome bans the native autoFocus attribute (it steals focus unconditionally
  // before React can reason about it); this overlay is a hard block, so
  // stealing focus on mount is exactly the intended behaviour.
  useEffect(() => {
    if (updatedElsewhere) reloadRef.current?.focus();
  }, [updatedElsewhere]);

  // The scrim alone still lets keyboard and assistive tech reach the app beneath;
  // inert on #root takes the whole old-code UI out of reach, not just out of sight.
  useEffect(() => {
    if (!updatedElsewhere) return;
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    return () => root?.removeAttribute('inert');
  }, [updatedElsewhere]);

  if (!updatedElsewhere) return null;

  function reload() {
    rememberReturnPath();
    location.reload();
  }

  // The card has exactly one focusable control, so containment is just:
  // Tab (either direction) never leaves it. No focus-trap library needed.
  function keepFocusOnReload(e: React.KeyboardEvent) {
    if (e.key === 'Tab') {
      e.preventDefault();
      reloadRef.current?.focus();
    }
  }

  return createPortal(
    <div className="updated-elsewhere-scrim" style={{ zIndex: OVERLAY_Z_INDEX }}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="updated-elsewhere-message"
        className="updated-elsewhere-card"
        onKeyDown={keepFocusOnReload}
      >
        <p id="updated-elsewhere-message" className="font-display text-lg text-paper">
          Chatsundere was updated in another window.
        </p>
        <button ref={reloadRef} type="button" onClick={reload} className="updated-elsewhere-reload">
          Reload
        </button>
      </div>
    </div>,
    document.body,
  );
}
