// SPDX-License-Identifier: AGPL-3.0-only
import type { KnownModel } from '@chatsundere/llm-unified';
import type { ReasoningState } from '../../lib/reasoning-resolver.js';

interface Props {
  model: KnownModel;
  reasoning: ReasoningState;
  onReasoningChange: (r: ReasoningState) => void;
  onClose: () => void;
}

export function CockpitMenu(p: Props): JSX.Element | null {
  const cap = p.model.reasoning;
  const showReasoning = !(cap.kind === 'no_reasoning' || (cap.kind === 'always_on' && !cap.effort));

  if (!showReasoning) {
    // Phase 3 has only reasoning in the menu — if it's hidden, the menu has nothing.
    return null;
  }

  return (
    <div className="cockpit-menu" role="menu">
      <div className="cockpit-menu-section" data-section="reasoning">
        <div className="cockpit-menu-label">Reasoning</div>
        {renderReasoning(p, cap)}
      </div>
    </div>
  );
}

function renderReasoning(p: Props, cap: KnownModel['reasoning']): JSX.Element {
  const allowOff = cap.kind === 'optional';

  if (cap.effort) {
    return (
      <div className="cockpit-menu-chips">
        {cap.effort.buckets.map((b) => (
          <button
            key={b}
            type="button"
            className="cockpit-menu-chip"
            data-bucket={b}
            data-active={
              p.reasoning.mode === 'bucket' && p.reasoning.bucket === b ? 'true' : undefined
            }
            onClick={() => p.onReasoningChange({ mode: 'bucket', bucket: b })}
          >
            {b}
          </button>
        ))}
        {allowOff ? (
          <button
            type="button"
            className="cockpit-menu-chip"
            data-action="off"
            data-active={p.reasoning.mode === 'off' ? 'true' : undefined}
            onClick={() => p.onReasoningChange({ mode: 'off' })}
          >
            Off
          </button>
        ) : null}
      </div>
    );
  }

  // optional, no effort — on/off toggle
  return (
    <div className="cockpit-menu-chips">
      <button
        type="button"
        className="cockpit-menu-chip"
        data-action="on"
        data-active={p.reasoning.mode === 'on' ? 'true' : undefined}
        onClick={() => p.onReasoningChange({ mode: 'on' })}
      >
        On
      </button>
      <button
        type="button"
        className="cockpit-menu-chip"
        data-action="off"
        data-active={p.reasoning.mode === 'off' ? 'true' : undefined}
        onClick={() => p.onReasoningChange({ mode: 'off' })}
      >
        Off
      </button>
    </div>
  );
}
