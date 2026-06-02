// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../../src/boot/client-data-db.js';
import { AvatarField } from '../../../src/routes/app/persona-editor.js';

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('AvatarField', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('renders an avatar field with a change affordance', () => {
    render(
      <AvatarField
        personaId="p1"
        name="Aria"
        colour="#fff"
        pending={null}
        onPick={() => {}}
        onRemove={() => {}}
      />,
      { wrapper },
    );
    expect(screen.getByRole('button', { name: /change avatar/i })).toBeInTheDocument();
  });

  it('renders a Remove button', () => {
    render(
      <AvatarField
        personaId="p1"
        name="Aria"
        colour="#fff"
        pending={null}
        onPick={() => {}}
        onRemove={() => {}}
      />,
      { wrapper },
    );
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });

  it('shows the monogram when pending is "remove"', () => {
    render(
      <AvatarField
        personaId="p1"
        name="Aria"
        colour="#fff"
        pending="remove"
        onPick={() => {}}
        onRemove={() => {}}
      />,
      { wrapper },
    );
    // "remove" state renders a monogram div (two uppercase chars)
    expect(screen.getByText('AR')).toBeInTheDocument();
  });

  it('shows a monogram placeholder when personaId is null (create mode)', () => {
    render(
      <AvatarField
        personaId={null}
        name="New"
        colour="#fff"
        pending={null}
        onPick={() => {}}
        onRemove={() => {}}
      />,
      { wrapper },
    );
    expect(screen.getByText('NE')).toBeInTheDocument();
  });
});
