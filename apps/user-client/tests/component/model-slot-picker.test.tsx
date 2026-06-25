// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModelSlotPicker } from '../../src/components/ModelSlotPicker.js';

const baseProps = {
  label: 'Expert model',
  emptyLabel: 'None — pick a model',
  providers: [],
  configuredTemplateIds: [],
};

describe('ModelSlotPicker', () => {
  it('shows the empty label and opens the overlay on tap', () => {
    render(<ModelSlotPicker {...baseProps} current={null} onSelect={vi.fn()} />);
    expect(screen.getByText('None — pick a model')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Expert model/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders a clear control when set and onClear is given', () => {
    const onClear = vi.fn();
    render(
      <ModelSlotPicker
        {...baseProps}
        current={{ providerTemplateId: 'chutes', upstreamSlug: 'glm' }}
        onSelect={vi.fn()}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /use none/i }));
    expect(onClear).toHaveBeenCalled();
  });

  it('does not open when disabled', () => {
    render(
      <ModelSlotPicker
        {...baseProps}
        current={null}
        disabled
        disabledReason="Add a provider first"
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Expert model/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('falls back to upstreamSlug when providers is empty and current is set', () => {
    // With no providers, buildPickerData returns no groups, so the slug is the fallback.
    render(
      <ModelSlotPicker
        {...baseProps}
        current={{ providerTemplateId: 'chutes', upstreamSlug: 'glm-4.7' }}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('glm-4.7')).toBeInTheDocument();
  });
});
