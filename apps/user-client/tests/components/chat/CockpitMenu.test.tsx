// SPDX-License-Identifier: AGPL-3.0-only
import type { SearchTier } from '@chatsundere/llm-unified';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CockpitMenu } from '../../../src/components/chat/CockpitMenu.js';

const noReasoning = { mode: 'none' as const };

const twoTiers: SearchTier[] = [
  { id: 'quick', label: 'Quick', params: {} },
  { id: 'neural', label: 'Neural', params: { depth: 'advanced' } },
];

describe('CockpitMenu — ask expert section', () => {
  it('renders the ask-expert section with On/Off chips when askExpertAvailable is true', () => {
    render(
      <CockpitMenu
        control={noReasoning}
        reasoning={{ kind: 'off' }}
        onReasoningChange={() => {}}
        onClose={() => {}}
        chatFontScale="standard"
        onChatFontScaleChange={() => {}}
        askExpertAvailable={true}
        askExpert={false}
        onAskExpertChange={() => {}}
      />,
    );
    expect(screen.getByText('Ask expert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^on$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^off$/i })).toBeInTheDocument();
  });

  it('marks On chip as active when askExpert is true', () => {
    render(
      <CockpitMenu
        control={noReasoning}
        reasoning={{ kind: 'off' }}
        onReasoningChange={() => {}}
        onClose={() => {}}
        chatFontScale="standard"
        onChatFontScaleChange={() => {}}
        askExpertAvailable={true}
        askExpert={true}
        onAskExpertChange={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /^on$/i }).getAttribute('data-active')).toBe('true');
    expect(screen.getByRole('button', { name: /^off$/i }).getAttribute('data-active')).toBeNull();
  });

  it('marks Off chip as active when askExpert is false', () => {
    render(
      <CockpitMenu
        control={noReasoning}
        reasoning={{ kind: 'off' }}
        onReasoningChange={() => {}}
        onClose={() => {}}
        chatFontScale="standard"
        onChatFontScaleChange={() => {}}
        askExpertAvailable={true}
        askExpert={false}
        onAskExpertChange={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /^off$/i }).getAttribute('data-active')).toBe('true');
    expect(screen.getByRole('button', { name: /^on$/i }).getAttribute('data-active')).toBeNull();
  });

  it('clicking On chip calls onAskExpertChange(true)', () => {
    const onChange = vi.fn();
    render(
      <CockpitMenu
        control={noReasoning}
        reasoning={{ kind: 'off' }}
        onReasoningChange={() => {}}
        onClose={() => {}}
        chatFontScale="standard"
        onChatFontScaleChange={() => {}}
        askExpertAvailable={true}
        askExpert={false}
        onAskExpertChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^on$/i }));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('clicking Off chip calls onAskExpertChange(false)', () => {
    const onChange = vi.fn();
    render(
      <CockpitMenu
        control={noReasoning}
        reasoning={{ kind: 'off' }}
        onReasoningChange={() => {}}
        onClose={() => {}}
        chatFontScale="standard"
        onChatFontScaleChange={() => {}}
        askExpertAvailable={true}
        askExpert={true}
        onAskExpertChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^off$/i }));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('does NOT render the ask-expert section when askExpertAvailable is false', () => {
    const { container } = render(
      <CockpitMenu
        control={noReasoning}
        reasoning={{ kind: 'off' }}
        onReasoningChange={() => {}}
        onClose={() => {}}
        askExpertAvailable={false}
        chatFontScale="standard"
        onChatFontScaleChange={() => {}}
      />,
    );
    expect(container.querySelector('[data-section="ask-expert"]')).toBeNull();
    expect(screen.queryByText('Ask expert')).toBeNull();
  });

  it('does NOT render the ask-expert section when askExpertAvailable is omitted', () => {
    const { container } = render(
      <CockpitMenu
        control={noReasoning}
        reasoning={{ kind: 'off' }}
        onReasoningChange={() => {}}
        onClose={() => {}}
        chatFontScale="standard"
        onChatFontScaleChange={() => {}}
      />,
    );
    expect(container.querySelector('[data-section="ask-expert"]')).toBeNull();
    expect(screen.queryByText('Ask expert')).toBeNull();
  });

  it('shows the Artefact expert section with a per-chat sublabel when available', () => {
    render(
      <CockpitMenu
        control={{ mode: 'none' }}
        reasoning={{ kind: 'off' }}
        onReasoningChange={() => {}}
        onClose={() => {}}
        chatFontScale="standard"
        onChatFontScaleChange={() => {}}
        artefactExpertAvailable
        artefactExpertOn
        onArtefactExpertChange={() => {}}
      />,
    );
    expect(screen.getByText('Artefact expert')).toBeInTheDocument();
    expect(screen.getByText('for this chat')).toBeInTheDocument();
  });

  it('hides the Artefact expert section when unavailable', () => {
    const { container } = render(
      <CockpitMenu
        control={{ mode: 'none' }}
        reasoning={{ kind: 'off' }}
        onReasoningChange={() => {}}
        onClose={() => {}}
        chatFontScale="standard"
        onChatFontScaleChange={() => {}}
      />,
    );
    expect(container.querySelector('[data-section="artefact-expert"]')).toBeNull();
  });

  it('marks the artefact-expert On chip as active when artefactExpertOn is true', () => {
    render(
      <CockpitMenu
        control={{ mode: 'none' }}
        reasoning={{ kind: 'off' }}
        onReasoningChange={() => {}}
        onClose={() => {}}
        chatFontScale="standard"
        onChatFontScaleChange={() => {}}
        artefactExpertAvailable
        artefactExpertOn={true}
        onArtefactExpertChange={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /^on$/i }).getAttribute('data-active')).toBe('true');
    expect(screen.getByRole('button', { name: /^off$/i }).getAttribute('data-active')).toBeNull();
  });

  it('marks the artefact-expert On chip as active by default when artefactExpertOn is omitted (absent means On)', () => {
    render(
      <CockpitMenu
        control={{ mode: 'none' }}
        reasoning={{ kind: 'off' }}
        onReasoningChange={() => {}}
        onClose={() => {}}
        chatFontScale="standard"
        onChatFontScaleChange={() => {}}
        artefactExpertAvailable
        onArtefactExpertChange={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /^on$/i }).getAttribute('data-active')).toBe('true');
    expect(screen.getByRole('button', { name: /^off$/i }).getAttribute('data-active')).toBeNull();
  });

  it('marks the artefact-expert Off chip as active when artefactExpertOn is false', () => {
    render(
      <CockpitMenu
        control={{ mode: 'none' }}
        reasoning={{ kind: 'off' }}
        onReasoningChange={() => {}}
        onClose={() => {}}
        chatFontScale="standard"
        onChatFontScaleChange={() => {}}
        artefactExpertAvailable
        artefactExpertOn={false}
        onArtefactExpertChange={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /^off$/i }).getAttribute('data-active')).toBe('true');
    expect(screen.getByRole('button', { name: /^on$/i }).getAttribute('data-active')).toBeNull();
  });

  it('clicking the artefact-expert On chip calls onArtefactExpertChange(true)', () => {
    const onChange = vi.fn();
    render(
      <CockpitMenu
        control={{ mode: 'none' }}
        reasoning={{ kind: 'off' }}
        onReasoningChange={() => {}}
        onClose={() => {}}
        chatFontScale="standard"
        onChatFontScaleChange={() => {}}
        artefactExpertAvailable
        artefactExpertOn={false}
        onArtefactExpertChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^on$/i }));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('clicking the artefact-expert Off chip calls onArtefactExpertChange(false)', () => {
    const onChange = vi.fn();
    render(
      <CockpitMenu
        control={{ mode: 'none' }}
        reasoning={{ kind: 'off' }}
        onReasoningChange={() => {}}
        onClose={() => {}}
        chatFontScale="standard"
        onChatFontScaleChange={() => {}}
        artefactExpertAvailable
        artefactExpertOn={true}
        onArtefactExpertChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^off$/i }));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe('CockpitMenu — web depth section', () => {
  it('renders when reasoning is none but 2 search tiers are provided', () => {
    render(
      <CockpitMenu
        control={noReasoning}
        reasoning={{ kind: 'off' }}
        onReasoningChange={() => {}}
        onClose={() => {}}
        chatFontScale="standard"
        onChatFontScaleChange={() => {}}
        searchTiers={twoTiers}
        searchTierId={null}
        onSearchTierChange={() => {}}
      />,
    );
    expect(screen.getByText('Web depth')).toBeInTheDocument();
    expect(screen.getByText('Quick')).toBeInTheDocument();
    expect(screen.getByText('Neural')).toBeInTheDocument();
  });

  it('defaults to the first tier as active when searchTierId is null', () => {
    render(
      <CockpitMenu
        control={noReasoning}
        reasoning={{ kind: 'off' }}
        onReasoningChange={() => {}}
        onClose={() => {}}
        chatFontScale="standard"
        onChatFontScaleChange={() => {}}
        searchTiers={twoTiers}
        searchTierId={null}
        onSearchTierChange={() => {}}
      />,
    );
    expect(screen.getByText('Quick').getAttribute('data-active')).toBe('true');
    expect(screen.getByText('Neural').getAttribute('data-active')).toBeNull();
  });

  it('marks the matching tier as active when searchTierId is set', () => {
    render(
      <CockpitMenu
        control={noReasoning}
        reasoning={{ kind: 'off' }}
        onReasoningChange={() => {}}
        onClose={() => {}}
        chatFontScale="standard"
        onChatFontScaleChange={() => {}}
        searchTiers={twoTiers}
        searchTierId="neural"
        onSearchTierChange={() => {}}
      />,
    );
    expect(screen.getByText('Neural').getAttribute('data-active')).toBe('true');
    expect(screen.getByText('Quick').getAttribute('data-active')).toBeNull();
  });

  it('calls onSearchTierChange with the tier id when a chip is clicked', () => {
    const onChange = vi.fn();
    render(
      <CockpitMenu
        control={noReasoning}
        reasoning={{ kind: 'off' }}
        onReasoningChange={() => {}}
        onClose={() => {}}
        chatFontScale="standard"
        onChatFontScaleChange={() => {}}
        searchTiers={twoTiers}
        searchTierId="quick"
        onSearchTierChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText('Neural'));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith('neural');
  });

  it('does NOT render the web-depth section when reasoning is none and fewer than 2 tiers', () => {
    const { container } = render(
      <CockpitMenu
        control={noReasoning}
        reasoning={{ kind: 'off' }}
        onReasoningChange={() => {}}
        onClose={() => {}}
        chatFontScale="standard"
        onChatFontScaleChange={() => {}}
        searchTiers={twoTiers.slice(0, 1)}
        searchTierId={null}
        onSearchTierChange={() => {}}
      />,
    );
    expect(container.querySelector('[data-section="web-depth"]')).toBeNull();
  });

  it('renders both reasoning and depth sections when both are active', () => {
    render(
      <CockpitMenu
        control={{ mode: 'toggle' as const, defaultOn: true }}
        reasoning={{ kind: 'on' }}
        onReasoningChange={() => {}}
        onClose={() => {}}
        chatFontScale="standard"
        onChatFontScaleChange={() => {}}
        searchTiers={twoTiers}
        searchTierId={null}
        onSearchTierChange={() => {}}
      />,
    );
    expect(screen.getByText('Reasoning')).toBeInTheDocument();
    expect(screen.getByText('Web depth')).toBeInTheDocument();
  });
});

describe('CockpitMenu — text size section', () => {
  it('always renders the Text size section, even for a bare model', () => {
    render(
      <CockpitMenu
        control={noReasoning}
        reasoning={{ kind: 'off' }}
        onReasoningChange={vi.fn()}
        onClose={vi.fn()}
        chatFontScale="standard"
        onChatFontScaleChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Text size')).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Large' })).toBeInTheDocument();
  });

  it('marks the active size chip', () => {
    render(
      <CockpitMenu
        control={noReasoning}
        reasoning={{ kind: 'off' }}
        onReasoningChange={vi.fn()}
        onClose={vi.fn()}
        chatFontScale="large"
        onChatFontScaleChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('menuitemradio', { name: 'Large' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemradio', { name: 'Standard' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('changing size reports the new value and does NOT close the menu', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(
      <CockpitMenu
        control={noReasoning}
        reasoning={{ kind: 'off' }}
        onReasoningChange={vi.fn()}
        onClose={onClose}
        chatFontScale="standard"
        onChatFontScaleChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Larger' }));
    expect(onChange).toHaveBeenCalledWith('larger');
    expect(onClose).not.toHaveBeenCalled();
  });
});
