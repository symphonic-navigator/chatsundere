// SPDX-License-Identifier: AGPL-3.0-only

// The control-panel kit (spec §7.2). Glow is budgeted: LEDs, stat values and
// the audit prompt only — nothing else in the app may add text-shadow glows.

import type { ReactNode } from 'react';

export type LedTone = 'green' | 'yellow' | 'red';

const LED_COLOUR: Record<LedTone, string> = {
  green: 'var(--color-green)',
  yellow: 'var(--color-yellow)',
  red: 'var(--color-red)',
};

export function StatusLed({ tone }: { tone: LedTone }) {
  const colour = LED_COLOUR[tone];
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: colour, boxShadow: `0 0 6px ${colour}` }}
    />
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-overlay-0)]">
      {children}
    </span>
  );
}

export function ConsoleChip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'green' | 'neutral';
}) {
  const text = tone === 'green' ? 'text-[var(--color-green)]' : 'text-[var(--color-overlay-0)]';
  return (
    <span
      className={`rounded border border-[var(--color-surface-0)] bg-[var(--color-crust)] px-2 py-0.5 font-mono text-[10px] ${text}`}
    >
      {children}
    </span>
  );
}

export function Panel({
  header,
  led,
  scanlineHeader = false,
  className = '',
  children,
}: {
  header?: ReactNode;
  led?: LedTone;
  scanlineHeader?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`overflow-hidden rounded-lg border border-[var(--color-surface-0)] bg-[var(--color-mantle)] ${className}`}
    >
      {header !== undefined && (
        <div
          className={`flex items-center gap-2 border-b border-[var(--color-surface-0)] bg-[var(--color-crust)] px-3 py-2 ${scanlineHeader ? 'scanlines' : ''}`}
        >
          {led && <StatusLed tone={led} />}
          <SectionLabel>{header}</SectionLabel>
        </div>
      )}
      <div className="p-3">{children}</div>
    </section>
  );
}

const ACCENT_COLOUR: Record<'mauve' | 'peach' | 'teal', string> = {
  mauve: 'var(--color-mauve)',
  peach: 'var(--color-peach)',
  teal: 'var(--color-teal)',
};

export function StatTile({
  index,
  label,
  value,
  subline,
  accent,
}: {
  index: string;
  label: string;
  value: ReactNode;
  subline?: string;
  accent: 'mauve' | 'peach' | 'teal';
}) {
  const colour = ACCENT_COLOUR[accent];
  return (
    <div
      className="rounded-lg border border-[var(--color-surface-0)] bg-[var(--color-mantle)] p-4"
      style={{ borderTop: `3px solid ${colour}` }}
    >
      <SectionLabel>
        {index} · {label}
      </SectionLabel>
      <div
        className="mt-1 font-mono text-3xl"
        style={{ textShadow: `0 0 10px color-mix(in srgb, ${colour} 35%, transparent)` }}
      >
        {value}
      </div>
      {subline && <div className="mt-1 text-xs text-[var(--color-subtext-0)]">{subline}</div>}
    </div>
  );
}

export function SkeletonPanel({ lines = 3 }: { lines?: number }) {
  return (
    <div className="animate-pulse space-y-2 rounded-lg border border-[var(--color-surface-0)] bg-[var(--color-mantle)] p-4">
      {Array.from({ length: lines }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static list; index keys are fine.
          key={i}
          className="h-3 rounded bg-[var(--color-surface-0)]"
          style={{ width: `${90 - i * 15}%` }}
        />
      ))}
    </div>
  );
}
