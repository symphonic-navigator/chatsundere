// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// My Circle and AI Providers honour `?return=` and pass their own full URL on
// (spec 0.5.0 papercuts, "The return convention", items 3 and 4), including
// the two-level chain chat → quick menu → My Circle → Provider missing → Back → Back.

const persona = {
  id: 'p1',
  name: 'Fable',
  colour: '#c9a84c',
  font: 'serif',
  tagline: '',
  instructions: 'x',
  providerId: 'gone',
  adultPersona: false,
};

let providerRows: Array<{ id: string; templateId: string; enabled: boolean; createdAt: number }> =
  [];

vi.mock('../../../src/data/personas.js', () => ({
  useFilteredPersonas: () => ({ data: [persona] }),
  compareByLastInteraction: () => 0,
  useDeletePersona: () => ({ mutateAsync: vi.fn() }),
  usePersonas: () => ({ data: [persona] }),
}));
vi.mock('../../../src/data/providers.js', () => ({
  useProviders: () => ({ data: providerRows }),
}));
vi.mock('../../../src/data/mindspaces.js', () => ({ useMindspaces: () => ({ data: [] }) }));
vi.mock('../../../src/data/settings.js', () => ({
  useSettings: () => ({ data: { defaultMindspaceId: null, userTexture: 'none' } }),
}));
vi.mock('../../../src/data/chats.js', () => ({ useChats: () => ({ data: [] }) }));
vi.mock('../../../src/sync/gate.js', () => ({
  useClass2Gate: () => ({ disabled: false, tooltip: null }),
}));
vi.mock('../../../src/components/PersonaAvatar.js', () => ({
  PersonaAvatar: () => <span data-testid="avatar" />,
}));
vi.mock('../../../src/components/StreamingOrb.js', () => ({ StreamingOrb: () => null }));
vi.mock('../../../src/sync/first-sync.js', () => ({ useFirstSyncPending: () => false }));
vi.mock('../../../src/content/help/use-help.js', () => ({
  useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }),
}));
vi.mock('../../../src/lib/server-gate.js', () => ({
  useServerGate: () => ({ enabled: true, reason: null, tooltip: null }),
}));
vi.mock('@chatsundere/ui-shared', () => ({
  useAccountLinkStore: (sel: (s: { issuerLabel: string | null }) => unknown) =>
    sel({ issuerLabel: null }),
}));
vi.mock('@chatsundere/llm-unified', () => ({
  MODALITY_ORDER: ['llm', 'web', 'tts', 'stt', 'tti'],
  getProvider: (id: string) => ({
    corsHint: 'direct',
    displayName: id,
    offerings: [{ serviceKind: 'llm' }],
    sortPriority: 10,
  }),
  providerServiceKinds: () => ['llm'],
  aggregateServiceKinds: (ids: string[]) => (ids.length ? ['llm'] : []),
  providersContributing: () => [],
}));

import { ChatQuickMenu } from '../../../src/components/chat/ChatQuickMenu.js';
import { Circle } from '../../../src/routes/app/circle.js';
import { SettingsProvidersPage } from '../../../src/routes/app/settings/providers.js';

function Where(): JSX.Element {
  const l = useLocation();
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>;
}

/** Stands in for the chat page: the quick menu, wired as chat-page wires it. */
function ChatStandIn(): JSX.Element {
  const l = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="chat">
      <button type="button" onClick={() => setOpen(true)}>
        Menu
      </button>
      <ChatQuickMenu
        anchor={open ? { top: 0, left: 0, bottom: 10 } : null}
        persona={{ id: 'p1', name: 'Fable', colour: '#fff' }}
        activeChatId="c1"
        returnTo={`${l.pathname}${l.search}`}
        exportState="ready"
        onExport={() => undefined}
        onClose={() => setOpen(false)}
        onEntranceHall={() => navigate('/app')}
        onNavigate={(to) => navigate(to)}
      />
    </div>
  );
}

function renderAt(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/app/chat/:chatId" element={<ChatStandIn />} />
          <Route path="/app/circle" element={<Circle />} />
          <Route path="/app/settings/providers" element={<SettingsProvidersPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const back = () => fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
const CIRCLE_FROM_CHAT = `/app/circle?return=${encodeURIComponent('/app/chat/c1')}`;

beforeEach(() => {
  providerRows = [];
});

describe('My Circle — return path', () => {
  it('?return= drives the back control', () => {
    renderAt(CIRCLE_FROM_CHAT);
    back();
    expect(screen.getByTestId('chat')).toBeInTheDocument();
  });

  it('without ?return= back goes to the Entrance Hall', () => {
    renderAt('/app/circle');
    back();
    expect(screen.getByTestId('where').textContent).toBe('/app');
  });

  it('a row tap passes the full Circle URL as ?return=', () => {
    renderAt(CIRCLE_FROM_CHAT);
    fireEvent.click(screen.getByText('Fable'));
    expect(screen.getByTestId('where').textContent).toBe(
      `/app/persona/p1?return=${encodeURIComponent(CIRCLE_FROM_CHAT)}`,
    );
  });

  it('"Go to persona" passes the full Circle URL as ?return=', () => {
    renderAt(CIRCLE_FROM_CHAT);
    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Go to persona' }));
    expect(screen.getByTestId('where').textContent).toBe(
      `/app/persona/p1?return=${encodeURIComponent(CIRCLE_FROM_CHAT)}`,
    );
  });

  it('"Provider missing" passes the full Circle URL as ?return=', () => {
    renderAt(CIRCLE_FROM_CHAT);
    fireEvent.click(screen.getByRole('button', { name: 'Provider missing' }));
    expect(screen.getByText('AI Providers')).toBeInTheDocument();
    back();
    expect(screen.getByTestId('my-circle')).toBeInTheDocument();
  });
});

describe('AI Providers — return path', () => {
  it('?return= drives the back control', () => {
    renderAt('/app/settings/providers?return=/app');
    back();
    expect(screen.getByTestId('where').textContent).toBe('/app');
  });

  it('without ?return= back goes to My Settings', () => {
    renderAt('/app/settings/providers');
    back();
    expect(screen.getByTestId('where').textContent).toBe('/app/settings');
  });

  it("a row passes the list's full URL as ?return=", () => {
    providerRows = [{ id: 'r1', templateId: 'chutes', enabled: true, createdAt: 0 }];
    renderAt('/app/settings/providers?return=/app');
    fireEvent.click(screen.getByText('chutes'));
    expect(screen.getByTestId('where').textContent).toBe(
      `/app/settings/providers/chutes?return=${encodeURIComponent('/app/settings/providers?return=/app')}`,
    );
  });

  it("the picker passes the list's full URL as ?return=", () => {
    renderAt('/app/settings/providers?return=/app');
    fireEvent.click(screen.getByRole('button', { name: /add provider/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Chutes' }));
    expect(screen.getByTestId('where').textContent).toBe(
      `/app/settings/providers/chutes?return=${encodeURIComponent('/app/settings/providers?return=/app')}`,
    );
  });
});

describe('return chain: chat → quick menu → My Circle → Provider missing', () => {
  it('Back, Back unwinds to My Circle, then the chat', () => {
    renderAt('/app/chat/c1');
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'My Circle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Provider missing' }));
    expect(screen.getByText('AI Providers')).toBeInTheDocument();

    back();
    expect(screen.getByTestId('my-circle')).toBeInTheDocument();

    back();
    expect(screen.getByTestId('chat')).toBeInTheDocument();
  });
});
