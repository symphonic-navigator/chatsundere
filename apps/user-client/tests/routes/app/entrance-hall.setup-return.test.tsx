// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// The setup card's "Connect a provider" goes straight to AI Providers and
// brings the user back to the Entrance Hall (spec 0.5.0 papercuts, item 3).

vi.mock('../../../src/data/chats.js', () => ({ useChats: () => ({ data: [] }) }));
vi.mock('../../../src/data/personas.js', () => ({ useFilteredPersonas: () => ({ data: [] }) }));
vi.mock('../../../src/data/providers.js', () => ({ useProviders: () => ({ data: [] }) }));
vi.mock('../../../src/data/mindspaces.js', () => ({ useMindspaces: () => ({ data: [] }) }));
vi.mock('../../../src/data/settings.js', () => ({
  useSettings: () => ({ data: { defaultMindspaceId: null, userTexture: 'none' } }),
  useDisplayName: () => 'Chris',
}));
vi.mock('../../../src/data/knowledge.js', () => ({
  useFilteredLibraries: () => ({ data: [] }),
}));
vi.mock('../../../src/data/artefacts.js', () => ({ useAllArtefactCount: () => ({ data: 0 }) }));
// The zoom transition is irrelevant here; navigate at once.
vi.mock('../../../src/lib/use-nav-zoom.js', async () => {
  const { useNavigate } = await import('react-router-dom');
  return {
    useNavZoom: () => {
      const navigate = useNavigate();
      return (_el: HTMLElement, to: string) => navigate(to);
    },
  };
});

import { EntranceHall } from '../../../src/routes/app/entrance-hall.js';

function Where(): JSX.Element {
  const l = useLocation();
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>;
}

describe('EntranceHall — setup card', () => {
  it('"Connect a provider" opens AI Providers with ?return=/app', () => {
    render(
      <MemoryRouter initialEntries={['/app']}>
        <Routes>
          <Route path="/app" element={<EntranceHall />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /connect a provider/i }));
    expect(screen.getByTestId('where').textContent).toBe('/app/settings/providers?return=/app');
  });
});
