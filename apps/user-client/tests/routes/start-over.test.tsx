// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StartOver, _setWipeForTests } from '../../src/routes/login/start-over.js';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/login/start-over']}>
      <Routes>
        <Route path="/login/start-over" element={<StartOver />} />
        <Route path="/login" element={<div data-testid="login" />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  _setWipeForTests(null);
});

describe('StartOver', () => {
  it('demands the typed phrase before enabling the erase button', async () => {
    const user = userEvent.setup();
    renderPage();

    const erase = screen.getByRole('button', { name: /erase this device/i });
    expect(erase).toBeDisabled();

    const input = screen.getByRole('textbox');
    await user.type(input, 'start over');

    expect(erase).toBeEnabled();
  });

  it('names what is erased and what is not', () => {
    renderPage();
    expect(screen.getByText(/erases everything on this device/i)).toBeInTheDocument();
    expect(screen.getByText(/server account .* not touched/i)).toBeInTheDocument();
  });

  it('wipes on confirm', async () => {
    const user = userEvent.setup();
    const wipe = vi.fn().mockResolvedValue(undefined);
    _setWipeForTests(wipe);
    renderPage();

    await user.type(screen.getByRole('textbox'), 'start over');
    await user.click(screen.getByRole('button', { name: /erase this device/i }));

    expect(wipe).toHaveBeenCalledTimes(1);
  });
});
