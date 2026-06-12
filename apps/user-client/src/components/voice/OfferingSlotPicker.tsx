// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from 'react';

export interface SlotEntry {
  /** Offering ref "providerId:upstreamSlug" — the persisted value. */
  refId: string;
  /** e.g. "Grok TTS via xAI". */
  label: string;
  /** Where the data goes — the conscious-opt-in line (spec §5). */
  egressNote: string;
  configured: boolean;
  /** Shown on the row when not configured, e.g. "Add the xAI provider…". */
  disabledHint: string;
}

interface Props {
  label: string;
  subtitle: string;
  entries: SlotEntry[];
  /** Persisted ref or null for the curated auto-default. */
  value: string | null;
  /** Resolved auto-default label, or null when nothing resolves. */
  autoLabel: string | null;
  /** Copy for the collapsed trigger when nothing is configured at all. */
  unconfiguredCopy: string;
  onSelect: (refId: string | null) => void;
}

/**
 * A voice slot picker (Read-aloud voice / Speech-to-text) following the
 * image-generation slot pattern: explicit pick or visible auto-default,
 * disabled-over-hidden entries with actionable hints, and an egress note per
 * entry so the privacy choice is conscious in the UI, not only in the spec.
 */
export function OfferingSlotPicker({
  label,
  subtitle,
  entries,
  value,
  autoLabel,
  unconfiguredCopy,
  onSelect,
}: Props): JSX.Element {
  const [open, setOpen] = useState(false);

  // A stale pick (provider since unconfigured) falls back to the auto-default
  // at resolve time, so the trigger must not keep showing the stale label —
  // the collapsed control always names what is actually speaking/listening.
  const selectedEntry =
    value === null ? null : (entries.find((e) => e.refId === value && e.configured) ?? null);
  const triggerText =
    selectedEntry?.label ?? (autoLabel !== null ? `${autoLabel} (auto)` : unconfiguredCopy);

  function pick(refId: string | null): void {
    onSelect(refId);
    setOpen(false);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="text-[11px] uppercase tracking-widest text-paper-soft">{label}</div>
      <p className="text-[11px] text-paper-soft">{subtitle}</p>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Pick ${label}`}
        className="flex items-center justify-between rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-paper hover:border-paper-soft"
      >
        <span className={autoLabel !== null || selectedEntry ? 'text-paper' : 'text-paper-soft'}>
          {triggerText}
        </span>
        <span className="text-paper-soft">▾</span>
      </button>

      {open ? (
        <div className="mt-1 flex flex-col gap-0.5 rounded-md border border-white/10 bg-surface-raised">
          <button
            type="button"
            aria-pressed={value === null}
            onClick={() => pick(null)}
            className={`w-full px-3 py-2 text-left text-sm ${
              value === null
                ? 'bg-white/5 text-paper'
                : 'text-paper-soft hover:bg-white/[0.03] hover:text-paper'
            }`}
          >
            Automatic
            <span className="mt-0.5 block text-[11px] text-paper-soft">
              Picks the best configured option for you.
            </span>
          </button>

          {entries.map((entry) =>
            entry.configured ? (
              <button
                key={entry.refId}
                type="button"
                aria-pressed={entry.refId === value}
                onClick={() => pick(entry.refId)}
                className={`w-full px-3 py-2 text-left text-sm ${
                  entry.refId === value
                    ? 'bg-white/5 text-paper'
                    : 'text-paper-soft hover:bg-white/[0.03] hover:text-paper'
                }`}
              >
                {entry.label}
                <span className="mt-0.5 block text-[11px] text-paper-soft">{entry.egressNote}</span>
              </button>
            ) : (
              <div
                key={entry.refId}
                aria-disabled="true"
                className="w-full px-3 py-2 text-left text-sm text-paper-soft/50"
              >
                {entry.label}
                <span className="mt-0.5 block text-[11px]">{entry.disabledHint}</span>
              </div>
            ),
          )}

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="border-t border-white/5 px-3 py-2 text-xs uppercase tracking-wider text-paper-soft hover:text-paper"
          >
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}
