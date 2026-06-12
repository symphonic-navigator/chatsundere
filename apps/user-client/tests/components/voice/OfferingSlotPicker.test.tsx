// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  OfferingSlotPicker,
  type SlotEntry,
} from '../../../src/components/voice/OfferingSlotPicker.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const XAI_ENTRY: SlotEntry = {
  refId: 'xai:grok-tts',
  label: 'Grok TTS via xAI',
  egressNote: 'Sends message text to xAI (US)',
  configured: true,
  disabledHint: 'Add the xAI provider in My Settings to enable this.',
};

const NANO_ENTRY: SlotEntry = {
  refId: 'nano-gpt:xai-tts',
  label: 'Grok TTS via nano-gpt',
  egressNote: 'Sends message text via nano-gpt to xAI (US)',
  configured: true,
  disabledHint: 'Add the nano-gpt provider in My Settings to enable this.',
};

interface SetupOverrides {
  entries?: SlotEntry[];
  value?: string | null;
  autoLabel?: string | null;
  onSelect?: (refId: string | null) => void;
}

function setup(overrides: SetupOverrides = {}) {
  const onSelect = overrides.onSelect ?? vi.fn();
  render(
    <OfferingSlotPicker
      label="Read-aloud voice"
      subtitle="The voice that reads messages aloud."
      entries={overrides.entries ?? [XAI_ENTRY, NANO_ENTRY]}
      value={overrides.value === undefined ? null : overrides.value}
      autoLabel={overrides.autoLabel === undefined ? null : overrides.autoLabel}
      unconfiguredCopy="Add the xAI or nano-gpt provider to enable read-aloud."
      onSelect={onSelect}
    />,
  );
  return { onSelect };
}

function openPicker(): void {
  fireEvent.click(screen.getByRole('button', { name: /pick read-aloud voice/i }));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('OfferingSlotPicker — collapsed trigger', () => {
  it('shows the explicit selection label when a value is set', () => {
    setup({ value: 'nano-gpt:xai-tts', autoLabel: 'Grok TTS via xAI' });
    const trigger = screen.getByRole('button', { name: /pick read-aloud voice/i });
    expect(trigger.textContent).toContain('Grok TTS via nano-gpt');
    expect(trigger.textContent).not.toContain('(auto)');
  });

  it('shows "<autoLabel> (auto)" when value is null and the auto-default resolves', () => {
    setup({ value: null, autoLabel: 'Grok TTS via xAI' });
    const trigger = screen.getByRole('button', { name: /pick read-aloud voice/i });
    expect(trigger.textContent).toContain('Grok TTS via xAI (auto)');
  });

  it('shows the unconfigured copy when value is null and nothing resolves', () => {
    setup({ value: null, autoLabel: null });
    const trigger = screen.getByRole('button', { name: /pick read-aloud voice/i });
    expect(trigger.textContent).toContain('Add the xAI or nano-gpt provider to enable read-aloud.');
  });

  it('falls back to the resolved auto label when the explicit pick is no longer configured', () => {
    // A stale pick resolves to the auto-default at runtime; the trigger must
    // name what is actually speaking, not the stale offering.
    setup({
      entries: [XAI_ENTRY, { ...NANO_ENTRY, configured: false }],
      value: 'nano-gpt:xai-tts',
      autoLabel: 'Grok TTS via xAI',
    });
    const trigger = screen.getByRole('button', { name: /pick read-aloud voice/i });
    expect(trigger.textContent).toContain('Grok TTS via xAI (auto)');
    expect(trigger.textContent).not.toContain('nano-gpt');
  });
});

describe('OfferingSlotPicker — open list', () => {
  it('renders an Automatic row first, then one row per entry with label and egress note', () => {
    setup({ autoLabel: 'Grok TTS via xAI' });
    openPicker();
    const automatic = screen.getByRole('button', { name: /automatic/i });
    expect(automatic.textContent).toContain('Picks the best configured option for you.');
    const xaiRow = screen.getByRole('button', { name: /grok tts via xai/i });
    expect(xaiRow.textContent).toContain('Sends message text to xAI (US)');
    const nanoRow = screen.getByRole('button', { name: /grok tts via nano-gpt/i });
    expect(nanoRow.textContent).toContain('Sends message text via nano-gpt to xAI (US)');
    // Document order: the Automatic row leads the list.
    expect(
      automatic.compareDocumentPosition(xaiRow) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders an unconfigured entry disabled with its hint; clicking it is a no-op', () => {
    const { onSelect } = setup({
      entries: [XAI_ENTRY, { ...NANO_ENTRY, configured: false }],
      autoLabel: 'Grok TTS via xAI',
    });
    openPicker();
    const disabledRow = screen.getByText('Grok TTS via nano-gpt').closest('[aria-disabled]');
    expect(disabledRow).toBeTruthy();
    expect(disabledRow?.getAttribute('aria-disabled')).toBe('true');
    expect(disabledRow?.textContent).toContain(
      'Add the nano-gpt provider in My Settings to enable this.',
    );
    if (disabledRow) fireEvent.click(disabledRow);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('OfferingSlotPicker — selection', () => {
  it('clicking a configured entry calls onSelect with its ref and collapses the list', () => {
    const { onSelect } = setup({ autoLabel: 'Grok TTS via xAI' });
    openPicker();
    fireEvent.click(screen.getByRole('button', { name: /grok tts via nano-gpt/i }));
    expect(onSelect).toHaveBeenCalledWith('nano-gpt:xai-tts');
    expect(screen.queryByRole('button', { name: /automatic/i })).toBeNull();
  });

  it('clicking Automatic calls onSelect(null) and collapses the list', () => {
    const { onSelect } = setup({ value: 'xai:grok-tts', autoLabel: null });
    openPicker();
    fireEvent.click(screen.getByRole('button', { name: /automatic/i }));
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(screen.queryByRole('button', { name: /automatic/i })).toBeNull();
  });
});
