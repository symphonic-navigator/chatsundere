// SPDX-License-Identifier: AGPL-3.0-only
import type { ReasoningControl } from '@chatsundere/llm-unified';
import type { ReasoningState } from '../../lib/reasoning-resolver.js';

interface Props {
  control: ReasoningControl;
  reasoning: ReasoningState;
  onReasoningChange: (r: ReasoningState) => void;
  onClose: () => void;
}

export function CockpitMenu(p: Props): JSX.Element | null {
  if (p.control.mode === 'none') return null;

  return (
    <div className="cockpit-menu" role="menu">
      <div className="cockpit-menu-section" data-section="reasoning">
        <div className="cockpit-menu-label">Reasoning</div>
        {renderReasoning(p)}
      </div>
    </div>
  );
}

function chip(
  label: string,
  active: boolean,
  opts: { disabled?: boolean; onClick?: () => void; dataAttr?: [string, string] },
): JSX.Element {
  const [attrKey, attrVal] = opts.dataAttr ?? [];
  return (
    <button
      key={label}
      type="button"
      className="cockpit-menu-chip"
      disabled={opts.disabled}
      data-active={active ? 'true' : undefined}
      {...(attrKey ? { [attrKey]: attrVal } : {})}
      onClick={opts.onClick}
    >
      {label}
    </button>
  );
}

function renderReasoning(p: Props): JSX.Element {
  const c = p.control;
  if (c.mode === 'none') return <></>;

  // fixed-on: a lit, non-interactive affirmation that the model reasons.
  if (c.mode === 'fixed-on') {
    return <div className="cockpit-menu-chips">{chip('On', true, { disabled: true })}</div>;
  }

  if (c.mode === 'toggle') {
    return (
      <div className="cockpit-menu-chips">
        {chip('On', p.reasoning.kind === 'on', {
          onClick: () => p.onReasoningChange({ kind: 'on' }),
          dataAttr: ['data-action', 'on'],
        })}
        {chip('Off', p.reasoning.kind === 'off', {
          onClick: () => p.onReasoningChange({ kind: 'off' }),
          dataAttr: ['data-action', 'off'],
        })}
      </div>
    );
  }

  // steps
  return (
    <div className="cockpit-menu-chips">
      {c.steps.map((s) =>
        chip(s, p.reasoning.kind === 'step' && p.reasoning.step === s, {
          onClick: () => p.onReasoningChange({ kind: 'step', step: s }),
          dataAttr: ['data-bucket', s],
        }),
      )}
      {c.offStep !== null
        ? chip('Off', p.reasoning.kind === 'off', {
            onClick: () => p.onReasoningChange({ kind: 'off' }),
            dataAttr: ['data-action', 'off'],
          })
        : null}
    </div>
  );
}
