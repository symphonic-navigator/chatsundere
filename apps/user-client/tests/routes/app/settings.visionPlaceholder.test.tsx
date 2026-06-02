// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SubstituteVisionPlaceholder } from '../../../src/routes/app/settings.js';

it('renders a disabled, honest placeholder', () => {
  render(<SubstituteVisionPlaceholder />);
  expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /choose substitute model/i })).toBeDisabled();
});
