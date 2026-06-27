// SPDX-License-Identifier: AGPL-3.0-only

import type { Offering } from '@chatsundere/llm-unified';
import type { PersonaRow } from '../../boot/client-data-db.js';
import {
  CONTEXT_STEP,
  contextAdjustable,
  effectiveFloor,
  resolveContextWindow,
} from '../../lib/context-window.js';

/**
 * Context-window slider. Green from the floor to the offering's recommended
 * window, red from recommended to max (higher = costlier/slower/often weaker).
 * `value` is the persona's override (null = recommended). Emits null on reset.
 */
export function ContextWindowControl({
  offering,
  value,
  onChange,
}: {
  offering: Offering;
  value: number | null;
  onChange: (next: number | null) => void;
}): JSX.Element {
  const floor = effectiveFloor(offering);
  const { max, recommended } = offering.context;
  const adjustable = contextAdjustable(offering);
  const resolved = resolveContextWindow({ contextWindow: value } as PersonaRow, offering);
  const recFraction = max > floor ? ((recommended - floor) / (max - floor)) * 100 : 100;
  const inRed = resolved > recommended;

  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center justify-between">
        <label
          htmlFor="persona-context"
          className="text-xs uppercase tracking-widest text-paper-soft"
        >
          Context window
        </label>
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={value === null}
          className="text-[11px] uppercase tracking-wider text-paper-soft hover:text-paper disabled:opacity-40"
        >
          Use default
        </button>
      </div>
      <div
        aria-hidden
        className="mb-2 h-1.5 w-full rounded-full"
        style={{
          background: `linear-gradient(to right, #6aa97a 0%, #6aa97a ${recFraction}%, #b33a5e ${recFraction}%, #b33a5e 100%)`,
        }}
      />
      <div className="flex items-center gap-3">
        <input
          id="persona-context"
          type="range"
          min={floor}
          max={max}
          step={CONTEXT_STEP}
          value={resolved}
          disabled={!adjustable}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 disabled:opacity-40"
        />
        <span className="w-28 text-right font-mono text-sm text-paper">
          {resolved.toLocaleString()} tokens
        </span>
      </div>
      <p className="mt-1 text-[11px] text-paper-soft">
        {!adjustable
          ? "This model's context window isn't adjustable."
          : inRed
            ? 'Above the recommended window — higher is costlier, slower, and often weaker.'
            : `Default ${recommended.toLocaleString()}. Lower trims cost; the red zone goes up to the model maximum.`}
      </p>
    </div>
  );
}
