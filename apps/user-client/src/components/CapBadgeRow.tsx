// SPDX-License-Identifier: AGPL-3.0-only

import { MODALITY_ORDER } from '@chatsundere/llm-unified';

// `@chatsundere/llm-unified` exports the MODALITY_ORDER value but does not
// re-export the ServiceKind type from its public barrel, so derive it here.
type ServiceKind = (typeof MODALITY_ORDER)[number];

const LABEL: Record<ServiceKind, string> = {
  llm: 'LLM',
  web: 'WEB',
  tts: 'TTS',
  stt: 'STT',
  tti: 'TTI',
};

/**
 * The modality summary row. Lit badges show what the user (or a provider)
 * contributes; greyed badges show what is missing, with a constructive tooltip.
 * Reusable — Integrations will reuse this for plugin capability badges.
 */
export function CapBadgeRow({
  lit,
  tooltipFor,
}: {
  lit: ServiceKind[];
  tooltipFor?: (kind: ServiceKind) => string;
}): JSX.Element {
  const litSet = new Set(lit);
  return (
    <div className="flex flex-wrap gap-1.5">
      {MODALITY_ORDER.map((k) => {
        const on = litSet.has(k);
        return (
          <span
            key={k}
            data-lit={on ? 'true' : 'false'}
            title={on ? undefined : tooltipFor?.(k)}
            className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
              on
                ? 'border-success/40 bg-success/15 text-success'
                : 'border-white/10 bg-white/[0.02] text-paper-soft/40'
            }`}
          >
            {LABEL[k]}
          </span>
        );
      })}
    </div>
  );
}
