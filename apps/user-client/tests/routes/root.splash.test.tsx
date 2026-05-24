// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Root } from '../../src/routes/root.js';

describe('Root mounts the splash overlay', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
  });

  it('renders SplashOverlay on first mount (cold start)', () => {
    render(
      <MemoryRouter>
        <Root />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText(/skip intro/i)).toBeInTheDocument();
  });

  it('does not render SplashOverlay when splashShown is already set', () => {
    sessionStorage.setItem('splashShown', '1');
    render(
      <MemoryRouter>
        <Root />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText(/skip intro/i)).toBeNull();
  });
});
