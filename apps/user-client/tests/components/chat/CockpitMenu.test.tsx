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

describe('CockpitMenu — web depth section', () => {
  it('renders when reasoning is none but 2 search tiers are provided', () => {
    render(
      <CockpitMenu
        control={noReasoning}
        reasoning={{ kind: 'off' }}
        onReasoningChange={() => {}}
        onClose={() => {}}
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
        searchTiers={twoTiers}
        searchTierId="quick"
        onSearchTierChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText('Neural'));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith('neural');
  });

  it('returns null when reasoning is none and fewer than 2 tiers', () => {
    const { container } = render(
      <CockpitMenu
        control={noReasoning}
        reasoning={{ kind: 'off' }}
        onReasoningChange={() => {}}
        onClose={() => {}}
        searchTiers={twoTiers.slice(0, 1)}
        searchTierId={null}
        onSearchTierChange={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders both reasoning and depth sections when both are active', () => {
    render(
      <CockpitMenu
        control={{ mode: 'toggle' as const, defaultOn: true }}
        reasoning={{ kind: 'on' }}
        onReasoningChange={() => {}}
        onClose={() => {}}
        searchTiers={twoTiers}
        searchTierId={null}
        onSearchTierChange={() => {}}
      />,
    );
    expect(screen.getByText('Reasoning')).toBeInTheDocument();
    expect(screen.getByText('Web depth')).toBeInTheDocument();
  });
});
