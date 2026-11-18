// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// The Entrance Hall gains a `?` like every other main screen, opening a short
// help page that names each tile (spec 0.5.0 papercuts, item 6).

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

import { HELP_DOCS } from '../../../src/content/help/index.js';
import { EntranceHall } from '../../../src/routes/app/entrance-hall.js';

describe('EntranceHall — help', () => {
  it('has a ? in the welcome header that opens the Entrance Hall help', async () => {
    render(
      <MemoryRouter initialEntries={['/app']}>
        <EntranceHall />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    const dialog = await screen.findByRole('dialog', { name: 'Entrance Hall — help' });
    expect(within(dialog).getByText(/eight rooms/i)).toBeInTheDocument();
  });

  it('names every tile in one line, Treasury and Integrations plainly', () => {
    const md = HELP_DOCS['entrance-hall'].markdown;
    for (const tile of [
      'My Circle',
      'My History',
      'My Treasury',
      'My Projects',
      'My Knowledge',
      'My Integrations',
      'My Settings',
      'My Account',
    ]) {
      expect(md, tile).toContain(`**${tile}**`);
    }
    expect(md).toMatch(/\*\*My Treasury\*\*[^\n]*artefacts/i);
    expect(md).toMatch(/\*\*My Integrations\*\*[^\n]*(tools|services)/i);
  });
});
