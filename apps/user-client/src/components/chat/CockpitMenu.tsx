// SPDX-License-Identifier: AGPL-3.0-only
import type { ReasoningControl, SearchTier } from '@chatsundere/llm-unified';
import type { ChatFontScale } from '../../lib/chat-font-scale.js';
import type { ReasoningState } from '../../lib/reasoning-resolver.js';

const FONT_SIZE_STEPS: readonly ChatFontScale[] = ['standard', 'large', 'larger'];
const FONT_SIZE_LABEL: Record<ChatFontScale, string> = {
  standard: 'Standard',
  large: 'Large',
  larger: 'Larger',
};

interface Props {
  control: ReasoningControl;
  reasoning: ReasoningState;
  onReasoningChange: (r: ReasoningState) => void;
  onClose: () => void;
  chatFontScale: ChatFontScale;
  onChatFontScaleChange: (scale: ChatFontScale) => void;
  searchTiers?: SearchTier[];
  searchTierId?: string | null;
  onSearchTierChange?: (id: string) => void;
  askExpertAvailable?: boolean;
  askExpert?: boolean;
  onAskExpertChange?: (on: boolean) => void;
  artefactExpertAvailable?: boolean;
  artefactExpertOn?: boolean;
  onArtefactExpertChange?: (on: boolean) => void;
}

export function CockpitMenu(p: Props): JSX.Element {
  const hasReasoning = p.control.mode !== 'none';
  const tiers = p.searchTiers ?? [];
  const hasDepth = tiers.length >= 2;
  // Highlight the stored tier, or fall back to the default when the stored id
  // belongs to a different backend (the id is global, not per-backend).
  const activeTierId = tiers.some((t) => t.id === p.searchTierId) ? p.searchTierId : tiers[0]?.id;

  return (
    <div className="cockpit-menu" role="menu">
      {hasReasoning ? (
        <div className="cockpit-menu-section" data-section="reasoning">
          <div className="cockpit-menu-label">Reasoning</div>
          {renderReasoning(p)}
        </div>
      ) : null}
      {hasDepth ? (
        <div className="cockpit-menu-section" data-section="web-depth">
          <div className="cockpit-menu-label">Web depth</div>
          <div className="cockpit-menu-chips">
            {tiers.map((t) =>
              chip(t.label, activeTierId === t.id, {
                onClick: () => p.onSearchTierChange?.(t.id),
                dataAttr: ['data-tier', t.id],
              }),
            )}
          </div>
        </div>
      ) : null}
      {p.askExpertAvailable ? (
        <div className="cockpit-menu-section" data-section="ask-expert">
          <div className="cockpit-menu-label">Ask expert</div>
          <div className="cockpit-menu-sublabel">for this turn</div>
          <div className="cockpit-menu-chips">
            {chip('On', p.askExpert === true, { onClick: () => p.onAskExpertChange?.(true) })}
            {chip('Off', p.askExpert !== true, { onClick: () => p.onAskExpertChange?.(false) })}
          </div>
        </div>
      ) : null}
      {p.artefactExpertAvailable ? (
        <div className="cockpit-menu-section" data-section="artefact-expert">
          <div className="cockpit-menu-label">Artefact expert</div>
          <div className="cockpit-menu-sublabel">for this chat</div>
          <div className="cockpit-menu-chips">
            {chip('On', p.artefactExpertOn !== false, {
              onClick: () => p.onArtefactExpertChange?.(true),
            })}
            {chip('Off', p.artefactExpertOn === false, {
              onClick: () => p.onArtefactExpertChange?.(false),
            })}
          </div>
        </div>
      ) : null}
      <div className="cockpit-menu-section" data-section="font-size">
        <div className="cockpit-menu-label">Text size</div>
        <div className="cockpit-menu-chips">
          {FONT_SIZE_STEPS.map((step) => (
            <button
              key={step}
              type="button"
              role="menuitemradio"
              aria-checked={p.chatFontScale === step}
              className={`cockpit-chip${p.chatFontScale === step ? ' active' : ''}`}
              data-size={step}
              onClick={() => p.onChatFontScaleChange(step)}
            >
              {FONT_SIZE_LABEL[step]}
            </button>
          ))}
        </div>
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
      // Every chip row is a single-choice group inside `role="menu"`, so each
      // chip is a menuitemradio carrying its own selected state. Without this
      // the selection was conveyed by `data-active` and CSS alone — visible to
      // sighted users, silent to assistive tech, and invalid ARIA besides (bare
      // buttons as direct children of a menu). The Text size section above has
      // always done this correctly; these four sections now match it.
      role="menuitemradio"
      aria-checked={active}
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

  // steps. `offStep` is a MEMBER of `steps` by convention (`maxReasoningIntent`
  // and the curation suite's `permutationsForReasoning` both filter it out the
  // same way), so it must not also be rendered as an ordinary step: it would
  // draw a second chip reading "Off" — and the surplus one emitted
  // `{kind:'step', step:'off'}`, which resolves to `{enabled:true}` because
  // 'off' is not an effort. A chip labelled "Off" that switched reasoning ON.
  // Off leads the row: on a ladder it is the bottom rung, so intensity climbs
  // monotonically from left to right. (The binary On/Off rows elsewhere in this
  // menu keep Off on the right — there is no intensity axis to order there.)
  return (
    <div className="cockpit-menu-chips">
      {c.offStep !== null
        ? chip('Off', p.reasoning.kind === 'off', {
            onClick: () => p.onReasoningChange({ kind: 'off' }),
            dataAttr: ['data-action', 'off'],
          })
        : null}
      {c.steps
        .filter((s) => s !== c.offStep)
        .map((s) =>
          chip(s, p.reasoning.kind === 'step' && p.reasoning.step === s, {
            onClick: () => p.onReasoningChange({ kind: 'step', step: s }),
            dataAttr: ['data-bucket', s],
          }),
        )}
    </div>
  );
}
