// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { QuickMenuAnchor } from '../../state/current-chat.store.js';
import { PersonaAvatar } from '../PersonaAvatar.js';

/** Viewport anchor for the quick menu from its trigger element. */
export function anchorFrom(el: Element): QuickMenuAnchor {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, bottom: r.bottom };
}

export interface ChatQuickMenuProps {
  /** Null = closed. */
  anchor: QuickMenuAnchor | null;
  /** The chat's persona; null while it is still resolving. */
  persona: { id: string; name: string; colour: string } | null;
  /** The persisted chat id; null for a lazy, not-yet-sent chat. */
  activeChatId: string | null;
  /** `pathname + search` of the chat, used as every `?return=`. */
  returnTo: string;
  onClose: () => void;
  /** Leave to the Entrance Hall (resets interaction mode first). */
  onEntranceHall: () => void;
  onNavigate: (to: string) => void;
}

interface Entry {
  key: string;
  label: React.ReactNode;
  /** Visible secondary line (a disabled reason never hides in a tooltip). */
  note?: string;
  disabled: boolean;
  run: () => void;
}

const GUTTER = 16;
const MIN_WIDTH = 224; // 14rem

/**
 * The chat's quick menu (spec §3): one surface, opened from the brand logo or
 * the interaction-mode hamburger. Portalled to <body>; the root carries
 * `.chat-quick-menu-root`, which InteractionMode exempts from its outside-tap
 * close so a tap here never collapses an unpinned cockpit.
 */
export function ChatQuickMenu(p: ChatQuickMenuProps): JSX.Element | null {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const open = p.anchor !== null;
  const { onClose } = p;
  // Dismissal without navigation hands focus back to the trigger. The store
  // update commits only after this handler, so `inert` is lifted here first:
  // browsers ignore focus() inside an inert subtree.
  const dismiss = useCallback((): void => {
    onClose();
    document.getElementById('root')?.removeAttribute('inert');
    returnFocusRef.current?.focus();
  }, [onClose]);

  // Escape is caught in the capture phase on window so it closes only this menu
  // and never reaches the cockpit or any other Escape listener.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      dismiss();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, dismiss]);

  // Background inert while open; focus the first enabled item.
  useEffect(() => {
    if (!open) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    menuRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')
      ?.focus();
    return () => root?.removeAttribute('inert');
  }, [open]);

  if (!p.anchor) return null;

  const enc = encodeURIComponent(p.returnTo);
  const persona = p.persona;
  const go = (to: string) => () => {
    onClose();
    p.onNavigate(to);
  };
  const noop = (): void => undefined;

  const personaEntries: Entry[] = persona
    ? [
        {
          key: 'persona',
          label: (
            <span className="flex items-center gap-2">
              <PersonaAvatar
                personaId={persona.id}
                name={persona.name}
                colour={persona.colour}
                size={24}
              />
              <span>{persona.name}</span>
            </span>
          ),
          disabled: false,
          run: go(`/app/persona/${persona.id}?return=${enc}`),
        },
        {
          key: 'new-chat',
          label: `New chat with ${persona.name}`,
          note: p.activeChatId === null ? "You're in a new chat" : undefined,
          disabled: p.activeChatId === null,
          run: go(`/app/chat/new?personaId=${persona.id}`),
        },
        {
          key: 'memories',
          label: 'Memories',
          disabled: false,
          // A saved chat keeps the cockpit's `?chat=` convention (also enables
          // the memory page's chat-path actions); a lazy chat returns via `?return=`.
          run: go(
            p.activeChatId
              ? `/app/persona/${persona.id}/memory?chat=${p.activeChatId}`
              : `/app/persona/${persona.id}/memory?return=${enc}`,
          ),
        },
        {
          key: 'history',
          label: 'History',
          disabled: false,
          run: go(`/app/history?personaId=${persona.id}&return=${enc}`),
        },
        {
          key: 'knowledge',
          label: 'Knowledge',
          disabled: false,
          run: go(`/app/persona/${persona.id}/knowledge?return=${enc}`),
        },
      ]
    : [
        { key: 'persona', label: 'Persona', note: 'Loading persona…', disabled: true, run: noop },
        { key: 'new-chat', label: 'New chat', disabled: true, run: noop },
        { key: 'memories', label: 'Memories', disabled: true, run: noop },
        { key: 'history', label: 'History', disabled: true, run: noop },
        { key: 'knowledge', label: 'Knowledge', disabled: true, run: noop },
      ];

  const groups: Entry[][] = [
    [
      {
        key: 'entrance',
        label: 'Entrance Hall',
        disabled: false,
        run: () => {
          onClose();
          p.onEntranceHall();
        },
      },
    ],
    personaEntries,
    [
      {
        key: 'images',
        label: 'Image settings',
        disabled: false,
        run: go(`/app/settings/images?return=${enc}`),
      },
    ],
  ];

  const left = Math.max(GUTTER, Math.min(p.anchor.left, window.innerWidth - GUTTER - MIN_WIDTH));
  const top = p.anchor.bottom + 6;
  // Keeps the right gutter too; long labels wrap rather than overflow.
  const maxWidth = window.innerWidth - GUTTER - left;

  const onMenuKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"])',
      ) ?? [],
    );
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return createPortal(
    <div className="chat-quick-menu-root fixed inset-0 z-50">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop tap maps to dismiss; Escape is handled on window */}
      <div
        data-testid="quick-menu-backdrop"
        aria-hidden="true"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={dismiss}
      />
      <div
        ref={menuRef}
        role="menu"
        aria-label="Quick menu"
        tabIndex={-1}
        onKeyDown={onMenuKey}
        className="chat-quick-menu-card absolute flex min-w-[14rem] max-w-[calc(100vw-32px)] flex-col rounded-card border border-white/10 bg-black/80 py-1 shadow-lg"
        style={{ top, left, maxWidth }}
      >
        {groups.map((group, gi) => (
          <div
            key={group[0]?.key ?? gi}
            className={gi > 0 ? 'border-t border-white/10' : undefined}
          >
            {group.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="menuitem"
                aria-disabled={entry.disabled || undefined}
                onClick={entry.disabled ? undefined : entry.run}
                className={`flex min-h-[44px] w-full flex-col items-start justify-center px-4 py-2 text-left text-sm wrap-anywhere ${
                  entry.disabled
                    ? 'cursor-default text-paper-soft/50'
                    : 'text-paper hover:bg-white/5'
                }`}
              >
                {entry.label}
                {entry.note ? (
                  <span className="text-[11px] text-paper-soft">{entry.note}</span>
                ) : null}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
