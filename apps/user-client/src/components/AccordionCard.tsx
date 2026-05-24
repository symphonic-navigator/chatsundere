// SPDX-License-Identifier: AGPL-3.0-only

import { type ReactNode, useState } from 'react';

interface Props {
  icon: string;
  label: string;
  meta?: ReactNode;
  defaultOpen?: boolean;
  requiredMarker?: boolean;
  children: ReactNode;
}

export function AccordionCard({
  icon,
  label,
  meta,
  defaultOpen = false,
  requiredMarker = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div data-accordion-card className="rounded-lg border border-white/5 bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
      >
        <div className="flex items-center gap-3">
          <span className="text-base text-paper-soft">{icon}</span>
          {requiredMarker ? (
            <span aria-label={`${label} is required`} className="text-danger" data-required-marker>
              ✕
            </span>
          ) : null}
          <div>
            <span data-accordion-label className="font-display text-sm text-paper">
              {label}
            </span>
            {meta ? <div className="text-xs text-paper-soft">{meta}</div> : null}
          </div>
        </div>
        <span className={`text-paper-soft transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
      </button>
      {open ? <div className="border-t border-white/5 p-3">{children}</div> : null}
    </div>
  );
}
