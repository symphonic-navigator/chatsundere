// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';

export interface InlineMarkerProps {
  tone?: 'default' | 'success' | 'warning' | 'danger';
  children: ReactNode;
}

const toneClass: Record<NonNullable<InlineMarkerProps['tone']>, string> = {
  default: 'text-paper-soft bg-ink-soft/60 ring-aurora-700/40',
  success: 'text-success bg-success/10 ring-success/30',
  warning: 'text-warning bg-warning/10 ring-warning/30',
  danger: 'text-danger bg-danger/10 ring-danger/30',
};

export function InlineMarker({ tone = 'default', children }: InlineMarkerProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[var(--radius-pill)] px-2 py-0.5 font-mono text-[0.72rem] uppercase tracking-wide ring-1 ring-inset ${toneClass[tone]}`}
    >
      {children}
    </span>
  );
}
