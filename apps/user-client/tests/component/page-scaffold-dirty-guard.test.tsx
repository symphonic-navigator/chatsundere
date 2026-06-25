// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { PageScaffold } from '../../src/components/ui/PageScaffold.js';

afterEach(cleanup);

function wrap(dirty: boolean) {
  return render(
    <MemoryRouter initialEntries={['/page']}>
      <Routes>
        <Route
          path="/page"
          element={
            <PageScaffold
              crumbs={[{ label: 'Parent', to: '/home' }, { label: 'Page' }]}
              back="/home"
              dirty={dirty}
            >
              <div>page body</div>
            </PageScaffold>
          }
        />
        <Route path="/home" element={<div>home screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PageScaffold dirty-guard', () => {
  it('navigates immediately on Back when not dirty', () => {
    wrap(false);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('home screen')).toBeInTheDocument();
  });

  it('intercepts Back with a discard dialog when dirty', () => {
    wrap(true);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText(/discard unsaved changes/i)).toBeInTheDocument();
    expect(screen.queryByText('home screen')).not.toBeInTheDocument();
  });

  it('"Keep editing" dismisses and stays on the page', () => {
    wrap(true);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: /keep editing/i }));
    expect(screen.queryByText(/discard unsaved changes/i)).not.toBeInTheDocument();
    expect(screen.getByText('page body')).toBeInTheDocument();
  });

  it('"Discard" leaves the page', () => {
    wrap(true);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: /discard/i }));
    expect(screen.getByText('home screen')).toBeInTheDocument();
  });
});
