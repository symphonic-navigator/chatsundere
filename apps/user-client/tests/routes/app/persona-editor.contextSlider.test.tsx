// SPDX-License-Identifier: AGPL-3.0-only
import type { Offering } from '@chatsundere/llm-unified';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContextWindowControl } from '../../../src/routes/app/persona-editor.js';

const offering = { context: { recommended: 200_000, max: 1_000_000 } } as unknown as Offering;

it('disables and labels the control when the model has no head-room', () => {
  const fixed = { context: { recommended: 64_000, max: 64_000 } } as unknown as Offering;
  render(<ContextWindowControl offering={fixed} value={null} onChange={() => {}} />);
  expect(screen.getByRole('slider')).toBeDisabled();
});

it('shows the resolved value and a Use-default reset', () => {
  const onChange = vi.fn();
  render(<ContextWindowControl offering={offering} value={300_000} onChange={onChange} />);
  expect(screen.getByText(/300,000 tokens/)).toBeInTheDocument();
  screen.getByRole('button', { name: /use default/i }).click();
  expect(onChange).toHaveBeenCalledWith(null);
});
