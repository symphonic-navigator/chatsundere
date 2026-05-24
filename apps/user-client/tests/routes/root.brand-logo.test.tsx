// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Root } from '../../src/routes/root.js';

describe('Root brand logo', () => {
  it('renders the wordmark inside a span carrying the gradient class', () => {
    render(
      <MemoryRouter>
        <Root />
      </MemoryRouter>,
    );
    const wordmark = screen.getByText('Chatsundere');
    expect(wordmark).toBeInTheDocument();
    expect(wordmark.className).toContain('brand-logo-text');
    expect(wordmark.closest('a')?.className).toContain('brand-logo');
    expect(wordmark.closest('a')?.className).not.toContain('italic');
  });

  it('renders the twinkle as a sibling span with aria-hidden', () => {
    render(
      <MemoryRouter>
        <Root />
      </MemoryRouter>,
    );
    const twinkle = screen.getByText('✦');
    expect(twinkle).toBeInTheDocument();
    expect(twinkle.getAttribute('aria-hidden')).toBe('true');
    expect(twinkle.className).toContain('brand-logo-twinkle');
  });
});
