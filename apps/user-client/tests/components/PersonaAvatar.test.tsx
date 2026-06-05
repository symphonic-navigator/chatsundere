// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { PersonaAvatar } from '../../src/components/PersonaAvatar.js';

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('PersonaAvatar', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('renders the monogram when no avatar is set', async () => {
    render(<PersonaAvatar personaId="p1" name="Aria Vale" colour="#fff" size={48} />, {
      wrapper,
    });
    expect(await screen.findByText('AV')).toBeInTheDocument();
  });
});
